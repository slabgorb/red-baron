// src/core/guns.ts
//
// The player's twin machine guns and their shells — story rb2-5, the payoff for
// rb2-4's live enemy: now the player shoots back and the shots can connect. Fire
// while held from ALTERNATING L/R muzzles, throttled by a GUN.ST overheat model;
// a 13-slot shell pool whose shells advance in Z and expire at S.MAXZ; each shell
// sub-stepped 4× per calc-frame so a fast bullet can't tunnel THROUGH a thin enemy
// between frames; and CDSSET/SHCDCK rotated collision windows that decide a hit.
// The hits this reports are the seam rb2-6 (kill → explosion + scoring) consumes.
//
// FRAME CADENCE (findings §1 — load-bearing): every routine here runs ONCE per
// calculation frame (~10.42 Hz / 96 ms), NOT per 62.5 Hz display frame. Within a
// calc-frame, SHLMOT sub-steps each player shell 4× (RBARON.MAC:5186-5198) — the
// only ÷N that beats the calc cadence, so a shell is integrated finely enough that
// it cannot skip past an enemy (the Red Baron analogue of the fast-projectile
// tunnelling trap). Ticking shells per display frame would run them ~6× too fast.
//
// GUN.ST OVERHEAT (findings §5, NEWSHL/NWSHL1, R2BRON.MAC:2149-2233): GUN.ST climbs
// +1 per shot and cools ×3 when the trigger is released; an overheated gun locks
// out (no new shells) until it has cooled. 13 shell slots; shells advance in Z and
// expire at S.MAXZ=19. Hit test: CDSSET builds a rotated/projected min-max window
// around the enemy; SHCDCK tests each PLAYER shell against it (enemy shells are
// never passed here — this module holds only player shells).
//
// SCALE NOTE: the findings doc pins the ROM DATA (13 slots, S.MAXZ=19, 4× sub-step,
// +1 heat, ×3 cool) but NOT the overheat THRESHOLD, the shell SPEED, the collision
// WINDOW size, or the depth→shell-Z projection. Those are chosen here within the
// tested invariants (like enemy.ts's WEAVE_SPEED_CAP / LOD_DISTANCE) and flagged for
// ROM/MAME ratification — see the session's Design Deviations + Delivery Findings.
//
// PURE and deterministic. No DOM, no time, no randomness.

import type { Enemy } from './enemy'

// ─── ROM-exact data (findings §5, §1) ────────────────────────────────────────

/** 13 shell slots — the most player shells that can be in flight at once (findings §5). */
export const SHELL_SLOTS = 13

/** S.MAXZ — a shell expires once it has advanced this far in Z (findings §5). */
export const S_MAXZ = 19

/** SHLMOT sub-steps each shell 4× per calc-frame (findings §1/§5, RBARON.MAC:5186-5198). */
export const SHELL_SUBSTEPS = 4

/** GUN.ST climbs +1 per shot fired (findings §5). */
export const GUN_HEAT_PER_SHOT = 1

/** GUN.ST cools ×3 when the trigger is released — 3× as fast as one shot heats (findings §5). */
export const GUN_COOL_RATE = 3

// ─── tuning within the tested invariants (inferred — NOT ROM-pinned) ─────────

/**
 * GUN.ST lockout threshold: the gun overheats once heat reaches this. Inferred — the
 * findings doc pins the +1/×3 rates but not the limit. Must exceed SHELL_SLOTS so all
 * 13 slots are usable before a lockout; ~2.9 s of continuous fire at the calc cadence.
 */
const GUN_OVERHEAT_LIMIT = 30

/** Z advanced per sub-step; SHELL_SPEED × SHELL_SUBSTEPS is the per-calc-frame travel. Inferred. */
const SHELL_SPEED = 1

/** World depth mapped to shell-Z = S.MAXZ — the gun's reach (CDSSET projection). Inferred. */
const SHELL_RANGE_DEPTH = 800

/** CDSSET collision half-window in screen-window X — you must roughly aim. Inferred/playtest. */
const WINDOW_X = 32
/** …and in screen-window Y. */
const WINDOW_Y = 32
/**
 * …and in shell-Z. Must be ≥ SHELL_SPEED / 2 so successive sub-step windows overlap and
 * a target between two sub-steps can never be tunnelled (2·WINDOW_Z ≥ SHELL_SPEED). Inferred.
 */
const WINDOW_Z = 1

/** L/R muzzle offset from the boresight (the two guns sit either side of centre). Inferred. */
const MUZZLE_X = 4

// ─── state ───────────────────────────────────────────────────────────────────

/** Which of the two muzzles a shot leaves — they alternate (findings §5). */
export type Gun = 'left' | 'right'

/** One player shell in flight — screen-window aim (x, y) + range progress (z). */
export interface Shell {
  /** Screen-window X at fire (enemy.x space); the L/R muzzle offset from boresight. */
  readonly x: number
  /** Screen-window Y at fire (enemy.y space). */
  readonly y: number
  /** Range progress 0..S.MAXZ; advances SHELL_SPEED × SHELL_SUBSTEPS per calc-frame. */
  readonly z: number
  /** The muzzle it left. */
  readonly gun: Gun
  /** In-flight flag. */
  readonly active: boolean
}

/** The twin-gun battery: shells in flight, GUN.ST heat, the lockout, and the alternation cursor. */
export interface Guns {
  /** Up to SHELL_SLOTS shells in flight. */
  readonly shells: readonly Shell[]
  /** GUN.ST accumulator. */
  readonly heat: number
  /** Locked out (overheated) — no new shells until cooled. */
  readonly overheated: boolean
  /** The muzzle the NEXT shot will use. */
  readonly nextGun: Gun
}

/** A player shell that struck a target this calc-frame — rb2-6 explodes + scores it. */
export interface Hit {
  /** The shell at the moment it connected (inactive — already removed from the pool). */
  readonly shell: Shell
  /** Index into the `targets` array passed to `step`. */
  readonly target: number
}

/** Cold, empty, un-overheated guns — the left muzzle fires first. */
export const INITIAL_GUNS: Guns = Object.freeze({
  shells: Object.freeze([]) as readonly Shell[],
  heat: 0,
  overheated: false,
  nextGun: 'left' as Gun,
})

// ─── pure helpers ─────────────────────────────────────────────────────────────

const other = (g: Gun): Gun => (g === 'left' ? 'right' : 'left')
const muzzleX = (g: Gun): number => (g === 'left' ? -MUZZLE_X : MUZZLE_X)

/** CDSSET projection — where an enemy at world `depth` sits on the shell's 0..S.MAXZ range. */
const depthToShellZ = (depth: number): number => (depth * S_MAXZ) / SHELL_RANGE_DEPTH

// ─── firing: NEWSHL / GUN.ST (one calc-frame of the trigger — findings §5) ────

/**
 * Advance the trigger one calculation frame. Held: fire from the alternating muzzle
 * when NOT overheated and a slot is free — spawn a shell, add GUN_HEAT_PER_SHOT, flip
 * the muzzle, and latch the lockout once heat reaches the overheat limit. Released:
 * cool by GUN_COOL_RATE (clamped ≥ 0) and clear the lockout once fully cool. Fires at
 * most ONE shell per calc-frame. Pure — returns a fresh state.
 */
export function fire(guns: Guns, fireHeld: boolean): Guns {
  if (!fireHeld) {
    // Trigger released — GUN.ST cools; the lockout clears once the gun is fully cool.
    const heat = Math.max(0, guns.heat - GUN_COOL_RATE)
    return { ...guns, heat, overheated: heat > 0 ? guns.overheated : false }
  }
  // Trigger held — a locked-out or full-pool gun spawns nothing (heat unchanged).
  if (guns.overheated || guns.shells.length >= SHELL_SLOTS) return guns
  const gun = guns.nextGun
  const shell: Shell = { x: muzzleX(gun), y: 0, z: 0, gun, active: true }
  const heat = guns.heat + GUN_HEAT_PER_SHOT
  return {
    shells: [...guns.shells, shell],
    heat,
    overheated: heat >= GUN_OVERHEAT_LIMIT,
    nextGun: other(gun),
  }
}

// ─── motion + collision: SHLMOT / SHCDCK (findings §1, §5) ─────────────────────

/** SHCDCK — the first target this shell is inside the collision window of, or -1. */
function firstHit(shell: Shell, targets: readonly Enemy[]): number {
  for (let i = 0; i < targets.length; i++) {
    if (collides(shell, targets[i])) return i
  }
  return -1
}

/**
 * Advance every shell one calculation frame across SHELL_SUBSTEPS sub-steps, testing
 * collision at EACH sub-step (so a fast shell cannot tunnel past a thin enemy between
 * frames), expire shells that reach S.MAXZ, and remove + report shells that struck a
 * target. Pure — returns fresh guns plus this frame's hits (for rb2-6). Total on an
 * empty target list (respawn grace / between waves): shells still fly, zero hits.
 */
export function step(guns: Guns, targets: readonly Enemy[]): { guns: Guns; hits: readonly Hit[] } {
  const survivors: Shell[] = []
  const hits: Hit[] = []
  for (const shell of guns.shells) {
    let z = shell.z
    let hitTarget = -1
    let hitZ = z
    for (let s = 0; s < SHELL_SUBSTEPS; s++) {
      z += SHELL_SPEED
      if (z > S_MAXZ) break // travelled its full range — expire below (no out-of-range hit)
      const t = firstHit({ ...shell, z }, targets)
      if (t >= 0) {
        hitTarget = t
        hitZ = z
        break
      }
    }
    if (hitTarget >= 0) {
      hits.push({ shell: { ...shell, z: hitZ, active: false }, target: hitTarget })
      continue // struck shell consumed — frees its slot
    }
    if (z >= S_MAXZ) continue // reached S.MAXZ — expire, free the slot
    survivors.push({ ...shell, z })
  }
  return { guns: { ...guns, shells: survivors }, hits }
}

/**
 * CDSSET / SHCDCK — is this player shell inside the enemy's rotated/projected min-max
 * collision window? The shell's offset from the enemy is rotated into the enemy's banked
 * frame (the window rotates with the plane, it is not axis-locked), then bounded in X, Y,
 * and shell-Z. Total: a degenerate depth (NaN/±Infinity) fails the Z bound and returns
 * false rather than throwing.
 */
export function collides(shell: Shell, enemy: Enemy): boolean {
  const dx = shell.x - enemy.x
  const dy = shell.y - enemy.y
  const c = Math.cos(enemy.bank)
  const s = Math.sin(enemy.bank)
  const rx = dx * c + dy * s // rotate the offset into the enemy's banked frame
  const ry = -dx * s + dy * c
  const dz = shell.z - depthToShellZ(enemy.depth)
  return Math.abs(rx) <= WINDOW_X && Math.abs(ry) <= WINDOW_Y && Math.abs(dz) <= WINDOW_Z
}

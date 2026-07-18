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
// GUN.ST OVERHEAT (NEWSHL/NWSHL1, RBARON.MAC:2153/2172): GUN.ST climbs
// +1 per shot and cools ×3 when the trigger is released; an overheated gun locks
// out (no new shells) until it has cooled. 13 shell slots; shells advance in Z and
// expire at S.MAXZ = 0x19 = 25. Hit test: CDSSET builds a rotated/projected min-max window
// around the enemy; SHCDCK tests each PLAYER shell against it (enemy shells are
// never passed here — this module holds only player shells).
//
// SCALE NOTE: the ROM pins the DATA (13 slots, S.MAXZ = 0x19 = 25, S.DPTH = 0x100, the
// 4× sub-step, +1 heat, ×3 cool) AND — as of rb4-1's rework — the gun's REACH and the
// depth→shell-Z projection, which are S.MAXZ × S.DPTH = 6400 and `depth / S.DPTH`
// respectively. The old header claimed the projection was un-pinned and used an invented
// reach of 800; that made the plane untouchable for its first 41 seconds and put the
// ROM's own far/dim 300-point kill out of reach entirely.
//
// Still genuinely inferred: the overheat THRESHOLD and the shell SPEED — flagged for ROM/MAME
// ratification. (The collision WINDOW was on that list until rb4-17 derived it firsthand:
// COLLD, 037007.XXX:602-605 — see WINDOW_X below.)
//
// PURE and deterministic. No DOM, no time, no randomness.

import { displayPos, type Enemy } from './enemy'
import { projectSegment, type SceneSegment } from './scene'
import { COLLD_POINTS } from './topology'
import { PICTURE_SCALE } from './biplane'
import type { Mat4, Vec3 } from '@arcade/shared/math3d'

/**
 * The eye a shot is judged from when no caller supplies one — the boresight itself.
 *
 * rb4-6 round 2 made the gun's collision DISPLAY-space, so it needs the pilot's eye (see
 * `collides`). The default keeps every existing two-argument caller meaning exactly what it
 * meant: at the origin the display position IS the stored one, so a hand-built fixture that
 * places a target "at (0, 0), dead ahead" still does. Live callers — main.ts — pass `toEye(flight)`.
 */
const EYE_ORIGIN: Vec3 = Object.freeze([0, 0, 0])

// ─── ROM-exact data (findings §5, §1) ────────────────────────────────────────

/** 13 shell slots — the most player shells that can be in flight at once (findings §5). */
export const SHELL_SLOTS = 13

/**
 * S.MAXZ — a shell expires once its Z counter reaches this (PSTSHL, RBARON.MAC:5216-5219).
 * RBARON.MAC:492 `S.MAXZ =19`, .RADIX 16 region (set at :74) → 0x19 = 25.
 * Read as decimal 19 our shells travelled 79% of the ROM's range and died 96 ms early.
 */
export const S_MAXZ = 0x19

/**
 * S.DPTH — the shell's Z UNIT, and the depth it is born at.
 * RBARON.MAC:493 `S.DPTH =100`, .RADIX 16 region (set at :74) → 0x100 = 256.
 *
 * The ROM counts a shell's range in the HIGH BYTE of its 16-bit Z: `PSTSHL` does
 * `INC AX,SHELLS+5` (the Z MSB) once per sub-step and clears the shell when that MSB
 * reaches S.MAXZ. S.MAXZ's own comment says so out loud — ";SHELL MAX Z (* 100)".
 * One Z count is therefore 0x100 of depth.
 */
export const S_DPTH = 0x100

/**
 * The gun's REACH — how far downrange a shell can kill.
 *
 * rb4-1 REWORK. This was `const SHELL_RANGE_DEPTH = 800`, flagged "Inferred", and it was
 * the most consequential invented number in the port. It is not inferred at all: the shell
 * is born at S.DPTH and its Z counter climbs to S.MAXZ, so the reach is
 *
 *     S.MAXZ x S.DPTH  =  0x19 x 0x100  =  6400
 *
 * which is BEYOND the plane's spawn depth P.INDP = 0x1080 = 4224. In the arcade you can
 * shoot the plane THE MOMENT IT APPEARS, and — since PLNSCR pays the flat 300 only for a
 * plane still at depth MSB >= 0x10 — the distant snipe is precisely the shot worth the
 * most. That is the design: you are paid for the hard, far kill.
 *
 * At 800 the gun reached only 19% of the way to the spawn depth. The player could not
 * touch the plane for its first ~41 seconds, and the far/dim 300-point branch was
 * UNREACHABLE — the best a lead could ever be worth was 10 points. The radix sweep made
 * that visible by correcting the depth scale underneath an invented constant that was
 * never rescaled.
 *
 * NO SIM CONSUMER, ON PURPOSE (rb4-1 review finding 7). Nothing in src/ reads this, and
 * that is correct rather than dead: the SIM counts range in the ROM's own unit, Z counts
 * (`step` expires a shell at `z >= S_MAXZ`), because that is literally what PSTSHL does.
 * `S_MAXZ x S_DPTH` and `z >= S_MAXZ` are the SAME statement in two units, and rewriting the
 * expiry as `shellDepth(z) > SHELL_RANGE_DEPTH` would only launder the ROM's arithmetic
 * through a multiply and a divide to reach the same branch.
 *
 * It is retained deliberately as the AUDITED ROM-DERIVATION ANCHOR: it is the one place the
 * gun's reach is stated in DEPTH, the unit every other object in the game is measured in, so
 * the reach can be compared against P.INDP (the spawn) and against the flat-300 gate without
 * anyone re-deriving `0x19 x 0x100` by hand — which is precisely the re-derivation that
 * produced the invented 800. Its consumers are the suite and the audit registry
 * (tests/core/depth-scale.test.ts REGISTRY 1/7, tests/core/engagement.test.ts). Do not
 * "wire it up" to justify its existence, and do not delete it because grep says it is unused.
 */
export const SHELL_RANGE_DEPTH = S_MAXZ * S_DPTH // 6400

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

/**
 * CDSSET / COLSTP collision window — THE WINDOW IS THE PICTURE (rb4-17; was an inferred ±32).
 *
 * Derived firsthand from the quarry, byte for byte:
 *
 *   • Its GEOMETRY is `COLLD` — "PLANE COLLISION WINDOW(POINTP FORMAT)" (RBARON.MAC:409) —
 *     four points in the picture source (037007.XXX:602-605, decimal under `.RADIX 10` :80):
 *         POINTP  12, 20, -40    ;FRONT FACE
 *         POINTP  12,-16, -40
 *         POINTP -12, 20, -40
 *         POINTP -12,-16, -40
 *     A flat plate at the model's front face: the FUSELAGE band (x ±12), belly to top wing
 *     (y −16..+20). NOT the wingspan — the arcade does not pay for a wingtip graze.
 *   • It RIDES THE PICTURE SCALE: CDSSET loads O.DPTH for the collision frame from
 *     PLSTAT+4/+5 — the PICTURE Z (RBARON.MAC:5529-5533) — then rotates/projects COLLD
 *     through the plane's own draw path (`LDX I,2 / JSR PLTEST ;COLLISION FRAME /
 *     JSR MINMAX`, :5535-5537; PPNTS[2] = .COLLD, :6283). POINTP format means the same
 *     ×2→×4 storage lift as the drawn vertices (biplane.ts PICTURE_SCALE) — the plate the
 *     gun tests is the plate the pilot sees, ×4 and all.
 *   • COLSTP (:5774-5815) then bounds each (SHELL − PLANE) display offset inside the
 *     projected plate's min/max (`CMP AY,DB.TRP+2` … `LDA AY,DB.TRP+8`, :5805-5815).
 *
 * Our `collides` makes the same statement one divide earlier: offsets bounded in world units
 * at the plane's depth, both sides riding the SAME perspective divide — which is why the
 * rb4-1 ruling stands: NOT a screen constant, a fraction of the TARGET, never rescaled with
 * the depth axis (proved by the near/far aim-tolerance pin in tests/core/screen-scale.test.ts).
 * Sizing the picture (PICTURE_SCALE) resizes the gun with it, by construction: the values are
 * derived from the COLLD transcription (topology.ts), not re-typed.
 */
const WINDOW_X = Math.max(...COLLD_POINTS.map((p) => Math.abs(p[0]))) * PICTURE_SCALE // ±48
/** COLLD's Y band is ASYMMETRIC — belly −16 up to top wing +20, ×4 (037007.XXX:602-605). */
const WINDOW_Y_MIN = Math.min(...COLLD_POINTS.map((p) => p[1])) * PICTURE_SCALE // −64
const WINDOW_Y_MAX = Math.max(...COLLD_POINTS.map((p) => p[1])) * PICTURE_SCALE // +80
/**
 * …and in shell-Z. Must be ≥ SHELL_SPEED / 2 so successive sub-step windows overlap and
 * a target between two sub-steps can never be tunnelled (2·WINDOW_Z ≥ SHELL_SPEED). Inferred.
 * Denominated in shell-Z COUNTS — the ROM's own range unit (S.MAXZ), not in depth and not in
 * screen: it moves only if SHELL_SPEED moves, which is the invariant it is written against.
 */
const WINDOW_Z = 1

/**
 * L/R muzzle offset from the boresight — the two guns sit either side of centre. Inferred.
 *
 * Also NOT a screen constant (Reviewer's second class). It is where the barrels ARE, in the
 * world, 4 units off the eye's centreline: a shell keeps this x for its whole flight, so its
 * tracer converges on the vanishing point as it recedes, which is what a bullet fired down a
 * boresight does. Rescaling it with the depth axis would move the guns off the aeroplane.
 */
const MUZZLE_X = 4

/**
 * The tracer streak trails this far behind the shell's nose, so the bullet reads as MOTION
 * rather than as a dot. One shell-Z COUNT — the ROM's own range unit, the same unit S.MAXZ
 * and SHELL_SPEED are in, and the granularity of one collision sub-step. Inferred (the ROM's
 * tracer is a hardware artefact, not a byte).
 */
const TRACER_TRAIL_Z = 1

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

/**
 * Where an enemy at world `depth` sits on the shell's 0..S.MAXZ range.
 *
 * With the reach taken from the ROM this is no longer an invented mapping — it collapses
 * to the ROM's own arithmetic. `depth × S_MAXZ / (S_MAXZ × S_DPTH)` is just `depth / S_DPTH`:
 * the shell's Z counter IS the high byte of the depth, which is exactly what `PSTSHL`
 * increments (`INC AX,SHELLS+5`, the Z MSB).
 */
const depthToShellZ = (depth: number): number => depth / S_DPTH

/**
 * …and the way back: the world depth a shell at range-progress `z` actually occupies.
 *
 * `z * S_DPTH` — the shell's Z counter IS the high byte of its 16-bit depth, which is what
 * `PSTSHL` increments (`INC AX,SHELLS+5`, the Z MSB), and `S.MAXZ`'s own comment spells the
 * unit out: ";SHELL MAX Z (* 100)". So one Z count is 0x100 of depth, exactly.
 *
 * rb4-1 REWORK 2. This is EXPORTED, and that is the whole point. The player's trigger runs
 * into a fork — one arm decides what the shell HITS (`collides`, via depthToShellZ above),
 * the other decides where it is DRAWN (main.ts's `shellSegments`). Both convert between z
 * and depth, and they must agree, because they are describing the same bullet.
 *
 * They didn't. main.ts kept its own copy of the gun's reach (`SHELL_DRAW_FAR = 800`) whose
 * comment promised it would track `SHELL_RANGE_DEPTH`. When the reach moved 800 → 6400 the
 * copy stayed put, and a shell that killed the plane at depth 4224 was drawn at 528 — an 8×
 * divergence, the exact 6400/800 ratio. Tracers died in the foreground while the plane
 * exploded untouched.
 *
 * A copy cannot track anything. So there is no copy now: both arms call into this module,
 * and the seam is closed BY CONSTRUCTION rather than by two constants agreeing to.
 */
export const shellDepth = (z: number): number => z * S_DPTH

// ─── the tracer: the RENDER arm of the fork, brought home (rb4-1 REWORK 3) ─────

/**
 * Project a player shell to the short glowing tracer streak the cockpit strokes.
 *
 * REWORK 3, AND THIS IS THE WHOLE FINDING. Exporting `shellDepth` (rework 2) fixed the
 * ARITHMETIC but left the STRUCTURE that produced the bug exactly where it was: the call
 * site — `shellSegments` — still lived in main.ts, which touches `document` at module scope
 * and therefore cannot be imported under vitest's node environment. So the seam was guarded
 * only by four regexes over main.ts's SOURCE TEXT, and the Reviewer walked around all four in
 * under a minute:
 *
 *     const DRAW_REACH = SHELL_RANGE_DEPTH / 8   // arithmetically 800; no literal, no banned name
 *     function shellSegments(shell, viewProj) {
 *       void shellDepth(0)                       // a dead call, and the /shellDepth\s*\(/ regex is happy
 *       const wd = (shell.z / S_MAXZ) * DRAW_REACH
 *       ...
 *     }
 *
 * The rejected bug, restored, with the suite green. A guard you can walk around in sixty
 * seconds is not a guard — and it never could be, because a regex can only ask what the code
 * SAYS, and the bug is about what the code DOES.
 *
 * So the function moves to where a test can call it. It is a pure function of (shell, mvp) —
 * it always was — and it belongs beside `shellDepth` and `depthToShellZ`, in the module that
 * owns the Shell, one line from the conversion it must agree with. tests/core/tracer-seam.ts
 * now fires REAL shells at a REAL enemy through fire()/step(), takes the Hit, and RECOVERS
 * the depth from the projected geometry these segments carry — asserting that the depth the
 * bullet is DRAWN at is the depth it KILLED at. That test cannot be satisfied by a dead call.
 *
 * (biplane.ts sets the house precedent: the plane's model and its `renderModel` walk live in
 * one core module. The shell now does the same.)
 *
 * The streak runs from the shell's nose back TRACER_TRAIL_Z counts. (x, y) are world-window
 * units — the space the enemy lives in — carried straight through, since a shell fired down
 * the boresight does not manoeuvre.
 */
export function shellSegments(shell: Shell, viewProj: Mat4): readonly SceneSegment[] {
  const nose = shellDepth(shell.z)
  const tail = shellDepth(Math.max(0, shell.z - TRACER_TRAIL_Z))
  const front: Vec3 = [shell.x, shell.y, -nose]
  const back: Vec3 = [shell.x, shell.y, -tail]
  const seg = projectSegment(front, back, viewProj)
  return seg ? [seg] : []
}

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
function firstHit(shell: Shell, targets: readonly Enemy[], eye: Vec3): number {
  for (let i = 0; i < targets.length; i++) {
    if (collides(shell, targets[i], eye)) return i
  }
  return -1
}

/**
 * Advance every shell one calculation frame across SHELL_SUBSTEPS sub-steps, testing
 * collision at EACH sub-step (so a fast shell cannot tunnel past a thin enemy between
 * frames), expire shells that reach S.MAXZ, and remove + report shells that struck a
 * target. Pure — returns fresh guns plus this frame's hits (for rb2-6). Total on an
 * empty target list (respawn grace / between waves): shells still fly, zero hits.
 *
 * `eye` is the pilot's own position, passed through to `collides` so the hit is judged where the
 * plane actually IS ON SCREEN (rb4-6 round 2). It defaults to the boresight — see EYE_ORIGIN.
 */
export function step(
  guns: Guns,
  targets: readonly Enemy[],
  eye: Vec3 = EYE_ORIGIN,
): { guns: Guns; hits: readonly Hit[] } {
  const survivors: Shell[] = []
  const hits: Hit[] = []
  for (const shell of guns.shells) {
    let z = shell.z
    let hitTarget = -1
    let hitZ = z
    for (let s = 0; s < SHELL_SUBSTEPS; s++) {
      z += SHELL_SPEED
      if (z > S_MAXZ) break // travelled its full range — expire below (no out-of-range hit)
      const t = firstHit({ ...shell, z }, targets, eye)
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
 *
 * Z-GATE DISCLOSURE (rb4-16 AC-R3): the third bound, `|dz| <= WINDOW_Z`, is a real gate — a shell
 * short of or past the plane's depth misses. rb4-16's reachability guard (plonsn.test.ts AC-R3)
 * deliberately places its probe shell AT the plane's exact depth (`z = depth/256 = depthToShellZ`),
 * so `dz = 0` and the Z gate passes by construction — the guard then measures pure X/Y reach (does
 * the eye-aware servo keep the plane inside the picture plate's X/Y window), not the Z gate. The
 * depth it divides against is the PICTURE Z (`enemy.depth`), NOT the rb4-17 position Z the servo uses.
 *
 * IN DISPLAY SPACE, AND THAT IS THE WHOLE OF rb4-6 ROUND 2. The offset is measured against the
 * plane's position ON SCREEN — `displayPos(enemy, eye)` — not against its stored world position.
 * The shell is fired at the boresight and pinned there (`{ x: muzzleX(gun), y: 0 }` at :321;
 * `step` only ever advances `z`), which is correct ONLY if the plane's coordinates are measured
 * against the pilot too. Round 1 shipped a servo that wove the plane away from the world origin
 * while the gun tested that same world position, so no amount of flying could change the verdict:
 * planes became unhittable at GMLEVL ≥ 2 and the game soft-locked after five kills with all 1051
 * tests green. The producer and the consumer now agree about where the plane is, by construction —
 * both call `displayPos`, and there is no second copy of the pan to drift.
 *
 * This is the ROM's own arrangement: a motion object's stored position is WORLD and its screen
 * position is that minus the pilot (`LDA ZX,PLSTAT ;PLANE POSITION` / `SBC ZX,UNIV4X ;- UNIVERSE
 * CENTER`, RBARON.MAC:2909-2910), and the window/collision work happens on the screen side.
 *
 * THE BOUNDS ARE COLLD's PLATE (rb4-17 — see WINDOW_X above): ±48 in x, −64..+80 in y, the
 * fuselage band at the drawn ×4 picture scale. Note the enemy's PICTURE Z (`depth`) stays the
 * Z the gate divides against — exactly CDSSET's O.DPTH load (:5529-5533) — not the rb4-17
 * position Z. One deliberate simplification, logged: the ROM rotates the plate and then
 * min/maxes it into an axis-aligned box (MINMAX:5718); we rotate the OFFSET into the banked
 * frame and test the unrotated plate — the true rotated-plate test, identical at bank 0 and
 * strictly tighter mid-bank than the ROM's bounding box.
 */
export function collides(shell: Shell, enemy: Enemy, eye: Vec3 = EYE_ORIGIN): boolean {
  const screen = displayPos(enemy, eye)
  const dx = shell.x - screen.x
  const dy = shell.y - screen.y
  const c = Math.cos(enemy.bank)
  const s = Math.sin(enemy.bank)
  const rx = dx * c + dy * s // rotate the offset into the enemy's banked frame
  const ry = -dx * s + dy * c
  const dz = shell.z - depthToShellZ(enemy.depth)
  return Math.abs(rx) <= WINDOW_X && ry >= WINDOW_Y_MIN && ry <= WINDOW_Y_MAX && Math.abs(dz) <= WINDOW_Z
}

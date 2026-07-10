// src/core/enemy.ts
//
// The single enemy biplane: its weaving window-follower dogfight AI, the seeded
// side-entry spawn, and the DISCHK proximity mapping that feeds the player's
// control feel. Story rb2-4 — the lone-plane case (the 25 % RANDOM roll); the
// drone formations and score-scaled counts are rb2-7.
//
// STEERING is a WEAVING WINDOW-FOLLOWER, NOT a beeline seeker (findings §3,
// UPDPLN/PLNDEL/P.WINDW, R2BRON.MAC:2566-2870): the plane accelerates its ΔX
// (ACCEL=30) toward the window limits and REVERSES at the boundaries, weaving
// across screen centre. It follows the WINDOW, not the player — a stationary
// target is never chased to a standstill. Limits are GMLEVL-indexed (P.OLIM /
// P.ILIM, R2BRON.MAC:2935-2952) — higher level = wider, more aggressive weave.
//
// SPAWN (findings §3, NWPLNE/STPLNE, R2BRON.MAC:2237-2386): enters from a screen
// SIDE banked 90°, random X/Y, at depth P.INDP=1080. This story ships the LONE
// plane; `spawn` returns ONE enemy and consumes the injected seeded Rng for its
// random placement (the arcade-shared PRNG, same pattern as asteroids' spawnRock).
//
// BANK ∝ turn-rate reuses flight.ts's `biplaneBank` (PFROTN = ΔX×8, clamped ±0x100
// → ±45°) so the enemy and the player horizon share ONE coupling with no
// duplicated ROLL_SCALE (story context, findings §2). The 90° spawn bank is an
// entry flourish the plane rolls out of as it settles into the weave.
//
// PURE and deterministic. No DOM, no time, no ambient randomness — the ONLY source
// of randomness is the seeded Rng handed to `spawn`.

import { type Rng, nextFloat } from '@arcade/shared/rng'
import { biplaneBank } from './biplane'
import type { ProximityBand } from './flight'

// ─── ROM-exact data (findings §3, R2BRON.MAC) ────────────────────────────────

/** P.OLIM — outer weave-window limit, GMLEVL-indexed (R2BRON.MAC:2935). */
export const P_OLIM: readonly number[] = Object.freeze([0x40, 0x80, 0x120, 0x1a0, 0x200])

/** P.ILIM — inner weave-window limit, GMLEVL-indexed (R2BRON.MAC:2952). */
export const P_ILIM: readonly number[] = Object.freeze([0x20, 0x30, 0x80, 0x120, 0x160])

/** P.INDP — the depth a plane enters at, far from the eye (NWPLNE, R2BRON.MAC:2237). */
export const P_INDP = 1080

/** ACCEL — the per-calc-frame ΔX weave acceleration (findings §3). */
export const ACCEL = 30

/** The RANDOM roll: 25 % chance of a lone plane (findings §3). rb2-7 branches on it. */
export const LONE_PLANE_CHANCE = 0.25

// ─── tuning within the tested invariants (inferred — NOT ROM-pinned) ─────────

/**
 * Cap on |ΔX| so the weave crosses the window smoothly instead of teleporting
 * wall-to-wall. The ROM accelerates ΔX toward the limit but the per-frame
 * integration/cap is not pinned by the source, so this is a tunable (like
 * biplane.ts's LOD_DISTANCE), chosen within TEA's weave invariants.
 */
const WEAVE_SPEED_CAP = 100

/** Per-calc-frame closing speed — the plane bores in so DISCHK proximity sharpens. Inferred. */
const CLOSE_SPEED = 8

/** Closest the plane bores in here; the returning-ace pass past P.MNDP is rb2-8. Inferred. */
const MIN_DEPTH = 140

/** DISCHK band cutoffs by depth (inferred tunables — the ROM pins the scale fractions, not these). */
const NEAR_DEPTH = 300
const MID_DEPTH = 700

/** The entry flourish: the plane peels in banked a full 90°. */
const SPAWN_BANK = Math.PI / 2

/** Vertical spread of the random spawn Y (± window units) — inferred, keeps the plane on-screen. */
const SPAWN_Y_RANGE = 40

// ─── state ───────────────────────────────────────────────────────────────────

/** The lone enemy plane's state — all ROM-window units. */
export interface Enemy {
  /** Screen-window X — weaves across centre (0), bounded ±P_OLIM[level]. */
  readonly x: number
  /** Vertical offset — random at spawn. */
  readonly y: number
  /** Depth in front of the eye; P_INDP at spawn, closes toward the player. */
  readonly depth: number
  /** ΔX — the weave velocity / turn-rate (accelerates by ACCEL, reverses at bounds). */
  readonly deltaX: number
  /** Roll (radians): ±90° entry flourish, then biplaneBank(deltaX) once weaving. */
  readonly bank: number
  /** The screen side it entered from. */
  readonly side: -1 | 1
  /** D7 "active" status. */
  readonly active: boolean
}

// ─── pure helpers ─────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** Clamp a GMLEVL to a valid table index (0 .. .LEVLS-1). */
const levelIndex = (level: number): number => clamp(Math.floor(level) || 0, 0, P_OLIM.length - 1)

// ─── spawn ─────────────────────────────────────────────────────────────────────

/**
 * Spawn the lone enemy from a screen side, banked 90°, at depth P.INDP — the 25 %
 * lone-plane case (findings §3). Consumes the seeded Rng for its random side, X
 * (in the outer band of the window), and Y. Pure per seed.
 */
export function spawn(rng: Rng, level = 0): Enemy {
  const lvl = levelIndex(level)
  const olim = P_OLIM[lvl]
  const ilim = P_ILIM[lvl]
  const side: -1 | 1 = nextFloat(rng) < 0.5 ? -1 : 1
  // random X in the outer band [ilim, olim), on the chosen side — it enters from the edge
  const mag = ilim + nextFloat(rng) * (olim - ilim)
  const y = (nextFloat(rng) * 2 - 1) * SPAWN_Y_RANGE
  return {
    x: side * mag,
    y,
    depth: P_INDP,
    deltaX: 0,
    bank: side * SPAWN_BANK,
    side,
    active: true,
  }
}

// ─── the calc-frame weave (one step per 96 ms calc frame — findings §1) ────────

/**
 * Advance the weaving window-follower one calculation frame. Accelerates ΔX toward
 * the current heading, reverses at the outer window boundary, banks ∝ ΔX via the
 * shared `biplaneBank`, and bores the depth in. Pure — returns a fresh state.
 */
export function step(enemy: Enemy, level = 0): Enemy {
  const olim = P_OLIM[levelIndex(level)]
  // heading: reverse at the outer boundary, else continue in the direction of travel.
  let heading: number
  if (enemy.x >= olim) heading = -1
  else if (enemy.x <= -olim) heading = 1
  else heading = enemy.deltaX >= 0 ? 1 : -1
  const deltaX = clamp(enemy.deltaX + ACCEL * heading, -WEAVE_SPEED_CAP, WEAVE_SPEED_CAP)
  return {
    ...enemy,
    x: clamp(enemy.x + deltaX, -olim, olim),
    deltaX,
    bank: biplaneBank(deltaX),
    depth: Math.max(enemy.depth - CLOSE_SPEED, MIN_DEPTH),
  }
}

// ─── DISCHK proximity wiring (live nearest-enemy depth → band, findings §2) ────

/**
 * Map an enemy depth to its DISCHK proximity band — the seam that sharpens the
 * player's control feel as the enemy closes (near ×1.0 / mid ×0.625 / far ×0.375,
 * scaled in flight.ts). Total over every input: a degenerate depth (NaN, ±Infinity)
 * falls through to the slow 'far' band rather than crashing.
 */
export function proximityBand(depth: number): ProximityBand {
  if (depth < NEAR_DEPTH) return 'near'
  if (depth < MID_DEPTH) return 'mid'
  return 'far'
}

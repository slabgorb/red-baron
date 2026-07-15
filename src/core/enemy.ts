// src/core/enemy.ts
//
// The single enemy biplane: its weaving window-follower dogfight AI, the seeded
// side-entry spawn, and the DISCHK proximity mapping that feeds the player's
// control feel. Story rb2-4 — the lone-plane case (the 25 % RANDOM roll); the
// drone formations and score-scaled counts are rb2-7.
//
// STEERING is a WEAVING WINDOW-FOLLOWER, NOT a beeline seeker (findings §3,
// UPDPLN/PLNDEL/P.WINDW, RBARON.MAC:2570/2743/2806): the plane accelerates its ΔX
// (ACCEL=0x30) toward the window limits and REVERSES at the boundaries, weaving
// across screen centre. It follows the WINDOW, not the player — a stationary
// target is never chased to a standstill. Limits are GMLEVL-indexed
// (P.OLIM/P.ILIM, RBARON.MAC:2939/2945) — higher level = wider, more aggressive weave.
//
// SPAWN (findings §3, NWPLNE/STPLNE, RBARON.MAC:2241/2274): enters from a screen
// SIDE banked 90°, random X/Y, at depth P.INDP=0x1080. This story ships the LONE
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
import { P_MNDP, P_INDP, closeSpeed } from './returning-ace'

// ─── ROM-exact data (RBARON.MAC, `.RADIX 16` region — HEX) ───────────────────
//
// RADIX WARNING (rb4-1). Every equate below is defined under `.RADIX 16`, set at
// RBARON.MAC:74 and unbroken until the vertex island at :6217. The digits are HEX.
// This block was previously transcribed as DECIMAL, from a doc that cited the DECOY
// BUILD — a 10-SEP-81 image that never shipped, whose line numbers run 4 short of the
// real one. Read the region, not the digits.

/** P.OLIM — outer weave-window limit, GMLEVL-indexed (RBARON.MAC:2939, .RADIX 16 region). */
export const P_OLIM: readonly number[] = Object.freeze([0x40, 0x80, 0x120, 0x1a0, 0x200])

/** P.ILIM — inner weave-window limit, GMLEVL-indexed (RBARON.MAC:2945, .RADIX 16 region). */
export const P_ILIM: readonly number[] = Object.freeze([0x20, 0x30, 0x80, 0x120, 0x160])

/**
 * ACCEL — the per-calc-frame ΔX weave acceleration (P.WCHK).
 * RBARON.MAC:465 `ACCEL =30`, .RADIX 16 region (set at :74) → 0x30 = 48.
 * Read as decimal 30 the weave built turn-rate at 62.5% of arcade rate — and since
 * bank ∝ ΔX, the planes banked shallower too.
 */
export const ACCEL = 0x30

/**
 * P.MNDP — the closest a plane bores in before the fly-by becomes a returning pass.
 * RBARON.MAC:469 `P.MNDP =140`, .RADIX 16 region (set at :74) → 0x140 = 320.
 *
 * Re-exported from returning-ace.ts under its ROM NAME rather than re-typed, so one ROM
 * equate cannot hold two values again (it held 140 in both places, and both were wrong).
 *
 * rb4-1 REWORK: this was briefly exported as `MIN_DEPTH`, which collided with
 * landscape.ts's own `MIN_DEPTH` — the mountain recycle threshold, 0x01C0 = 448. One
 * identifier, two unrelated ROM equates, two values: exactly the bug class this story
 * exists to kill, recreated in the act of killing it. The ROM name is unambiguous.
 *
 * P.INDP (RBARON.MAC:464, 0x1080 = 4224 — the depth a plane ENTERS at, STPLNE) rides
 * back out through here too. It now lives beside P.MNDP in returning-ace.ts, which
 * imports nothing: the two ends of the depth axis belong in the one module every other
 * module can reach without a cycle. enemy.ts's public surface is unchanged.
 */
export { P_MNDP, P_INDP }

/** The RANDOM roll: 25 % chance of a lone plane (findings §3). rb2-7 branches on it. */
export const LONE_PLANE_CHANCE = 0.25

// ─── tuning within the tested invariants (inferred — NOT ROM-pinned) ─────────

/**
 * Cap on |ΔX| so the weave crosses the window smoothly instead of teleporting
 * wall-to-wall. The ROM accelerates ΔX toward the limit but the per-frame
 * integration/cap is not pinned by the source, so this is a tunable, chosen
 * within TEA's weave invariants.
 */
const WEAVE_SPEED_CAP = 100

/**
 * DISCHK band cutoffs by depth — INFERRED tunables. DISCHK itself (RBARON.MAC:3468)
 * branches on a distance FLAG (D6/D7 of TEMP3) and pins only the scale fractions
 * (1.0 / 0.625 / 0.375); which depth raises which flag is not pinned here, so these
 * cutoffs are ours. (Which fraction belongs to which band — ours are inverted — is rb4-5's.)
 *
 * rb4-1: they are now expressed as FRACTIONS OF P_INDP rather than as bare numbers.
 * The old 300/700 were calibrated against the mis-read 1080-deep world; against the
 * true 0x1080 = 4224 they left the plane's whole flight in 'far'/'mid' — it floored at
 * P.MNDP = 320 and could never reach 'near' at all. Tying them to P_INDP means the depth
 * scale and the bands can never drift apart again.
 */
const NEAR_DEPTH = P_INDP / 4 // 1056
const MID_DEPTH = (P_INDP * 5) / 8 // 2640

/** The entry flourish: the plane peels in banked a full 90°. */
const SPAWN_BANK = Math.PI / 2

/** Vertical spread of the random spawn Y (± window units) — inferred, keeps the plane on-screen. */
const SPAWN_Y_RANGE = 40

// ─── state ───────────────────────────────────────────────────────────────────

/**
 * Which kind of plane this is — the lead or one of its two drone wingmen (findings §3,
 * "1 PLANE, 2 DRONES"). rb2-7 adds this discriminant so the kill payoff can score a
 * drone as the flat DRONE_SCORE and a close lead by depth, and so PLNXCG can promote a
 * surviving drone into the next lead. A subset of scoring.ts's KillKind (the blimp — a
 * borrowed slot, findings §3 — arrives in rb2-10); scoreKill accepts an EnemyKind value
 * structurally, so this type stays HERE (the lower module) with no import into scoring.
 */
export type EnemyKind = 'lead' | 'drone'

/** The enemy plane's state — all ROM-window units. */
export interface Enemy {
  /** Lead plane or drone wingman (findings §3). */
  readonly kind: EnemyKind
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
  /**
   * The PLSTAT+6 D4 orientation mirror (rb4-13): `true` ⇔ D4=0 "PLANE FACING
   * AWAY" (RBARON.MAC:2652); `false` ⇔ D4=1, still rotated toward the viewer.
   * THIS bit — never depth — picks the biplane model (DRNPIC, RBARON.MAC:4961).
   * Cleared (set true) once the entry rotation completes, exactly as the ROM's
   * :2620-2652 ramp does; re-rotation belongs to the ace pass, not the weave.
   */
  readonly facingAway: boolean
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
    kind: 'lead', // the lone plane is a lead; drones are fielded by waves.ts's spawnWave
    x: side * mag,
    y,
    depth: P_INDP,
    deltaX: 0,
    bank: side * SPAWN_BANK,
    side,
    active: true,
    facingAway: false, // D4=1 at entry — the plane arrives rotated-in, mid entry turn
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
    // D4 clears once the entry rotation completes (RBARON.MAC:2645-2652 ramps the entry
    // Y-rotation to zero, then `AND I,0EF` — ";D4=0 (PLANE FACING AWAY)"). Our entry
    // flourish settles into the weave on the first calc-frame (the ±90° spawn bank is
    // replaced by the weave bank above), so the bit clears here and never re-sets in
    // the weave — re-rotation toward the viewer is the ace pass's business.
    facingAway: true,
    // The ROM's own approach rate: PLNZD indexes PLPOSZ by GMLEVL and stores it as
    // "PLANE MOTION DEPTH DELTA" (RBARON.MAC:2409-2411), and UPDPLN ADDS it to the depth
    // (:2704-2707) — the entries are negative, so the depth falls. Deeper levels close
    // up to 20× faster. This replaces an invented flat CLOSE_SPEED = 8.
    depth: Math.max(enemy.depth + closeSpeed(level), P_MNDP),
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

// ─── PLNLVL level-gated firing (findings §3, PLNSHL/NWPLNE) ────────────────────

/**
 * The PLNLVL fire GRANT for a GMLEVL — the fraction of planes allowed to shoot the
 * player (findings §3, NWPLNE:2345-2355): level < 4 never (0), level 4 a 50 % coin
 * flip (0.5), level ≥ 5 always (1). The early sky (level < 4) never shoots back.
 * Total — a non-finite / negative level fails safe to "never fire".
 */
export function planeFireChance(level: number): number {
  if (!Number.isFinite(level)) return 0
  const lvl = Math.floor(level)
  if (lvl < 4) return 0
  if (lvl === 4) return 0.5
  return 1
}

/**
 * Does a plane fire THIS calc-frame? Combines the PLNLVL level grant with the ÷2 FRAME
 * cadence (PLNSHL:4798-4807 — a plane fires at most every OTHER calc-frame, gated by the
 * FRAME LSB) and, at level 4, a supplied `roll` in [0,1) for the 50 % coin flip. Pure —
 * the caller draws `roll` (e.g. nextFloat of the seeded Rng), so the decision is
 * deterministic. NOTE: which frame parity fires is inferred (the ROM pins the ÷2, not
 * the phase); we fire on even FRAME.
 */
export function planeFires(level: number, frame: number, roll: number): boolean {
  const chance = planeFireChance(level)
  if (chance === 0) return false
  if ((Math.floor(frame) & 1) !== 0) return false // ÷2 FRAME cadence — hold fire on odd frames
  return chance === 1 || roll < 0.5 // always-fire, or win the level-4 coin flip
}

// src/core/explosion.ts
//
// The kill payoff — story rb2-6. When a player shell downs the enemy biplane
// (guns.ts reports the Hit), the plane becomes a falling, spinning WRECK (UPPLEX):
// it plummets under gravity, spins about Z, then bursts into the four ROM
// explosion-debris pieces (PIECE0-3), and finally goes quiet — the frame the ROM
// would promote a wingman to lead (PLNXCG, rb2-7). Grounded in findings §3
// ("Killed enemy = falling/spinning wreck", UPPLEX, R2BRON.MAC:2957-3030).
//
// FRAME CADENCE (findings §1 — load-bearing): the wreck advances ONE step per
// calculation frame (~10.42 Hz / 96 ms), NOT per 62.5 Hz display frame — main.ts
// steps it inside the SIM_TIMESTEP_S accumulator, like every other rb2 motion.
//
// UPPLEX (findings §3): gravity EX.ACY = -20 accumulates each frame so the fall
// ACCELERATES; the wreck spins about Z; it spends .EXPL1 = 6 frames FALLING, then
// .EXPL2 = 12 frames EXPLODING (the PIECE0-3 debris), then it is DONE (18 frames
// total). The debris GEOMETRY is topology.ts's EXPLOSION_PIECES (transcribed rb2-2);
// this module owns the wreck KINEMATICS + lifecycle, main.ts draws the pieces.
//
// SCALE NOTE: the findings doc byte-pins the DATA (EX.ACY=-20, .EXPL1=6, .EXPL2=12,
// 4 pieces) but NOT the Z spin RATE or the fall's render units — those are chosen here
// within the tested invariants (accelerating fall, monotone spin, exact phase counts),
// like enemy.ts's WEAVE_SPEED_CAP, and flagged as inferred.
//
// PURE and deterministic. No DOM, no time, no randomness.

import type { Enemy } from './enemy'
import { EXPLOSION_PIECES } from './topology'

// ─── ROM-exact data (findings §3, UPPLEX R2BRON.MAC:2957-3030) ────────────────

/** EX.ACY — gravity accel per calc-frame; negative = the wreck accelerates DOWN. */
export const EX_ACY = -20

/** .EXPL1 — the wreck spends this many calc-frames FALLING before it bursts. */
export const EXPL1_FRAMES = 6

/** .EXPL2 — then this many calc-frames EXPLODING (the PIECE0-3 debris window). */
export const EXPL2_FRAMES = 12

/** The four PIECE0-3 explosion-debris models drawn while exploding (topology.ts, rb2-2). */
export const DEBRIS_COUNT = EXPLOSION_PIECES.length

// ─── tuning within the tested invariants (inferred — NOT ROM-pinned) ─────────

/**
 * Z spin per calc-frame. The ROM spins the wreck about Z (findings §3) but does not
 * pin the rate; a fixed non-zero step gives the authentic tumbling fall (chosen like
 * enemy.ts's WEAVE_SPEED_CAP, within TEA's monotone-spin invariant).
 */
const SPIN_RATE = Math.PI / 4

// ─── state ───────────────────────────────────────────────────────────────────

/** The UPPLEX lifecycle: a live wreck FALLS, then EXPLODES into debris, then is DONE. */
export type WreckPhase = 'falling' | 'exploding' | 'done'

/** A downed enemy in its falling/spinning/exploding UPPLEX sequence — all window units. */
export interface Wreck {
  /** Screen-window X, inherited from the killed enemy (does not drift sideways). */
  readonly x: number
  /** Screen-window Y — DROPS under gravity as the wreck falls. */
  readonly y: number
  /** Depth at the kill; the debris is drawn here (the wreck does not close/recede). */
  readonly depth: number
  /** Vertical velocity; accumulates EX_ACY every live frame (starts 0). */
  readonly vy: number
  /** Z rotation angle; advances SPIN_RATE every live frame (the wreck spins). */
  readonly spin: number
  /** Which stage of the UPPLEX sequence this wreck is in. */
  readonly phase: WreckPhase
  /** Calc-frames remaining in the current phase. */
  readonly timer: number
}

// ─── UPPLEX: spawn + the calc-frame step ──────────────────────────────────────

/**
 * Turn a killed enemy into a fresh falling wreck at its exact pose — at rest (vy 0),
 * spinning from the plane's banked attitude, with .EXPL1 falling frames ahead. Pure.
 */
export function explode(enemy: Enemy): Wreck {
  return {
    x: enemy.x,
    y: enemy.y,
    depth: enemy.depth,
    vy: 0,
    spin: enemy.bank,
    phase: 'falling',
    timer: EXPL1_FRAMES,
  }
}

/**
 * Advance the wreck one calculation frame: accumulate gravity (vy += EX_ACY) and THEN
 * move (y += vy) so the fall ACCELERATES, advance the Z spin, and count the phase timer
 * down — falling → exploding → done. Once 'done' the wreck is quiet: stepping it is
 * idempotent (no more fall, spin, or timer change). Pure — returns a fresh Wreck.
 */
export function stepWreck(wreck: Wreck): Wreck {
  if (wreck.phase === 'done') return wreck // gone quiet — the PLNXCG hand-off point (rb2-7)
  const vy = wreck.vy + EX_ACY // gravity first…
  const y = wreck.y + vy // …then move, so each frame drops farther than the last
  const spin = wreck.spin + SPIN_RATE
  const countdown = wreck.timer - 1
  if (countdown > 0) return { ...wreck, y, vy, spin, timer: countdown }
  // the phase timer elapsed — advance to the next stage of the sequence
  if (wreck.phase === 'falling') return { ...wreck, y, vy, spin, phase: 'exploding', timer: EXPL2_FRAMES }
  return { ...wreck, y, vy, spin, phase: 'done', timer: 0 }
}

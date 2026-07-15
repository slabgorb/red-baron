// src/core/explosion.ts
//
// The kill payoff — story rb2-6. When a player shell downs the enemy biplane
// (guns.ts reports the Hit), the plane becomes a falling, spinning WRECK (UPPLEX):
// it plummets under gravity, spins about Z, then bursts into the four ROM
// explosion-debris pieces (PIECE0-3), and finally goes quiet — the frame the ROM
// would promote a wingman to lead (PLNXCG, rb2-7). Grounded in findings §3
// ("Killed enemy = falling/spinning wreck", UPPLEX, RBARON.MAC:2961).
//
// FRAME CADENCE (findings §1 — load-bearing): the wreck advances ONE step per
// calculation frame (~10.42 Hz / 96 ms), NOT per 62.5 Hz display frame — main.ts
// steps it inside the SIM_TIMESTEP_S accumulator, like every other rb2 motion.
//
// UPPLEX (findings §3): gravity EX.ACY = -0x20 accumulates each frame so the fall
// ACCELERATES; the wreck spins about Z; it spends .EXPL1 = 6 frames FALLING, then
// .EXPL2 = 12 frames EXPLODING (the PIECE0-3 debris), then it is DONE (18 frames
// total). The debris GEOMETRY is topology.ts's EXPLOSION_PIECES (transcribed rb2-2);
// this module owns the wreck KINEMATICS + lifecycle, main.ts draws the pieces.
//
// SCALE NOTE (rb4-1): the ROM pins MORE than the old note here admitted. EX.ACY and the
// Z spin rate are BOTH byte-pinned (-0x20 and 0x180 angle-units/frame); only the fall's
// render units remain a port-side choice. The spin was previously picked by feel at π/4,
// on a comment that claimed the source did not pin it. It does.
//
// PURE and deterministic. No DOM, no time, no randomness.

import type { Enemy } from './enemy'
import { EXPLOSION_PIECES } from './topology'

// ─── ROM-exact data (RBARON.MAC, `.RADIX 16` region — HEX) ───────────────────
//
// RADIX WARNING (rb4-1): UPPLEX lives under `.RADIX 16` (set at RBARON.MAC:74).
// These digits are HEX. The previous transcription read them as decimal, from a doc
// citing the DECOY BUILD — an image that never shipped.

/**
 * EX.ACY — gravity accel per calc-frame; negative = the wreck accelerates DOWN.
 * RBARON.MAC:481 `EX.ACY =-20`, .RADIX 16 region (set at :74) → -0x20 = -32.
 * UPPLEX confirms the 16-bit reading directly: it adds the low byte (`ADC I,EX.ACY`)
 * then the high byte (`ADC I,EX.ACY&0FF00/100`) — i.e. it adds -0x0020 each frame.
 * Read as decimal -20 our wreck accumulated 420 units of drop over its six falling
 * frames where the ROM's accumulates 672. It hung in the air.
 */
export const EX_ACY = -0x20

/** .EXPL1 — the wreck spends this many calc-frames FALLING before it bursts. */
export const EXPL1_FRAMES = 6

/** .EXPL2 — then this many calc-frames EXPLODING (the PIECE0-3 debris window). */
export const EXPL2_FRAMES = 12

/** The four PIECE0-3 explosion-debris models drawn while exploding (topology.ts, rb2-2). */
export const DEBRIS_COUNT = EXPLOSION_PIECES.length

/**
 * Z spin per calc-frame — and the ROM DOES pin it (the old comment here claimed it
 * did not, and picked π/4 by feel).
 *
 * UPPLX0 advances the wreck's 16-bit Z angle by adding 0x80 to the low byte and 1 to
 * the high byte with carry (`ADC I,80` / `ADC I,1`, RBARON.MAC:2997-3003, .RADIX 16
 * region set at :74) — i.e. 0x0180 = 384 angle units per calc-frame.
 *
 * The angle SCALE is fixed by `P.MAXR =1FF ;90 DEGREE MAX ROTATION` (RBARON.MAC:471):
 * 0x200 = 512 units = 90°, so a full turn is 2048 units. The spin is therefore
 * 384/2048 = 0.1875 turn = 67.5° = 3π/8 per frame. At our π/4 the wreck tumbled at
 * two-thirds the ROM's rate — 8 frames per revolution where the arcade takes 5.33.
 */
export const SPIN_RATE = (3 * Math.PI) / 8

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
  /**
   * The killed enemy's PLSTAT+6 D4 orientation mirror, captured at the kill
   * (rb4-13): the falling wreck keeps drawing the model the plane died wearing.
   * Picks the biplane model in wreck-render.ts — depth never does (DRNPIC,
   * RBARON.MAC:4961).
   */
  readonly facingAway: boolean
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
    facingAway: enemy.facingAway, // the wreck keeps the model the plane died wearing
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

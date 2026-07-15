// src/core/score-countup.ts
//
// THE SCORE COUNT-UP (SCOREM) + BONUS LIVES (BONUSL) — story rb4-4 (AC-4/AC-5).
// The ROM never displays a kill's points instantly: the kill QUEUES its value
// (";QUEUE SCORE", RBARON.MAC:3049) and SCOREM (";COUNT IN SCORE (W/AUDIO)",
// RBARON.MAC:1531-1603) drains the queue over time — the displayed score TICKS
// up, and every tick is a sound. That drain is why the cabinet's TK/TP tones
// exist at all; without this machine three of the five POKEY reward tones could
// never fire (the story's headline bug).
//
// THE TICK (SCOREM, cited): SCRTAB holds the pending amount in BCD tens. While
// anything pends and SCRTIM has run down —
//
//   pending <  100  →  add 1 ten  (SOUND 0, the TK "10 POINT SOUND", :1577);
//                      SCRTIM = STINIT (:1559) — the next tick may come next frame
//   pending >= 100  →  add 10 tens (SOUND 0 AND SOUND 4, the TP "100 POINT
//                      SOUND", :1577-1580 — the big tick fires BOTH);
//                      SCRTIM = STINIT*2 (:1561) — the big tick runs at HALF cadence
//
// The boundary is `CPY I,10.` (:1558) — the trailing dot forces DECIMAL ten
// tens = 100 points. SCOREM runs at NMEXIT (RBGRND.MAC:236), i.e. every 4 ms
// NMI, so STINIT = 0x18 = 24 NMIs = 96 ms — exactly ONE calc frame per small
// tick. This module therefore ticks once per calc frame with a one-frame
// cooldown after each big tick.
//
// THE BONUS (inside the tick, :1582-1602): OPTION bits 2-3 pick a COLUMN of the
// BONUSL table (:1605-1608); EXLIFE advances +4 = one ROW per award
// (:1593-1595); the compare is against SCORE+1 — the DISPLAYED score's BCD
// thousands (:1589-1590) — never the queued total. A hit is SOUND 2 (BN),
// `INC LIVES` (:1602), and the next rung. Row 3 is FF FF FF FF: the well is dry
// after three awards, forever.
//
// RADIX WARNING (rb4-1): RBARON.MAC is `.RADIX 16` from :74. BONUSL's digits
// are HEX BYTES read as the BCD digits of SCORE+1: `.BYTE 10` is BCD "10" =
// 10,000 points — NOT decimal 16,000. The decimal misreading is refuted in the
// suite (tests/core/score-countup.test.ts).
//
// NOT MODELED (session Delivery Finding): SCOREM defers its tick while other
// sounds play (:1541-1544 waits on POINT+4/POINT+2/EXCNTR) — shell audio state
// is unreadable from the pure core.
//
// PURE and deterministic. No DOM, no time, no randomness.

import type { GameEvent } from './events'

// ─── ROM-exact constants (RBARON.MAC, .RADIX 16 region — HEX) ─────────────────

/** STINIT = 0x18 — ";SCORE 24.*4 MS.COUNT(SOUND)" (:507): 24 NMIs = 96 ms = one calc frame. */
export const STINIT = 0x18

/** The small tick: one BCD ten (:1556) — SOUND 0's unit. */
export const SMALL_TICK = 10

/** The big tick: ten BCD tens (:1563) — SOUND 4's unit. */
export const LARGE_TICK = 100

/** `CPY I,10.` (:1558) — at/above ten pending tens the tick is the big one. */
export const LARGE_TICK_THRESHOLD = 100

/**
 * BONUSL (:1605-1608) — option COLUMN × award ROW, BCD thousands:
 *
 *     .BYTE 2,4,6,0FF          row 0 (EXLIFE 0)
 *     .BYTE 10,15,20,0FF       row 1 (EXLIFE 4)
 *     .BYTE 30,40,50,0FF       row 2 (EXLIFE 8)
 *     .BYTE 0FF,0FF,0FF,0FF    row 3 (EXLIFE 12) — none
 *
 * Transposed here to per-option ladders; the 0xFF column (option 3) never pays.
 */
export const BONUSL: readonly (readonly number[])[] = Object.freeze([
  Object.freeze([2000, 10000, 30000]),
  Object.freeze([4000, 15000, 40000]),
  Object.freeze([6000, 20000, 50000]),
  Object.freeze([]),
])

// ─── state ─────────────────────────────────────────────────────────────────────

/** The count-up machine — SCORE (displayed), SCRTAB (pending), SCRTIM (cooldown), EXLIFE/4. */
export interface ScoreCountUp {
  /** SCORE — what the HUD shows. */
  readonly displayed: number
  /** SCRTAB — queued points not yet displayed. */
  readonly pending: number
  /** SCRTIM in calc frames: 0 = may tick this frame (a big tick banks 1). */
  readonly cooldown: number
  /** EXLIFE/4 — bonus rungs already paid (0..3). */
  readonly awarded: number
}

/** A cold machine: nothing displayed, nothing pending, no rungs paid. */
export function initialCountUp(): ScoreCountUp {
  return { displayed: 0, pending: 0, cooldown: 0, awarded: 0 }
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** Clamp an OPTION selector to a BONUSL column; NaN/negative/over-range fold to a valid slot. */
const optionIndex = (option: number): number => clamp(Math.floor(option) || 0, 0, BONUSL.length - 1)

// ─── the queue (:3049 "QUEUE SCORE") ──────────────────────────────────────────

/** Bank a kill's points into SCRTAB. Total: a degenerate amount (NaN/negative) banks nothing. */
export function queueScore(s: ScoreCountUp, points: number): ScoreCountUp {
  if (!Number.isFinite(points) || points <= 0) return s
  return { ...s, pending: s.pending + Math.floor(points) }
}

// ─── the tick (SCOREM :1533-1602) — one calc frame ────────────────────────────

/**
 * One calc frame of SCOREM. With nothing pending: silence (and SCRTIM held reset,
 * :1552 — a fresh queue's first tick comes on the very next frame). A cooling
 * frame after a big tick is silent. Otherwise: tick the display, sound the tick
 * (a big tick fires the small sound TOO, :1577-1580), and run the BONUSL check
 * against the FRESH displayed score (:1589) — pay at most one rung.
 */
export function tickCountUp(
  s: ScoreCountUp,
  option = 0,
): { score: ScoreCountUp; events: GameEvent[] } {
  if (s.pending <= 0) {
    return { score: s.cooldown === 0 ? s : { ...s, cooldown: 0 }, events: [] }
  }
  if (s.cooldown > 0) {
    return { score: { ...s, cooldown: s.cooldown - 1 }, events: [] }
  }
  const large = s.pending >= LARGE_TICK_THRESHOLD
  const step = large ? LARGE_TICK : SMALL_TICK
  const displayed = s.displayed + step
  const events: GameEvent[] = [{ type: 'score-tick', size: 'small' }]
  if (large) events.push({ type: 'score-tick', size: 'large' })
  const ladder = BONUSL[optionIndex(option)]
  let awarded = s.awarded
  if (awarded < ladder.length && displayed >= ladder[awarded]) {
    events.push({ type: 'bonus-life' })
    awarded += 1
  }
  return {
    score: {
      displayed,
      pending: s.pending - step,
      cooldown: large ? 1 : 0, // STINIT*2 for the big tick (:1561), STINIT for the small (:1559)
      awarded,
    },
    events,
  }
}

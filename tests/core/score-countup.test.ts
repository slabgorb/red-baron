// tests/core/score-countup.test.ts
//
// Story rb4-4 — RED phase (TEA). THE SCORE COUNT-UP (SCOREM) + BONUS LIVES (BONUSL).
// The ROM never displays a kill's points instantly: the kill QUEUES its value
// (";QUEUE SCORE", RBARON.MAC:3049) and SCOREM (";COUNT IN SCORE (W/AUDIO)",
// RBARON.MAC:1531-1603) drains the queue over time, ticking the DISPLAYED score up
// and firing a sound on every tick — SOUND 0 (the TK 10-point sound, :1577) on every
// tick, plus SOUND 4 (the TP 100-point sound, :1580) when the tick is the big one.
// The BONUS-LIFE check rides INSIDE the tick (:1582-1602): when the freshly-ticked
// displayed score crosses the BONUSL threshold, SOUND 2 fires (BN) and LIVES
// increments. None of this exists in the clone — score jumps +300 in one calc frame
// and TK/TP/BN can never play (this story's AC-4/AC-5).
//
// CONTRACT for the GREEN phase (Dev): create `src/core/score-countup.ts`, a PURE
// module (no DOM, no time, no randomness) exporting:
//
//   // --- ROM-exact constants (RBARON.MAC, .RADIX 16 set at :74 — digits are HEX) ---
//   export const STINIT = 0x18            // :507 "SCORE 24.*4 MS.COUNT(SOUND)" — 24 NMIs
//                                         //   = 96 ms = exactly ONE calc frame per small tick
//                                         //   (SCOREM runs at NMEXIT, RBGRND.MAC:236, every 4 ms NMI)
//   export const SMALL_TICK = 10          // SOUND 0 unit — the ROM adds 1 (a BCD ten) :1556
//   export const LARGE_TICK = 100         // SOUND 4 unit — the ROM adds 0x10 (BCD "10" tens) :1563
//   export const LARGE_TICK_THRESHOLD = 100 // CPY I,10. (:1558, trailing dot = DECIMAL 10 tens)
//   // BONUSL (:1605-1608, .RADIX 16 → BCD thousands read against SCORE+1, :1589-1590):
//   //   option is the COLUMN (OPTION bits 2-3, :1582-1585); each award advances EXLIFE
//   //   by 4 = one ROW down (:1593-1595). Row 3 is FF FF FF FF = "none".
//   export const BONUSL: readonly (readonly number[])[]
//   //   BONUSL[0] = [2000, 10000, 30000]   (option 0 walks column 0: 02 → 10 → 30)
//   //   BONUSL[1] = [4000, 15000, 40000]
//   //   BONUSL[2] = [6000, 20000, 50000]
//   //   BONUSL[3] = []                      (0FF column — no bonus lives ever)
//
//   export interface ScoreCountUp {
//     readonly displayed: number   // SCORE — what the HUD shows (BCD in the ROM)
//     readonly pending: number     // SCRTAB — queued points not yet displayed
//     readonly cooldown: number    // SCRTIM in calc frames: 0 = may tick this frame
//     readonly awarded: number     // EXLIFE/4 — bonus thresholds already paid (0..3)
//   }
//   export function initialCountUp(): ScoreCountUp
//   export function queueScore(s: ScoreCountUp, points: number): ScoreCountUp
//   export function tickCountUp(s: ScoreCountUp, option?: number):
//     { score: ScoreCountUp; events: GameEvent[] }   // ONE calc frame of SCOREM
//
// TICK SEMANTICS (SCOREM, cited above): with pending > 0 and cooldown spent —
//   pending <  100 → displayed += 10,  pending -= 10,  events [score-tick small];
//                    next tick may come the NEXT calc frame (SCRTIM = STINIT = 1 frame)
//   pending >= 100 → displayed += 100, pending -= 100, events [score-tick small,
//                    score-tick large] (SOUND 0 fires UNCONDITIONALLY at :1577; SOUND 4
//                    joins it at :1580) — and the next tick waits an EXTRA frame
//                    (SCRTIM = STINIT*2, :1561 — the big tick runs at HALF cadence)
// With pending == 0: no tick, no events, displayed unchanged.
// BONUS (inside the tick, :1582-1602): when the tick's fresh `displayed` reaches
// BONUSL[option][awarded], events also carry {type:'bonus-life'} and awarded += 1.
// The check rides the DISPLAYED score (SCORE+1, :1589) — never the queued total.

import { describe, it, expect } from 'vitest'
import type { GameEvent } from '../../src/core/events'
import {
  STINIT,
  SMALL_TICK,
  LARGE_TICK,
  LARGE_TICK_THRESHOLD,
  BONUSL,
  initialCountUp,
  queueScore,
  tickCountUp,
  type ScoreCountUp,
} from '../../src/core/score-countup'

/** Drive N calc frames, collecting every event; returns final state + events. */
function run(s: ScoreCountUp, frames: number, option = 0): { score: ScoreCountUp; events: GameEvent[] } {
  let state = s
  const events: GameEvent[] = []
  for (let i = 0; i < frames; i++) {
    const out = tickCountUp(state, option)
    state = out.score
    events.push(...out.events)
  }
  return { score: state, events }
}

const ticks = (events: readonly GameEvent[]): GameEvent[] => events.filter((e) => e.type === 'score-tick')
const bonuses = (events: readonly GameEvent[]): GameEvent[] => events.filter((e) => e.type === 'bonus-life')

describe('the ROM constants are the hex the source spells (RBARON.MAC .RADIX 16, :74)', () => {
  it('STINIT = 0x18 — 24 NMIs of 4 ms = 96 ms = exactly one calc frame (:507)', () => {
    expect(STINIT).toBe(0x18)
    expect(STINIT * 4).toBe(96) // the same 96 ms as timing.ts SIM_TIMESTEP_S — one tick per calc frame
  })

  it('tick sizes are the BCD units SCOREM adds: 10 and 100 (:1556, :1563)', () => {
    expect(SMALL_TICK).toBe(10)
    expect(LARGE_TICK).toBe(100)
    expect(LARGE_TICK_THRESHOLD).toBe(100) // CPY I,10. — trailing dot forces DECIMAL (ten tens)
  })

  it('BONUSL is the 4x4 table read as BCD thousands, option = column, award = row (:1605-1608)', () => {
    // .BYTE 2,4,6,0FF / 10,15,20,0FF / 30,40,50,0FF / 0FF,0FF,0FF,0FF — hex digits ARE the
    // BCD digits of SCORE+1 (thousands): 0x10 reads "10" = 10,000. NOT decimal 16,000.
    expect(BONUSL[0]).toEqual([2000, 10000, 30000])
    expect(BONUSL[1]).toEqual([4000, 15000, 40000])
    expect(BONUSL[2]).toEqual([6000, 20000, 50000])
    expect(BONUSL[3]).toEqual([]) // the 0FF column: no bonus lives ever
    // the decimal misreading is REFUTED, not just unchosen (the rb4-1 lesson):
    expect(BONUSL[1]).not.toContain(16000) // 0x10 read as raw hex → 16 → 16,000: appears nowhere
    expect(BONUSL[1]).not.toContain(21000) // 0x15 → 21 → 21,000: appears nowhere
  })
})

describe('a kill QUEUES its points — the display does not jump (:3049 "QUEUE SCORE")', () => {
  it('queueScore banks the points as pending and leaves the displayed score alone', () => {
    const s = queueScore(initialCountUp(), 300)
    expect(s.pending).toBe(300)
    expect(s.displayed).toBe(0)
  })

  it('queues accumulate (a double kill banks both values)', () => {
    const s = queueScore(queueScore(initialCountUp(), 300), 200)
    expect(s.pending).toBe(500)
    expect(s.displayed).toBe(0)
  })

  it('is total: a degenerate queue amount (NaN / negative) banks nothing rather than corrupting', () => {
    expect(queueScore(initialCountUp(), Number.NaN).pending).toBe(0)
    expect(queueScore(initialCountUp(), -50).pending).toBe(0)
  })
})

describe('the drain ticks the display up over calc frames (SCOREM :1533-1580)', () => {
  it('with nothing pending, a tick does nothing and emits nothing', () => {
    const { score, events } = tickCountUp(initialCountUp())
    expect(score.displayed).toBe(0)
    expect(events).toEqual([])
  })

  it('a small amount (< 100) drains in 10s, one small score-tick per calc frame', () => {
    const { score, events } = run(queueScore(initialCountUp(), 30), 3)
    expect(score.displayed).toBe(30)
    expect(score.pending).toBe(0)
    expect(ticks(events)).toEqual([
      { type: 'score-tick', size: 'small' },
      { type: 'score-tick', size: 'small' },
      { type: 'score-tick', size: 'small' },
    ])
  })

  it('a large amount (>= 100) drains in 100s — and each big tick fires BOTH sounds (:1577-1580)', () => {
    // SOUND 0 (the small TK) is unconditional at :1577; SOUND 4 (TP) joins at :1580.
    const out = tickCountUp(queueScore(initialCountUp(), 300))
    expect(out.score.displayed).toBe(100)
    expect(out.score.pending).toBe(200)
    expect(ticks(out.events)).toEqual([
      { type: 'score-tick', size: 'small' },
      { type: 'score-tick', size: 'large' },
    ])
  })

  it('the big tick runs at HALF cadence — SCRTIM = STINIT*2 (:1561): tick, wait, tick', () => {
    let s = queueScore(initialCountUp(), 300)
    const perFrame: number[] = []
    for (let f = 0; f < 6; f++) {
      const out = tickCountUp(s)
      s = out.score
      perFrame.push(ticks(out.events).length > 0 ? s.displayed : -1) // -1 = silent frame
    }
    // 300 pending: +100, wait, +100, wait, +100 — drained on frame 5 of 6.
    expect(perFrame).toEqual([100, -1, 200, -1, 300, -1])
    expect(s.displayed).toBe(300)
    expect(s.pending).toBe(0)
  })

  it('small ticks run every calc frame — no wait between them (SCRTIM = STINIT, :1559)', () => {
    let s = queueScore(initialCountUp(), 30)
    const out1 = tickCountUp(s)
    const out2 = tickCountUp(out1.score)
    expect(ticks(out1.events).length).toBeGreaterThan(0)
    expect(ticks(out2.events).length).toBeGreaterThan(0) // the very next frame ticks again
  })

  it('a mixed amount finishes the 100s then the 10s (320 → 3 large + 2 small)', () => {
    const { score, events } = run(queueScore(initialCountUp(), 320), 12)
    expect(score.displayed).toBe(320)
    expect(score.pending).toBe(0)
    expect(ticks(events).filter((e) => e.type === 'score-tick' && e.size === 'large')).toHaveLength(3)
    // 3 big ticks each also fire the small sound, plus 2 genuine small ticks = 5 smalls
    expect(ticks(events).filter((e) => e.type === 'score-tick' && e.size === 'small')).toHaveLength(5)
  })

  it('exactly at the boundary (pending == 100) the tick is the big one (BCC on CPY I,10., :1558-1560)', () => {
    const out = tickCountUp(queueScore(initialCountUp(), 100))
    expect(out.score.displayed).toBe(100)
    expect(ticks(out.events)).toContainEqual({ type: 'score-tick', size: 'large' })
  })
})

describe('BONUSL — the bonus life rides the TICK that crosses the threshold (:1582-1602)', () => {
  it('crossing the first option-0 threshold (2000) awards exactly one bonus-life', () => {
    // Queue 2000 and drain: 20 large ticks over ~40 frames; the bonus fires ON the
    // tick whose fresh displayed hits 2000 (:1589 compares the DISPLAYED score) — once.
    const { score, events } = run(queueScore(initialCountUp(), 2000), 50)
    expect(score.displayed).toBe(2000)
    expect(bonuses(events)).toHaveLength(1)
    expect(score.awarded).toBe(1)
  })

  it('the award is on the DISPLAYED score, not the queue — banking 5000 pays nothing until the drain reaches 2000', () => {
    const s = queueScore(initialCountUp(), 5000)
    expect(s.awarded).toBe(0) // queueing alone never awards
    // Drain 19 large ticks' worth of frames: displayed 1900 — still short, no award.
    const early = run(s, 37)
    expect(early.score.displayed).toBe(1900)
    expect(bonuses(early.events)).toHaveLength(0)
    // One more big tick (2 frames): displayed 2000 → the award fires now.
    const cross = run(early.score, 2)
    expect(cross.score.displayed).toBe(2000)
    expect(bonuses(cross.events)).toHaveLength(1)
  })

  it('each award advances one ROW (EXLIFE += 4, :1593-1595): 2000, then 10000, then 30000', () => {
    const { score, events } = run(queueScore(initialCountUp(), 30000), 640)
    expect(score.displayed).toBe(30000)
    expect(bonuses(events)).toHaveLength(3)
    expect(score.awarded).toBe(3)
  })

  it('PAST THE TABLE END the well is dry — the FF row (:1608) pays no fourth life, ever', () => {
    // The table-walk-off lesson: the value past the last record must be tested.
    const drained = run(queueScore(initialCountUp(), 30000), 640)
    const beyond = run(queueScore(drained.score, 40000), 850)
    expect(beyond.score.displayed).toBe(70000)
    expect(bonuses(beyond.events)).toHaveLength(0) // no fourth threshold exists
    expect(beyond.score.awarded).toBe(3)
  })

  it('option selects the COLUMN: option 2 pays at 6000, not 2000 (:1582-1585)', () => {
    const short = run(queueScore(initialCountUp(), 5900), 120, 2)
    expect(bonuses(short.events)).toHaveLength(0) // 5900 < 6000 — option 2's first rung
    const cross = run(queueScore(short.score, 100), 3, 2)
    expect(bonuses(cross.events)).toHaveLength(1)
  })

  it('option 3 is the 0FF column — no bonus life at any score (:1605-1608)', () => {
    const { events } = run(queueScore(initialCountUp(), 60000), 1300, 3)
    expect(bonuses(events)).toHaveLength(0)
  })
})

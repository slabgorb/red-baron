// tests/core/eol-sequence.test.ts
//
// Story rb4-4 — RED phase (TEA). THE END-OF-LIFE TIMER (EOGTMR) — the machine that
// makes the two death channels DISTINCT and gives each the ROM's own duration.
//
// THE ROM (EOLSEQ, RBARON.MAC:1057-1201): death raises GREND's D7 — by enemy
// shells (`LDA I,80 / STA GREND ;SHELL CD`, :3758-3759) or by the ground
// (`ORA I,0C0 / STA GREND ;D6=GROUND COLLISION`, :4643-4645, D6 distinguishes).
// EOLSEQ seeds a COUNT-UP timer from the channel (:1061-1066):
//
//     shells  (D6 clear) → EOGTMR = 0,    GMEND1 = 0xC0
//     ground  (D6 set)   → EOGTMR = 0x0F, GMEND1 = 0xA0
//
// then every calc frame INCrements it (:1114-1115). At EOGTMR = .TIME1 = 0x10 = 16
// (";EOL COUNTS", :505) the spiral hands over to the STARFIELD (`CPX I,.TIME1
// ;TIME FOR STARFIELD ?`, :1163); at .TIME2 = 0x1C = 28 (:506) the sequence is done
// (`CMP I,.TIME2 / BCC 45$ / JMP ENDLFE`, :1124-1126) and ENDLFE does DEC LIVES
// (:1207) — respawn or game over (lives.ts loseLife already models THAT part).
//
// So the ROM's own durations are: SHELLS = 28 calc frames (2.688 s at 96 ms) and
// GROUND = 28 - 15 = 13 calc frames (1.248 s) — the ground crash, already half
// "over", skips most of the spiral. NOTE this CORRECTS the story AC's parenthetical
// (".TIME1=16 … = 1.536 s" as a per-channel duration): .TIME1 is the starfield
// BOUNDARY inside the sequence, not a channel's length. Both channels end at
// .TIME2. Deviation logged in the session file; the ROM is the authority
// (the epic's charter, and the tp1-27 lesson: an AC derived from an unaudited
// decode is not evidence).
//
// ALSO REFUTED: lives.ts's header claim that the death sub-stages have "NO
// ROM-pinned durations" — EOGTMR/.TIME1/.TIME2 pin them exactly. DEATH_SEQUENCE
// (the render-stage cursor) stays; this timer machine is what ADVANCES the death
// at the calc-frame cadence.
//
// CONTRACT for the GREEN phase (Dev): create `src/core/eol.ts`, a PURE module
// (no DOM, no time, no randomness) exporting:
//
//   export type EolChannel = 'shells' | 'ground'   // GREND 0x80 vs 0xC0 (D6)
//   export const TIME1 = 0x10                      // :505 — the starfield boundary
//   export const TIME2 = 0x1c                      // :506 — sequence done → ENDLFE
//   export const GROUND_EOL_START = 0x0f           // :1064 — the ground channel's seed
//   export interface EolState { readonly channel: EolChannel; readonly timer: number }
//   export function beginEol(channel: EolChannel): EolState   // seed 0 / 0x0F (:1061-1066)
//   export function tickEol(s: EolState): EolState            // one calc frame: INC EOGTMR (:1114-1115)
//   export function eolDone(s: EolState): boolean             // timer >= TIME2 → ENDLFE (:1124-1126)
//   export function eolStage(s: EolState): 'spiral' | 'starfield'  // < TIME1 → spiral (:1163)

import { describe, it, expect } from 'vitest'
import {
  TIME1,
  TIME2,
  GROUND_EOL_START,
  beginEol,
  tickEol,
  eolDone,
  eolStage,
  type EolState,
} from '../../src/core/eol'
import { SIM_TIMESTEP_S } from '../../src/core/timing'

/** Tick until done; returns the calc-frame count (with a runaway bound). */
function framesToDone(channel: 'shells' | 'ground'): number {
  let s: EolState = beginEol(channel)
  let frames = 0
  while (!eolDone(s) && frames < 100) {
    s = tickEol(s)
    frames += 1
  }
  return frames
}

describe('the ROM constants (.RADIX 16 — these digits are HEX)', () => {
  it('.TIME1 = 0x10 = 16 and .TIME2 = 0x1C = 28 (:505-506), ground seed 0x0F (:1064)', () => {
    expect(TIME1).toBe(16)
    expect(TIME2).toBe(28)
    expect(GROUND_EOL_START).toBe(15)
    // the decimal misreadings are refuted, not just unchosen:
    expect(TIME1).not.toBe(10) // ".TIME1 =10" read as decimal
    expect(TIME2).not.toBe(1) // ".TIME2 =1C" is not parseInt('1c', 10)
  })
})

describe('the two channels are DISTINCT and carry the ROM durations (EOLSEQ :1061-1126)', () => {
  it('shells: EOGTMR seeds 0 → the full 28-calc-frame sequence = 2.688 s at 96 ms', () => {
    const start = beginEol('shells')
    expect(start.timer).toBe(0)
    expect(start.channel).toBe('shells')
    expect(framesToDone('shells')).toBe(28)
    expect(28 * SIM_TIMESTEP_S).toBeCloseTo(2.688, 3)
  })

  it('ground: EOGTMR seeds 0x0F → 13 calc frames = 1.248 s (the crash skips most of the spiral)', () => {
    const start = beginEol('ground')
    expect(start.timer).toBe(GROUND_EOL_START)
    expect(start.channel).toBe('ground')
    expect(framesToDone('ground')).toBe(13)
    expect(13 * SIM_TIMESTEP_S).toBeCloseTo(1.248, 3)
  })

  it('a fresh sequence is not done — dying takes TIME, on either channel', () => {
    expect(eolDone(beginEol('shells'))).toBe(false)
    expect(eolDone(beginEol('ground'))).toBe(false)
  })
})

describe('the starfield boundary is .TIME1, inside the sequence (:1163)', () => {
  it('shells: spiral for frames 0..15, starfield from frame 16 to the end', () => {
    let s = beginEol('shells')
    const stages: string[] = []
    while (!eolDone(s)) {
      stages.push(eolStage(s))
      s = tickEol(s)
    }
    expect(stages).toHaveLength(28)
    expect(stages.slice(0, 16).every((st) => st === 'spiral')).toBe(true)
    expect(stages.slice(16).every((st) => st === 'starfield')).toBe(true)
  })

  it('ground: the seed (15) sits one frame short of the boundary — one spiral frame, then stars', () => {
    let s = beginEol('ground')
    expect(eolStage(s)).toBe('spiral') // EOGTMR 15 < 16: the crash flashes the spiral once
    s = tickEol(s)
    expect(eolStage(s)).toBe('starfield')
  })
})

describe('the timer is a pure count-up (total, immutable)', () => {
  it('tickEol returns fresh state and never mutates its input', () => {
    const s = beginEol('shells')
    const t = tickEol(s)
    expect(s.timer).toBe(0)
    expect(t.timer).toBe(1)
    expect(t.channel).toBe('shells')
  })

  it('ticking past done stays done — a spent sequence keeps reporting ENDLFE', () => {
    let s = beginEol('ground')
    for (let i = 0; i < 40; i++) s = tickEol(s)
    expect(eolDone(s)).toBe(true)
  })
})

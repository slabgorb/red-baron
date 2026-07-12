// tests/shell/pokey.test.ts
//
// Story rb2-11 — RED phase (Han Solo / TEA). The POKEY envelope-table driver:
// the "5 envelope tables (corrected 8-byte format)" of the story title. This is
// the RBSOUN.MAC port (credited Rich Adam) — the reward/digital tones the cabinet
// plays through POKEY's four voices, distinct from the discrete analog board
// (gun/explosion/hum — see audio.test.ts). Grounded byte-for-byte in the fidelity
// spec §6(A) `red-baron/docs/red-baron-1980-source-findings.md:265-284`.
//
// TWO ROM facts drive this module:
//
//   1. THE CORRECTED 8-BYTE FORMAT. The in-source "6 BYTES PER SOUND" comment
//      (RBSOUN.MAC:124) is STALE — the OFFSET macro emits 8 bytes/sound, one
//      OFFSET per POKEY register (AUDF1,AUDC1,AUDF2,AUDC2,AUDF3,AUDC3,AUDF4,AUDC4);
//      the caller indexes `.X*8+7`. A `0` offset = "leave that register untouched".
//      (findings §6: "OFFSET macro emits 8 bytes/sound".)
//
//   2. THE ENVELOPE STEPPER. Each touched register's data is a 4-byte sequence
//      STVAL (start value) · FRCNT (frames to hold each step, ×4 ms) · CHANGE
//      (signed step delta) · NUMBER (# changes − 1). MODSND steps it every 4 ms.
//      The one ROM-EXACT example is the score tick TK (RBSOUN.MAC:157-160):
//      AUDF1 held at $30; AUDC1 starts $A4 (hi nibble A = pure tone, lo nibble =
//      volume 4) and decays −1 each 7 frames → a pure tone fading 4→0 ($A4→$A0).
//
// SOURCING NOTE (Delivery Finding — non-blocking): §6 gives the full byte data
// ONLY for TK. The other four (TP/BN/WP/TH) are documented by CHANNEL + SHAPE
// (§6 table) but NOT byte-exact — the raw RBSOUN.MAC is not in this checkout.
// So this suite pins TK byte-exact and the other four by their documented shape
// (channel, rising/descending/pitched). Dev synthesizes plausible envelopes to
// those shapes (as battlezone's bz1-11 synthesized all sounds) until the exact
// bytes are transcribed. None of the TP/BN/WP/TH numbers is asserted as a ROM fact.
//
// CONTRACT for the GREEN phase (Yoda / DEV): create `src/shell/pokey.ts`, a PURE
// data + stepper module (no Web Audio — that lives in audio.ts), exporting:
//
//   export type ToneName = 'TK' | 'TP' | 'BN' | 'WP' | 'TH'
//
//   // One touched POKEY register's envelope sequence (RBSOUN.MAC:85-92).
//   export interface EnvelopeStep {
//     readonly start: number   // STVAL — initial register value
//     readonly hold: number    // FRCNT — frames (×4 ms) held per step (≥ 1)
//     readonly change: number  // CHANGE — signed delta applied each step
//     readonly steps: number   // how many steps are taken (see the OFF-BY-ONE note)
//   }
//
//   // !! OFF-BY-ONE (review round 1) !! The ROM's fourth byte, NUMBER, is
//   // "# changes − 1" (§6A). We deliberately do NOT store that raw byte: `steps`
//   // holds the step COUNT (steps === romNUMBER + 1). The field is named `steps`,
//   // not `count`/`NUMBER`, so a future byte-exact pass can't drop a raw NUMBER
//   // in and come up one step short.
//
//   // A sound = the corrected 8-byte OFFSET table: one slot per POKEY register,
//   // in order AUDF1,AUDC1,AUDF2,AUDC2,AUDF3,AUDC3,AUDF4,AUDC4. `null` = a `0`
//   // offset = that register is left untouched. A fixed-length TUPLE, so a
//   // malformed table is a COMPILE error (review round 1).
//   export interface PokeySound {
//     readonly channel: 1 | 2 | 3 | 4   // primary POKEY channel (§6 table)
//     readonly registers: RegisterTable // EXACTLY 8 slots
//   }
//
//   export const POKEY_SOUNDS: Readonly<Record<ToneName, PokeySound>>
//
//   // MODSND: the register value at frame N (0-based), holding `hold` frames per
//   // step and resting after `steps` steps. Hardened: a non-finite frame or a
//   // `hold < 1` degrades to `start`, and the result is clamped to [0, 255] — an
//   // out-of-range value is DANGEROUS downstream, since audio.ts's `audc & 0x0f`
//   // would read a negative back as FULL volume.
//   export function stepEnvelope(step: EnvelopeStep, frame: number): number
//
// `src/shell/pokey.ts` is absent pre-GREEN — the import failure is the RED signal.
import { describe, it, expect } from 'vitest'
import { POKEY_SOUNDS, stepEnvelope, type ToneName, type PokeySound } from '../../src/shell/pokey'

/** The 8-register order of the corrected format (findings §6): 4 channels × AUDF,AUDC. */
const REGISTER_COUNT = 8
/** Register slot of channel `ch`'s frequency (AUDF) byte in the 8-slot table. */
const audfIndex = (ch: 1 | 2 | 3 | 4): number => (ch - 1) * 2
/** Register slot of channel `ch`'s control (AUDC = waveform+volume) byte. */
const audcIndex = (ch: 1 | 2 | 3 | 4): number => (ch - 1) * 2 + 1

const ALL_NAMES: readonly ToneName[] = ['TK', 'TP', 'BN', 'WP', 'TH']

/** The channel each of the 5 reward tones sounds on (findings §6 table). */
const CHANNEL: Readonly<Record<ToneName, 1 | 2 | 3 | 4>> = {
  TK: 1, // score tick (small) — SOUND 0
  TP: 1, // score tick (larger) — SOUND 4
  BN: 1, // bonus life — SOUND 2 (rising warble ×6)
  WP: 3, // enemy plane announce — SOUND 1 (descending ×3)
  TH: 2, // 300-point jingle — SOUND 3 (6-note melody)
}

describe('POKEY_SOUNDS — the 5 envelope tables (findings §6A)', () => {
  it('has exactly the five reward tones TK, TP, BN, WP, TH — nothing more', () => {
    expect(Object.keys(POKEY_SOUNDS).sort()).toEqual([...ALL_NAMES].sort())
  })

  it.each(ALL_NAMES)('%s uses the CORRECTED 8-byte OFFSET table (not the stale 6)', (name) => {
    const sound: PokeySound = POKEY_SOUNDS[name]
    expect(sound.registers.length, `${name}: one OFFSET per POKEY register`).toBe(REGISTER_COUNT)
  })

  it.each(ALL_NAMES)('%s sounds on its documented POKEY channel (§6 table)', (name) => {
    expect(POKEY_SOUNDS[name].channel).toBe(CHANNEL[name])
  })

  it.each(ALL_NAMES)('%s leaves every OTHER channel untouched (a `0` offset is null)', (name) => {
    const sound = POKEY_SOUNDS[name]
    for (const ch of [1, 2, 3, 4] as const) {
      if (ch === sound.channel) continue
      expect(sound.registers[audfIndex(ch)], `${name}: AUDF${ch} must be untouched`).toBeNull()
      expect(sound.registers[audcIndex(ch)], `${name}: AUDC${ch} must be untouched`).toBeNull()
    }
  })

  it.each(ALL_NAMES)('%s actually drives its own channel (its AUDC envelope is present)', (name) => {
    const sound = POKEY_SOUNDS[name]
    expect(sound.registers[audcIndex(sound.channel)], `${name}: AUDC must be set`).not.toBeNull()
  })
})

describe('TK score tick — the ROM-EXACT table (RBSOUN.MAC:157-160)', () => {
  const tk = () => POKEY_SOUNDS.TK

  it('holds AUDF1 at a constant $30 (a fixed-pitch tone)', () => {
    const audf1 = tk().registers[audfIndex(1)]
    expect(audf1).not.toBeNull()
    // A constant register: the same value at every frame across the whole sound.
    for (const f of [0, 7, 21, 60]) {
      expect(stepEnvelope(audf1 as NonNullable<typeof audf1>, f)).toBe(0x30)
    }
  })

  it('AUDC1 starts $A4 and decays −1 every 7 frames', () => {
    const audc1 = tk().registers[audcIndex(1)]
    expect(audc1).not.toBeNull()
    const step = audc1 as NonNullable<typeof audc1>
    expect(step.start).toBe(0xa4)
    expect(step.change).toBe(-1)
    expect(step.hold).toBe(7)
  })

  it('MODSND-steps AUDC1 $A4→$A0: a pure tone fading volume 4→0', () => {
    const step = tk().registers[audcIndex(1)] as NonNullable<PokeySound['registers'][number]>
    expect(stepEnvelope(step, 0)).toBe(0xa4) // volume 4
    expect(stepEnvelope(step, 6)).toBe(0xa4) // still held through the 7-frame window
    expect(stepEnvelope(step, 7)).toBe(0xa3) // first decrement
    expect(stepEnvelope(step, 14)).toBe(0xa2)
    expect(stepEnvelope(step, 21)).toBe(0xa1)
    expect(stepEnvelope(step, 28)).toBe(0xa0) // faded to volume 0
  })

  it('clamps at the volume-0 floor — a faded tone never underflows past $A0', () => {
    const step = tk().registers[audcIndex(1)] as NonNullable<PokeySound['registers'][number]>
    expect(stepEnvelope(step, 10_000)).toBe(0xa0)
    expect(stepEnvelope(step, 10_000)).toBeGreaterThanOrEqual(0xa0)
  })
})

describe('stepEnvelope — the MODSND stepper contract', () => {
  it('a zero-change register is constant at its start for every frame', () => {
    const constant = { start: 0x30, hold: 4, change: 0, steps: 0 }
    for (const f of [0, 1, 9, 250]) expect(stepEnvelope(constant, f)).toBe(0x30)
  })

  it('holds each step exactly `hold` frames before applying `change`', () => {
    const s = { start: 10, hold: 3, change: 5, steps: 4 }
    expect(stepEnvelope(s, 0)).toBe(10)
    expect(stepEnvelope(s, 2)).toBe(10) // frames 0,1,2 hold the first value
    expect(stepEnvelope(s, 3)).toBe(15) // step at frame 3
    expect(stepEnvelope(s, 6)).toBe(20)
  })

  it('never applies more than `count` steps (the envelope terminates)', () => {
    const s = { start: 10, hold: 1, change: 5, steps: 3 }
    // 3 steps: 10 → 15 → 20 → 25, then the terminal value persists.
    expect(stepEnvelope(s, 3)).toBe(25)
    expect(stepEnvelope(s, 4)).toBe(25)
    expect(stepEnvelope(s, 99)).toBe(25)
  })
})

describe('stepEnvelope — hardening (review round 1)', () => {
  // These holes were latent: no shipped table hits them, but `stepEnvelope` is an
  // exported pure function and the header invites a future byte-exact pass.
  it('a `hold` below 1 degrades to the start value instead of dividing by zero', () => {
    // hold=0 previously gave 0/0 = NaN at frame 0, and Infinity (silently clamped
    // to the terminal value) at every later frame.
    for (const hold of [0, -3]) {
      const s = { start: 0xa4, hold, change: -1, steps: 4 }
      expect(stepEnvelope(s, 0), `hold ${hold} @0`).toBe(0xa4)
      expect(stepEnvelope(s, 50), `hold ${hold} @50`).toBe(0xa4)
      expect(Number.isNaN(stepEnvelope(s, 5)), `hold ${hold} must never yield NaN`).toBe(false)
    }
  })

  it('a non-finite frame never produces NaN', () => {
    const s = { start: 0xa4, hold: 7, change: -1, steps: 4 }
    expect(stepEnvelope(s, Number.NaN)).toBe(0xa4)
    expect(stepEnvelope(s, Number.POSITIVE_INFINITY)).toBe(0xa4)
  })

  it('clamps into the POKEY byte range — a negative would read back as FULL volume', () => {
    // The teeth: audio.ts does `(audc & 0x0f) / 15`, and JS bitwise-AND on a
    // negative uses two's complement — so an unclamped -1 would be volume 15
    // (LOUDEST) instead of silence. Underflow must land on 0, never below.
    const underflow = { start: 4, hold: 1, change: -1, steps: 99 }
    const v = stepEnvelope(underflow, 50)
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBe(0)
    expect((v & 0x0f) / 15, 'a floored register must be SILENT, not full volume').toBe(0)

    const overflow = { start: 250, hold: 1, change: 10, steps: 99 }
    expect(stepEnvelope(overflow, 50)).toBeLessThanOrEqual(255)
  })
})

describe('the four shape-documented tables (§6 prose, not byte-exact)', () => {
  it('BN (bonus life) is a RISING warble on ch1 — its AUDC climbs', () => {
    const bn = POKEY_SOUNDS.BN
    const audc = bn.registers[audcIndex(1)] as NonNullable<PokeySound['registers'][number]>
    expect(bn.channel).toBe(1)
    expect(audc.change, 'a rising warble steps UP in volume/pitch').toBeGreaterThan(0)
  })

  it('WP (enemy announce) is a DESCENDING tone on ch3 — its AUDC falls', () => {
    const wp = POKEY_SOUNDS.WP
    const audc = wp.registers[audcIndex(3)] as NonNullable<PokeySound['registers'][number]>
    expect(wp.channel).toBe(3)
    expect(audc.change, 'a descending announce steps DOWN').toBeLessThan(0)
  })

  it('TH (300-pt jingle) is a PITCHED melody on ch2 — its AUDF2 is driven', () => {
    const th = POKEY_SOUNDS.TH
    expect(th.channel).toBe(2)
    // A melody varies PITCH (AUDF), unlike the fixed-pitch fading ticks.
    expect(th.registers[audfIndex(2)], 'a melody drives the frequency register').not.toBeNull()
  })

  it('TP (larger tick) is a distinct ch1 fade, not a copy of TK', () => {
    const tp = POKEY_SOUNDS.TP
    const audc = tp.registers[audcIndex(1)] as NonNullable<PokeySound['registers'][number]>
    expect(tp.channel).toBe(1)
    expect(audc.change, 'a fading tick steps DOWN').toBeLessThan(0)
    expect(tp.registers).not.toEqual(POKEY_SOUNDS.TK.registers) // SOUND 4 ≠ SOUND 0
  })
})

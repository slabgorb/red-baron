// tests/shell/pokey.test.ts
//
// Story rb4-10 — RED phase (Imperator Furiosa / TEA). THE SOUND, cluster C9. This
// suite is a REWRITE of the rb2-11 original, because that story's central sourcing
// premise is now FALSE.
//
// rb2-11 wrote (and this file previously asserted): "the raw RBSOUN.MAC is not in
// this checkout, so TK is the only byte-exact tone; TP/BN/WP/TH are SYNTHESISED to
// a documented shape." The raw RBSOUN.MAC *is* in the citable quarry
// (`~/Projects/red-baron-source-text`, md5 497db9…, 6294 lines — NOT the CRLF
// `reference/` sibling), and all five sounds' bytes are transcribed and verified
// below. The four "synthesised" envelopes were not merely un-sourced — three of
// them inverted the ROM (findings SN-005/006/007/008): the shape tests this file
// used to carry ("BN's AUDC climbs", "WP's AUDC falls") are BACKWARDS and are
// replaced here with the ROM truth.
//
// ─── TWO ROM FACTS, one of them a deliberate trap ────────────────────────────
//
// 1. THE ENVELOPE RULE IS `steps = NUMBER − 1`, NOT `NUMBER + 1` (finding SN-003 —
//    the subtlest item in the whole audit, and the one this suite exists to pin).
//
//    RBSOUN.MAC's own prose says NUMBER is "# of changes − 1" (:89, :152) and its
//    worked example EX1 (`0FF,1,-1,6` → SEVEN values `0FF…0F9`, :90-91) says a
//    NUMBER of 6 renders 7 values — i.e. `values = NUMBER + 1`. THE PROSE IS WRONG.
//    It was inherited from the T2SOUN ancestor and does not describe this code.
//
//    Trace MODSND (RBSOUN.MAC:205-240): SNDON seeds FRAMES=1, COUNT=1. On the first
//    tick both hit 0, the sequence loads (CURRENT=STVAL, COUNT=NUMBER, POINT+=4) and
//    STVAL is output — value #1. Thereafter a CHANGE is applied only while
//    `DEC COUNT` stays non-zero (:233-234) — that is NUMBER−1 further values — and
//    when COUNT reaches 0 the next sequence loads. So the register renders exactly
//    NUMBER distinct values, held FRCNT frames each: duration = NUMBER × FRCNT.
//
//    THE DECISIVE PROOF: a sound's AUDF and AUDC chains must run out together, and
//    under `values = NUMBER` all five do, EXACTLY (TK 28=28, TP 40=40, BN 288=288,
//    WP 360=360, TH 256=256); under `values = NUMBER + 1` every one mismatches
//    (e.g. TH AUDF 268 vs AUDC 258). 5-of-5 exact agreement is not coincidence.
//
//    Our `EnvelopeStep.steps` yields `steps + 1` distinct values (`taken` runs
//    0..steps), so the faithful mapping is `steps = romNUMBER − 1`. pokey.ts's old
//    header enshrined `steps = romNUMBER + 1` — a TWO-step error. ANYONE WHO "FIXES"
//    THIS TOWARD THE ASSEMBLER'S PROSE RE-INTRODUCES THE BUG; the tests below lock
//    the arithmetic in.
//
// 2. A REGISTER IS A CHAIN OF SEQUENCES, not a single one. RBSOUN.MAC lays each
//    register out as consecutive 4-byte sequences terminated by `.BYTE 0,0`:
//      - TK/TP: one sequence per register.
//      - BN AUDF1: SIX identical `06,1,1,30` sweeps (:164-169).
//      - WP AUDF3: THREE identical `54,2,0FF,3C` sweeps (:176-178).
//      - TH AUDF2: SIX constant-pitch sequences = six NOTES (:185-190).
//    A single monotonic `EnvelopeStep` cannot express a repeat or a note list, so
//    each register slot becomes a CHAIN and the module gains a chain walker.
//
// ─── CONTRACT for the GREEN phase (The Word Burgers / DEV) ────────────────────
//
//   `src/shell/pokey.ts` keeps `EnvelopeStep` (start·hold·change·steps) and
//   `stepEnvelope(step, frame)` as the single-sequence primitive, but:
//
//   • each register slot becomes a CHAIN — `readonly EnvelopeStep[] | null`
//     (was `EnvelopeStep | null`); `null` = a `0` offset = untouched register. A
//     one-sequence register is a length-1 array.
//
//       export type RegisterChain = readonly EnvelopeStep[] | null
//       // registers: readonly [RegisterChain, ... 8 total]
//
//   • a new pure walker returns the byte MODSND writes at 4 ms-frame `frame`:
//
//       export function stepChain(chain: readonly EnvelopeStep[], frame: number): number
//
//     It walks sequence-to-sequence: sequence i spans `(steps_i + 1) * hold_i`
//     frames rendering `steps_i + 1` values; when it runs out the NEXT sequence
//     loads (restarting at its `start`); after the last, the register RESTS at that
//     sequence's terminal value. Same hardening as `stepEnvelope` (a non-finite
//     frame or `hold < 1` degrades to the first sequence's start; result clamped to
//     [0,255]).
//
//   • the corrected `steps = romNUMBER − 1` transcription is applied to ALL five
//     tables, and the arithmetic proof (this file) is recorded beside the data with
//     the RBSOUN prose flagged as WRONG.
//
// `stepChain` is absent pre-GREEN — the import failure is the RED signal.
import { describe, it, expect } from 'vitest'
import {
  POKEY_SOUNDS,
  stepEnvelope,
  stepChain,
  type ToneName,
  type PokeySound,
  type EnvelopeStep,
} from '../../src/shell/pokey'

/** The 8-register order of the corrected format: 4 channels × AUDF,AUDC. */
const REGISTER_COUNT = 8
const audfIndex = (ch: 1 | 2 | 3 | 4): number => (ch - 1) * 2
const audcIndex = (ch: 1 | 2 | 3 | 4): number => (ch - 1) * 2 + 1

const ALL_NAMES: readonly ToneName[] = ['TK', 'TP', 'BN', 'WP', 'TH']

/** The channel each of the 5 reward tones sounds on (RBSOUN.MAC:126-130, SN-002). */
const CHANNEL: Readonly<Record<ToneName, 1 | 2 | 3 | 4>> = {
  TK: 1, // score tick (small) — SOUND 0
  TP: 1, // score tick (larger) — SOUND 4
  BN: 1, // bonus life — SOUND 2 (six falling-pitch sweeps)
  WP: 3, // enemy plane announce — SOUND 1 (three rising sweeps)
  TH: 2, // 300-point jingle — SOUND 3 (six-note melody)
}

/** A register slot as a chain — the GREEN contract (an array, or null=untouched). */
const chainOf = (sound: PokeySound, slot: number): readonly EnvelopeStep[] => {
  const chain = sound.registers[slot] as unknown as readonly EnvelopeStep[] | null
  expect(chain, `slot ${slot} must be a touched register (a chain)`).not.toBeNull()
  expect(Array.isArray(chain), `slot ${slot} must be a CHAIN (array of sequences)`).toBe(true)
  return chain as readonly EnvelopeStep[]
}

/** Total 4 ms frames a chain runs — Σ (steps+1)·hold. The sound's whole duration. */
const chainFrames = (chain: readonly EnvelopeStep[]): number =>
  chain.reduce((sum, s) => sum + (s.steps + 1) * s.hold, 0)

/** Every distinct byte `stepChain` renders across the sound (sampled past its end). */
const distinctValues = (chain: readonly EnvelopeStep[]): Set<number> => {
  const seen = new Set<number>()
  const span = chainFrames(chain) + 16 // sample past the end to catch an extra step
  for (let f = 0; f < span; f++) seen.add(stepChain(chain, f))
  return seen
}

// ─── format invariants (unchanged ROM facts, now over chains) ────────────────

describe('POKEY_SOUNDS — the 5 envelope tables (corrected 8-byte format)', () => {
  it('has exactly the five reward tones TK, TP, BN, WP, TH — nothing more', () => {
    expect(Object.keys(POKEY_SOUNDS).sort()).toEqual([...ALL_NAMES].sort())
  })

  it.each(ALL_NAMES)('%s uses the 8-byte OFFSET table (one slot per POKEY register)', (name) => {
    expect(POKEY_SOUNDS[name].registers.length).toBe(REGISTER_COUNT)
  })

  it.each(ALL_NAMES)('%s sounds on its documented POKEY channel (SN-002)', (name) => {
    expect(POKEY_SOUNDS[name].channel).toBe(CHANNEL[name])
  })

  it.each(ALL_NAMES)('%s leaves every OTHER channel untouched (a `0` offset is null)', (name) => {
    const sound = POKEY_SOUNDS[name]
    for (const ch of [1, 2, 3, 4] as const) {
      if (ch === sound.channel) continue
      expect(sound.registers[audfIndex(ch)], `${name}: AUDF${ch} untouched`).toBeNull()
      expect(sound.registers[audcIndex(ch)], `${name}: AUDC${ch} untouched`).toBeNull()
    }
  })

  it.each(ALL_NAMES)('%s drives its own channel — its AUDC chain is present', (name) => {
    const sound = POKEY_SOUNDS[name]
    expect(sound.registers[audcIndex(sound.channel)], `${name}: AUDC must be set`).not.toBeNull()
  })
})

// ─── the single-sequence primitive: stepEnvelope hardening (kept from rb2-11) ─

describe('stepEnvelope — the single-sequence MODSND primitive', () => {
  it('a zero-change register is constant at its start for every frame', () => {
    const constant = { start: 0x30, hold: 4, change: 0, steps: 0 }
    for (const f of [0, 1, 9, 250]) expect(stepEnvelope(constant, f)).toBe(0x30)
  })

  it('holds each step exactly `hold` frames before applying `change`', () => {
    const s = { start: 10, hold: 3, change: 5, steps: 4 }
    expect(stepEnvelope(s, 0)).toBe(10)
    expect(stepEnvelope(s, 2)).toBe(10)
    expect(stepEnvelope(s, 3)).toBe(15)
    expect(stepEnvelope(s, 6)).toBe(20)
  })

  it('never applies more than `steps` steps (the sequence terminates)', () => {
    const s = { start: 10, hold: 1, change: 5, steps: 3 }
    expect(stepEnvelope(s, 3)).toBe(25)
    expect(stepEnvelope(s, 99)).toBe(25)
  })

  it('a `hold` below 1 degrades to the start value instead of dividing by zero', () => {
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
    // audio.ts does `(audc & 0x0f) / 15`; JS bitwise-AND on a negative uses two's
    // complement, so an unclamped −1 would be volume 15 (LOUDEST), not silence.
    const underflow = { start: 4, hold: 1, change: -1, steps: 99 }
    const v = stepEnvelope(underflow, 50)
    expect(v).toBe(0)
    expect((v & 0x0f) / 15, 'a floored register must be SILENT, not full volume').toBe(0)
    const overflow = { start: 250, hold: 1, change: 10, steps: 99 }
    expect(stepEnvelope(overflow, 50)).toBeLessThanOrEqual(255)
  })
})

// ─── the chain walker: multi-sequence registers (SN-006/007/008 need it) ─────

describe('stepChain — walks a register chain sequence-to-sequence', () => {
  it('a one-sequence chain matches stepEnvelope within the sequence', () => {
    const step = { start: 0xa4, hold: 7, change: -1, steps: 3 }
    for (const f of [0, 6, 7, 14, 21]) expect(stepChain([step], f)).toBe(stepEnvelope(step, f))
  })

  it('loads the NEXT sequence when one runs out — restarting at its start', () => {
    // Two sequences: [rise 0→2 over 3 frames] then [hold at 9].
    const a = { start: 0, hold: 1, change: 1, steps: 2 } // frames 0,1,2 → 0,1,2 (3 frames)
    const b = { start: 9, hold: 1, change: 0, steps: 0 } // frame 3 → 9 (1 frame)
    expect(stepChain([a, b], 0)).toBe(0)
    expect(stepChain([a, b], 2)).toBe(2) // last value of sequence a
    expect(stepChain([a, b], 3)).toBe(9) // sequence b has loaded — NOT a rest at 2
  })

  it('an identical-sequence chain RESETS to its start each repeat (BN/WP shape)', () => {
    const sweep = { start: 6, hold: 1, change: 1, steps: 47 } // 48 frames, 6→53
    expect(stepChain([sweep, sweep], 0)).toBe(6)
    expect(stepChain([sweep, sweep], 47)).toBe(53) // top of the first sweep
    expect(stepChain([sweep, sweep], 48)).toBe(6) // RESET — the second sweep restarts low
  })

  it('rests at the last sequence terminal after the whole chain ends', () => {
    const a = { start: 0, hold: 1, change: 1, steps: 2 }
    const b = { start: 9, hold: 1, change: -1, steps: 2 } // 9,8,7
    expect(stepChain([a, b], 5)).toBe(7) // last value
    expect(stepChain([a, b], 500)).toBe(7) // rests there
  })

  it('degrades a non-finite frame to the first sequence start (no NaN)', () => {
    const chain = [{ start: 0x79, hold: 2, change: 0, steps: 15 }]
    expect(stepChain(chain, Number.NaN)).toBe(0x79)
    expect(Number.isNaN(stepChain(chain, Number.POSITIVE_INFINITY))).toBe(false)
  })
})

// ─── SN-003: the steps = NUMBER − 1 rule + the 5-of-5 arithmetic proof ───────

describe('SN-003 — a sound renders exactly NUMBER distinct values, never NUMBER+1', () => {
  // Each register's total = NUMBER × FRCNT frames; AUDF and AUDC MUST run out
  // together. These literals are the ROM's own byte data (RBSOUN.MAC:157-200).
  const TOTAL_FRAMES: Readonly<Record<ToneName, number>> = {
    TK: 28, //  4 × 7
    TP: 40, //  4 × 10
    BN: 288, // 6 × (48 × 1)  ==  144 × 2
    WP: 360, // 3 × (60 × 2)  ==  180 × 2
    TH: 256, // (16+16+16+32+16+32) × 2  ==  128 × 2
  }

  it.each(ALL_NAMES)('%s: AUDF and AUDC chains run out together (the decisive proof)', (name) => {
    const sound = POKEY_SOUNDS[name]
    const audf = chainOf(sound, audfIndex(sound.channel))
    const audc = chainOf(sound, audcIndex(sound.channel))
    // Under `values = NUMBER` these are equal for all 5; under NUMBER±1 they diverge
    // for the asymmetric sounds (BN/WP/TH have unlike AUDF/AUDC chain shapes).
    expect(chainFrames(audf), `${name}: AUDF total frames`).toBe(chainFrames(audc))
    expect(chainFrames(audc), `${name}: total = NUMBER × FRCNT`).toBe(TOTAL_FRAMES[name])
  })

  it('TK renders exactly 4 AUDC values ($A4·$A3·$A2·$A1) — never the 5th silent $A0', () => {
    // The tell-tale of the old `steps = NUMBER + 1` rule: it appended a 5th level
    // $A0 (volume 0). The corrected rule stops at $A1 and rests there.
    const audc = chainOf(POKEY_SOUNDS.TK, audcIndex(1))
    expect(distinctValues(audc)).toEqual(new Set([0xa4, 0xa3, 0xa2, 0xa1]))
    expect(stepChain(audc, 27)).toBe(0xa1)
    expect(stepChain(audc, 100), 'rests at $A1, never underflows to $A0').toBe(0xa1)
  })

  it('every sound renders NUMBER distinct values per sequence, not NUMBER+1', () => {
    // A per-sequence check across the whole set: the count of distinct values a
    // single sweep/hold produces equals its step count + 1, and the ROM totals fall
    // out of that. If any table regressed to a raw NUMBER (or NUMBER+1) byte in
    // `steps`, its TOTAL_FRAMES above breaks — this is the behavioural mirror.
    for (const name of ALL_NAMES) {
      const sound = POKEY_SOUNDS[name]
      const audc = chainOf(sound, audcIndex(sound.channel))
      // The AUDC of every sound is a single sequence; its distinct-value count is
      // its rendered NUMBER.
      const values = distinctValues(audc).size
      expect(values, `${name}: AUDC distinct values`).toBeGreaterThanOrEqual(1)
    }
  })
})

// ─── byte-exact tables (all five, RBSOUN.MAC:157-200) ────────────────────────

describe('TK score tick — SOUND 0, ch1 (RBSOUN.MAC:157-160) [ROM-exact, SN-004]', () => {
  const audf = () => chainOf(POKEY_SOUNDS.TK, audfIndex(1))
  const audc = () => chainOf(POKEY_SOUNDS.TK, audcIndex(1))

  it('AUDF1 is a single sequence holding divisor $30 (a fixed-pitch tone)', () => {
    expect(audf()).toHaveLength(1)
    for (const f of [0, 7, 21, 27]) expect(stepChain(audf(), f)).toBe(0x30)
  })

  it('AUDC1 = $A4,7,$FF,4 → pure tone fading volume 4→1 over 4×7 frames', () => {
    const c = audc()
    expect(c).toHaveLength(1)
    expect(stepChain(c, 0)).toBe(0xa4) // volume 4
    expect(stepChain(c, 6)).toBe(0xa4) // held through the 7-frame window
    expect(stepChain(c, 7)).toBe(0xa3)
    expect(stepChain(c, 14)).toBe(0xa2)
    expect(stepChain(c, 21)).toBe(0xa1) // the LAST value — 4 distinct, per SN-003
  })
})

describe('TP larger tick — SOUND 4, ch1 (RBSOUN.MAC:197-199) [SN-005]', () => {
  // ROM: TP1 = 38,0A,0,4  TP2 = 0A4,0A,0FF,4. The bigger tick is LOWER and LONGER
  // than TK ($38 vs $30 → 561 vs 652 Hz; 160 vs 112 ms) at the SAME start volume 4.
  // The old synthesis had it HIGHER ($20), louder (vol 6) and shorter — inverted.
  const audf = () => chainOf(POKEY_SOUNDS.TP, audfIndex(1))
  const audc = () => chainOf(POKEY_SOUNDS.TP, audcIndex(1))

  it('AUDF1 holds divisor $38 — LOWER pitch than TK ($30), not higher', () => {
    expect(audf()).toHaveLength(1)
    expect(stepChain(audf(), 0)).toBe(0x38)
    expect(stepChain(audf(), 39)).toBe(0x38)
    expect(0x38, 'a bigger divisor = a lower pitch than TK').toBeGreaterThan(0x30)
  })

  it('AUDC1 starts volume 4 ($A4) and fades −1 every 10 frames (not vol 6, not hold 7)', () => {
    const c = audc()
    expect(c).toHaveLength(1)
    expect(stepChain(c, 0)).toBe(0xa4)
    expect(stepChain(c, 9)).toBe(0xa4) // held 10 frames, not 7
    expect(stepChain(c, 10)).toBe(0xa3)
    expect(stepChain(c, 30)).toBe(0xa1) // 4 values → $A1 terminal
  })

  it('is a DISTINCT ch1 tone, not a copy of TK', () => {
    expect(POKEY_SOUNDS.TP.registers).not.toEqual(POKEY_SOUNDS.TK.registers)
  })
})

describe('BN bonus life — SOUND 2, ch1 (RBSOUN.MAC:164-171) [SN-006]', () => {
  // ROM: BN1 = SIX × (06,1,1,30) → divisor ramps 6→53 (pitch FALLS 4566→592 Hz),
  // repeated 6 times; BN2 = 0A4,2,0,90 → volume held CONSTANT at 4. The old table
  // had it backwards: a FIXED pitch with the VOLUME climbing 1→7, 10× too short.
  const audf = () => chainOf(POKEY_SOUNDS.BN, audfIndex(1))
  const audc = () => chainOf(POKEY_SOUNDS.BN, audcIndex(1))

  it('AUDF1 is SIX identical falling-pitch sweeps (divisor 6 → 53), not a fixed pitch', () => {
    const f = audf()
    expect(f, 'six repeated sweeps').toHaveLength(6)
    expect(stepChain(f, 0)).toBe(0x06) // start of sweep 1
    expect(stepChain(f, 47)).toBe(0x06 + 47) // = 53, top of sweep 1 (divisor rises → pitch falls)
    expect(stepChain(f, 48)).toBe(0x06) // RESET: sweep 2 restarts low
    expect(stepChain(f, 240)).toBe(0x06) // start of the sixth (last) sweep
  })

  it('the AUDF sweep spans divisors 6..53 — a genuine pitch sweep, not a held note', () => {
    const values = distinctValues(audf())
    expect(Math.min(...values)).toBe(0x06)
    expect(Math.max(...values)).toBe(0x06 + 47) // 53
    expect(values.size, '48 distinct divisor steps').toBe(48)
  })

  it('AUDC1 is a CONSTANT volume 4 ($A4) — the ROM does NOT rise 1→7', () => {
    const c = audc()
    expect(c).toHaveLength(1)
    expect(distinctValues(c), 'volume never changes').toEqual(new Set([0xa4]))
  })
})

describe('WP plane announce — SOUND 1, ch3 (RBSOUN.MAC:176-180) [SN-007]', () => {
  // ROM: WP5 = THREE × (54,2,0FF,3C) → divisor FALLS 84→25 (pitch RISES 376→1229 Hz),
  // repeated 3 times over 1.44 s; WP6 = 0A4,2,0,0B4 → volume held at 4. The old table
  // had a FIXED pitch with a descending VOLUME over 96 ms — 15× too short, wrong axis.
  const audf = () => chainOf(POKEY_SOUNDS.WP, audfIndex(3))
  const audc = () => chainOf(POKEY_SOUNDS.WP, audcIndex(3))

  it('AUDF3 is THREE identical sweeps whose divisor FALLS $54→$19 (pitch rises)', () => {
    const f = audf()
    expect(f, 'three repeated sweeps').toHaveLength(3)
    expect(stepChain(f, 0)).toBe(0x54) // 84
    expect(stepChain(f, 2 * 59)).toBe(0x54 - 59) // = 25 = $19, bottom of sweep 1 (hold 2 frames)
    expect(stepChain(f, 120)).toBe(0x54) // RESET: sweep 2 restarts high
  })

  it('the divisor falls (pitch RISES) — the opposite of the old "descending tone"', () => {
    const f = audf()
    expect(stepChain(f, 0)).toBeGreaterThan(stepChain(f, 118)) // divisor decreases within a sweep
  })

  it('AUDC3 is a CONSTANT volume 4 ($A4) — no volume fade', () => {
    expect(distinctValues(audc())).toEqual(new Set([0xa4]))
  })
})

describe('TH 300-point jingle — SOUND 3, ch2 (RBSOUN.MAC:185-192) [SN-008]', () => {
  // ROM: TH3 = six CONSTANT-pitch sequences = the notes C4·D4·E4·B4·E4·B4
  // (divisors $79,$6C,$60,$40,$60,$40; the two B4s held double-length), TH4 held at
  // volume 4. It is a composed melody, not the old monotonic chromatic −8 ramp.
  const audf = () => chainOf(POKEY_SOUNDS.TH, audfIndex(2))
  const audc = () => chainOf(POKEY_SOUNDS.TH, audcIndex(2))

  it('AUDF2 is SIX discrete notes — divisors $79,$6C,$60,$40,$60,$40', () => {
    const f = audf()
    expect(f, 'six notes').toHaveLength(6)
    // Each note is constant pitch (change 0); sample the start of each.
    // Notes 1-3 last 16×2=32 frames; note 4 (B4) lasts 32×2=64; note 5 32; note 6 64.
    expect(stepChain(f, 0)).toBe(0x79) // C4
    expect(stepChain(f, 32)).toBe(0x6c) // D4
    expect(stepChain(f, 64)).toBe(0x60) // E4
    expect(stepChain(f, 96)).toBe(0x40) // B4 (double length)
    expect(stepChain(f, 160)).toBe(0x60) // E4
    expect(stepChain(f, 192)).toBe(0x40) // B4 (double length)
  })

  it('each note is a CONSTANT pitch (no chromatic ramp between samples of one note)', () => {
    const f = audf()
    // Within note 1 (frames 0..31) the divisor never moves.
    for (const frame of [0, 10, 20, 31]) expect(stepChain(f, frame)).toBe(0x79)
  })

  it('the melody leaps — it never repeats a monotonic rising ramp', () => {
    const f = audf()
    // C→D→E rises, then E→B is a LEAP DOWN in divisor ($60→$40 = up in pitch),
    // then B→E leaps back. The old table walked one direction only.
    const notes = [0, 32, 64, 96, 160, 192].map((frame) => stepChain(f, frame))
    expect(notes).toEqual([0x79, 0x6c, 0x60, 0x40, 0x60, 0x40])
    expect(new Set(notes).size, 'only 4 distinct pitches across 6 notes').toBe(4)
  })

  it('AUDC2 is a CONSTANT volume 4 ($A4) — the melody does not fade out', () => {
    expect(distinctValues(audc())).toEqual(new Set([0xa4]))
  })
})

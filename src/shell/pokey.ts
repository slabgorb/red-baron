// src/shell/pokey.ts
//
// The POKEY envelope-table driver (story rb2-11) — the RBSOUN.MAC port, credited
// Rich Adam. These are the five REWARD tones the cabinet plays through POKEY's
// four voices (findings §6A). The discrete analog board — gun, explosion, engine
// hum, approach whine — is a SEPARATE subsystem and lives in audio.ts (§6B).
//
// THE CORRECTED 8-BYTE FORMAT (the story's headline fact). The in-source
// "6 BYTES PER SOUND" comment (RBSOUN.MAC:124) is STALE: the OFFSET macro emits
// EIGHT bytes per sound — one OFFSET per POKEY register — and the caller indexes
// `.X*8+7`. A `0` offset means "leave that register untouched"; we model that as
// `null`. The eight slots are, in order:
//
//   0: AUDF1  1: AUDC1   2: AUDF2  3: AUDC2
//   4: AUDF3  5: AUDC3   6: AUDF4  7: AUDC4
//
// (AUDF = frequency divisor; AUDC = high nibble waveform + low nibble volume.)
//
// THE ENVELOPE STEPPER. Each touched register carries a 4-byte sequence —
// STVAL · FRCNT · CHANGE · NUMBER — that MODSND advances every 4 ms
// (RBSOUN.MAC:85-92). `stepEnvelope` is that stepper.
//
// SOURCING. Only the score tick TK is transcribed byte-for-byte in the fidelity
// spec (§6A, RBSOUN.MAC:157-160) and it is reproduced EXACTLY below. The raw
// RBSOUN.MAC is not in this checkout, so TP/BN/WP/TH are SYNTHESISED to their
// documented channel + shape (§6A table: fading / rising warble ×6 / descending
// ×3 / 6-note melody) — plausible envelopes in the authentic format, NOT asserted
// as ROM facts. Battlezone's bz1-11 synthesised all of its sounds the same way.
// A byte-exact pass is possible later; the shape holds.
//
// PURE data + arithmetic. No Web Audio here — audio.ts renders these.

/** The five POKEY reward tones (findings §6A). */
export type ToneName = 'TK' | 'TP' | 'BN' | 'WP' | 'TH'

/** One touched register's 4-byte envelope sequence (RBSOUN.MAC:85-92). */
export interface EnvelopeStep {
  /** STVAL — the register's initial value. */
  readonly start: number
  /** FRCNT — frames (×4 ms) each step is held. */
  readonly hold: number
  /** CHANGE — the signed delta applied at each step. */
  readonly change: number
  /** NUMBER — how many steps are taken before the envelope rests. */
  readonly count: number
}

/**
 * One sound in the corrected 8-byte OFFSET format: eight register slots, of
 * which the untouched ones (a `0` offset in the ROM) are `null`.
 */
export interface PokeySound {
  /** The POKEY voice this tone sounds on (findings §6A table). */
  readonly channel: 1 | 2 | 3 | 4
  /** Exactly 8 slots — AUDF1,AUDC1,AUDF2,AUDC2,AUDF3,AUDC3,AUDF4,AUDC4. */
  readonly registers: readonly (EnvelopeStep | null)[]
}

/** A register held at a fixed value for the whole sound (no stepping). */
const held = (value: number): EnvelopeStep => ({ start: value, hold: 1, change: 0, count: 0 })

/** The eight-slot table, with only the named channel's pair filled in. */
function table(
  channel: 1 | 2 | 3 | 4,
  audf: EnvelopeStep | null,
  audc: EnvelopeStep,
): PokeySound {
  const registers: (EnvelopeStep | null)[] = [null, null, null, null, null, null, null, null]
  registers[(channel - 1) * 2] = audf
  registers[(channel - 1) * 2 + 1] = audc
  return { channel, registers }
}

/**
 * The five envelope tables.
 *
 * TK is ROM-EXACT (§6A / RBSOUN.MAC:157-160): AUDF1 held at $30; AUDC1 starts
 * $A4 — high nibble `A` = pure tone, low nibble = volume 4 — and decays −1 every
 * 7 frames, so the tone fades 4 → 0 ($A4 → $A0) and then rests.
 *
 * The other four are synthesised to their documented shape (see header).
 */
export const POKEY_SOUNDS: Readonly<Record<ToneName, PokeySound>> = Object.freeze({
  // Score tick, small — SOUND 0, ch1. One-shot, fades. [ROM-exact]
  TK: table(1, held(0x30), { start: 0xa4, hold: 7, change: -1, count: 4 }),

  // Score tick, larger — SOUND 4, ch1. Same fading family as TK, but a louder,
  // brighter tick: a higher pitch (smaller divisor) starting from volume 6.
  TP: table(1, held(0x20), { start: 0xa6, hold: 7, change: -1, count: 6 }),

  // Bonus life — SOUND 2, ch1. A RISING warble: volume climbs in six steps.
  BN: table(1, held(0x28), { start: 0xa1, hold: 4, change: 1, count: 6 }),

  // Enemy plane announce — SOUND 1, ch3. A DESCENDING tone, three steps down.
  WP: table(3, held(0x50), { start: 0xa8, hold: 6, change: -2, count: 3 }),

  // 300-point jingle — SOUND 3, ch2. A pitched six-note melody: the AUDF2
  // divisor walks (the notes) while AUDC2 holds a steady voice.
  TH: table(2, { start: 0x60, hold: 5, change: -8, count: 5 }, held(0xa6)),
})

/**
 * MODSND: the register's value at `frame` (0-based, one frame = 4 ms).
 *
 * Each step is held `hold` frames; after `count` steps the envelope RESTS at its
 * terminal value — a faded tone never underflows past its floor, and a rising one
 * never runs away.
 */
export function stepEnvelope(step: EnvelopeStep, frame: number): number {
  const elapsed = frame < 0 ? 0 : frame
  const taken = Math.min(Math.floor(elapsed / step.hold), step.count)
  return step.start + step.change * taken
}

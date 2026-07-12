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
// (RBSOUN.MAC:85-92).
//
// !! OFF-BY-ONE, READ BEFORE TRANSCRIBING BYTES !! The ROM's fourth byte,
// `NUMBER`, is defined by the spec as "# changes − 1" (findings §6A). This module
// deliberately does NOT store that raw byte: `EnvelopeStep.steps` holds the step
// COUNT DIRECTLY (i.e. `steps === romNUMBER + 1`). A future byte-exact pass that
// drops a raw NUMBER byte straight into `steps` would be short by one step. The
// field is named `steps`, not `count`/`NUMBER`, precisely so that trap is visible.
//
// SOURCING. Only the score tick TK is transcribed byte-for-byte in the fidelity
// spec (§6A, RBSOUN.MAC:157-160) and it is reproduced EXACTLY below. The raw
// RBSOUN.MAC is not in this checkout, so TP/BN/WP/TH are SYNTHESISED to their
// documented channel + shape (§6A table: fading / rising warble ×6 / descending
// ×3 / 6-note melody) — plausible envelopes in the authentic format, NOT asserted
// as ROM facts. Battlezone's bz1-11 synthesised all of its sounds the same way.
//
// PURE data + arithmetic. No Web Audio here — audio.ts renders these.

/** The five POKEY reward tones (findings §6A). */
export type ToneName = 'TK' | 'TP' | 'BN' | 'WP' | 'TH'

/** POKEY registers are single bytes — every stepped value stays in [0, 255]. */
const REGISTER_MIN = 0
const REGISTER_MAX = 255

/** One touched register's envelope sequence (RBSOUN.MAC:85-92). */
export interface EnvelopeStep {
  /** STVAL — the register's initial value. */
  readonly start: number
  /** FRCNT — frames (×4 ms) each step is held. MUST be >= 1 (it is a divisor). */
  readonly hold: number
  /** CHANGE — the signed delta applied at each step. */
  readonly change: number
  /** How many steps are taken before the envelope rests. NOTE: this is the step
   *  count itself, NOT the ROM's `NUMBER` byte (which is this minus one). */
  readonly steps: number
}

/**
 * The corrected 8-byte OFFSET table: one slot per POKEY register, in the order
 * AUDF1,AUDC1,AUDF2,AUDC2,AUDF3,AUDC3,AUDF4,AUDC4. `null` = a `0` offset = that
 * register is left untouched.
 *
 * A fixed-length TUPLE, not a plain array: "exactly 8 slots" is the load-bearing
 * invariant of this format, so a malformed table is a COMPILE error, not a
 * runtime surprise (review round 1).
 */
export type RegisterTable = readonly [
  EnvelopeStep | null,
  EnvelopeStep | null,
  EnvelopeStep | null,
  EnvelopeStep | null,
  EnvelopeStep | null,
  EnvelopeStep | null,
  EnvelopeStep | null,
  EnvelopeStep | null,
]

/** One sound in the corrected 8-byte format. */
export interface PokeySound {
  /** The POKEY voice this tone sounds on (findings §6A table). */
  readonly channel: 1 | 2 | 3 | 4
  /** Exactly 8 slots — see `RegisterTable`. */
  readonly registers: RegisterTable
}

/** A register held at a fixed value for the whole sound (no stepping). */
const held = (value: number): EnvelopeStep => ({ start: value, hold: 1, change: 0, steps: 0 })

/**
 * The eight-slot table, with only the named channel's pair filled in. The sole
 * constructor — it is what keeps `channel` and the populated slots in sync, and
 * it REQUIRES the channel's AUDC (a sound that drives no volume register makes no
 * sound at all, so that is a programmer error, not a runtime state).
 */
function table(channel: 1 | 2 | 3 | 4, audf: EnvelopeStep | null, audc: EnvelopeStep): PokeySound {
  const slots: (EnvelopeStep | null)[] = [null, null, null, null, null, null, null, null]
  slots[(channel - 1) * 2] = audf
  slots[(channel - 1) * 2 + 1] = audc
  return { channel, registers: slots as unknown as RegisterTable }
}

/**
 * The five envelope tables.
 *
 * TK is ROM-EXACT (§6A / RBSOUN.MAC:157-160): AUDF1 held at $30; AUDC1 starts
 * $A4 — high nibble `A` = pure tone, low nibble = volume 4 — and decays −1 every
 * 7 frames, so the tone fades 4 → 0 ($A4 → $A0) and then rests.
 *
 * The other four are synthesised to their documented shape (see header). Where a
 * shape permits it (TP, WP, TH) the envelope is made to END AT VOLUME 0 so the
 * tone fades out on its own; BN's shape is a RISE, so it necessarily ends loud and
 * relies on the renderer's release ramp instead. Either way no tone is cut off at
 * a non-zero level — a hard stop at amplitude clicks (review round 1).
 */
export const POKEY_SOUNDS: Readonly<Record<ToneName, PokeySound>> = Object.freeze({
  // Score tick, small — SOUND 0, ch1. One-shot, fades 4 → 0. [ROM-exact]
  TK: table(1, held(0x30), { start: 0xa4, hold: 7, change: -1, steps: 4 }),

  // Score tick, larger — SOUND 4, ch1. The same fading family as TK but a
  // brighter, louder tick: higher pitch (smaller divisor), volume 6 → 0.
  TP: table(1, held(0x20), { start: 0xa6, hold: 7, change: -1, steps: 6 }),

  // Bonus life — SOUND 2, ch1. The RISING warble: volume climbs 1 → 7 in six
  // steps. It ENDS LOUD by design (that is the shape §6A documents), so the
  // renderer's release ramp — not the table — is what keeps it from clicking.
  BN: table(1, held(0x28), { start: 0xa1, hold: 4, change: 1, steps: 6 }),

  // Enemy plane announce — SOUND 1, ch3. A DESCENDING tone: volume 6 → 0 in
  // three steps of −2.
  WP: table(3, held(0x50), { start: 0xa6, hold: 6, change: -2, steps: 3 }),

  // 300-point jingle — SOUND 3, ch2. A pitched six-note melody: the AUDF2 divisor
  // walks the notes while AUDC2 fades the voice out across them.
  TH: table(
    2,
    { start: 0x60, hold: 5, change: -8, steps: 5 },
    { start: 0xa6, hold: 5, change: -1, steps: 6 },
  ),
})

/**
 * MODSND: the register's value at `frame` (0-based, one frame = 4 ms).
 *
 * Each step is held `hold` frames; after `steps` steps the envelope RESTS at its
 * terminal value — a faded tone never underflows past its floor, and a rising one
 * never runs away.
 *
 * Hardened in review round 1: a non-finite frame, or a `hold` below 1 (which
 * would divide by zero and yield NaN/Infinity), degrades to the envelope's start
 * value, and the result is clamped to the POKEY byte range. An out-of-range value
 * is not merely wrong — it is DANGEROUS downstream: `audcToGain` masks with
 * `& 0x0f`, and JS bitwise-AND on a negative uses two's complement, so a value of
 * −1 would read back as FULL volume rather than silence.
 */
export function stepEnvelope(step: EnvelopeStep, frame: number): number {
  if (!Number.isFinite(frame) || !Number.isFinite(step.hold) || step.hold < 1) {
    return clampRegister(step.start)
  }
  const elapsed = frame < 0 ? 0 : frame
  const taken = Math.min(Math.floor(elapsed / step.hold), Math.max(step.steps, 0))
  return clampRegister(step.start + step.change * taken)
}

/** Keep a stepped value inside the POKEY byte range [0, 255]. */
function clampRegister(value: number): number {
  if (!Number.isFinite(value)) return REGISTER_MIN
  if (value < REGISTER_MIN) return REGISTER_MIN
  if (value > REGISTER_MAX) return REGISTER_MAX
  return value
}

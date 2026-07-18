// src/shell/pokey.ts
//
// The POKEY envelope-table driver — the RBSOUN.MAC port (credited Rich Adam).
// These are the five REWARD tones the cabinet plays through POKEY's four voices
// (findings §6A). The discrete analog board — gun, explosion, engine hum,
// approach whine — is a SEPARATE subsystem and lives in audio.ts (§6B).
//
// THE 8-BYTE OFFSET FORMAT. The in-source "6 BYTES PER SOUND" comment
// (RBSOUN.MAC:124) is STALE: the OFFSET macro emits EIGHT bytes per sound — one
// OFFSET per POKEY register — and the caller indexes `.X*8+7`. A `0` offset means
// "leave that register untouched"; we model that as `null`. The eight slots are:
//
//   0: AUDF1  1: AUDC1   2: AUDF2  3: AUDC2
//   4: AUDF3  5: AUDC3   6: AUDF4  7: AUDC4
//
// (AUDF = frequency divisor; AUDC = high nibble waveform + low nibble volume.)
//
// THE ENVELOPE RULE — `steps = NUMBER − 1`, NOT `NUMBER + 1` (rb4-10 / SN-003).
// Each touched register carries one or more 4-byte SEQUENCES —
// STVAL · FRCNT · CHANGE · NUMBER — that MODSND advances every 4 ms (RBSOUN.MAC:85-92).
//
// !! THE ASSEMBLER'S PROSE IS WRONG — DO NOT "FIX" TOWARD IT !! RBSOUN.MAC says
// NUMBER is "# of changes − 1" (:89, :152) and its worked example EX1
// (`0FF,1,-1,6` → SEVEN values, :90-91) implies `values = NUMBER + 1`. That prose
// was inherited from the T2SOUN ancestor and does NOT describe this code. Tracing
// MODSND (:205-240): the load frame outputs STVAL (value #1), then a CHANGE is
// applied only while `DEC COUNT` stays non-zero (:233-234) — NUMBER−1 further
// values — so the register renders exactly NUMBER distinct values, held FRCNT
// frames each: duration = NUMBER × FRCNT.
//
// THE DECISIVE PROOF: a sound's AUDF and AUDC chains must run out together, and
// under `values = NUMBER` all five do EXACTLY (TK 28=28, TP 40=40, BN 288=288,
// WP 360=360, TH 256=256); under `values = NUMBER + 1` every one mismatches. Our
// `EnvelopeStep.steps` yields `steps + 1` values (`taken` runs 0..steps), so the
// faithful transcription is `steps = romNUMBER − 1`. The `seq()` builder below
// applies that subtraction in ONE place, and the name `steps` (not `NUMBER`)
// keeps the trap visible. The rb2-11 header enshrined `+ 1` — a two-step error.
//
// A REGISTER IS A CHAIN. RBSOUN.MAC lays each register out as consecutive 4-byte
// sequences terminated by `.BYTE 0,0`: TK/TP are one sequence; BN's AUDF1 is SIX
// identical `06,1,1,30` sweeps (:164-169); WP's AUDF3 is THREE `54,2,0FF,3C`
// sweeps (:176-178); TH's AUDF2 is SIX constant-pitch sequences = six NOTES
// (:185-190). A single monotonic sequence cannot express a repeat or a note list,
// so each register slot is a CHAIN and `stepChain` walks it.
//
// PURE data + arithmetic. No Web Audio here — audio.ts renders these.

/** The five POKEY reward tones (findings §6A). */
export type ToneName = 'TK' | 'TP' | 'BN' | 'WP' | 'TH'

/** POKEY registers are single bytes — every stepped value stays in [0, 255]. */
const REGISTER_MIN = 0
const REGISTER_MAX = 255

/** One 4-byte envelope sequence (RBSOUN.MAC:85-92). */
export interface EnvelopeStep {
  /** STVAL — the register's initial value. */
  readonly start: number
  /** FRCNT — frames (×4 ms) each step is held. MUST be >= 1 (it is a divisor). */
  readonly hold: number
  /** CHANGE — the signed delta applied at each step. */
  readonly change: number
  /** How many steps are taken before the sequence rests. NOTE: this is the step
   *  count itself, so the sequence renders `steps + 1` distinct values — it is the
   *  ROM's NUMBER byte MINUS ONE (rb4-10 / SN-003). */
  readonly steps: number
}

/** A touched register's envelope: a CHAIN of sequences (rb4-10). `null` = a `0`
 *  offset = the register is left untouched. */
export type RegisterChain = readonly EnvelopeStep[] | null

/**
 * The 8-slot OFFSET table: one chain per POKEY register, in the order
 * AUDF1,AUDC1,AUDF2,AUDC2,AUDF3,AUDC3,AUDF4,AUDC4.
 *
 * A fixed-length TUPLE, not a plain array: "exactly 8 slots" is the load-bearing
 * invariant of this format, so a malformed table is a COMPILE error.
 */
export type RegisterTable = readonly [
  RegisterChain,
  RegisterChain,
  RegisterChain,
  RegisterChain,
  RegisterChain,
  RegisterChain,
  RegisterChain,
  RegisterChain,
]

/** One sound in the 8-byte format. */
export interface PokeySound {
  /** The POKEY voice this tone sounds on (findings §6A table). */
  readonly channel: 1 | 2 | 3 | 4
  /** Exactly 8 slots — see `RegisterTable`. */
  readonly registers: RegisterTable
}

/**
 * Build one envelope sequence from its ROM bytes, applying the `steps = NUMBER − 1`
 * rule (SN-003) in the ONE place it belongs. `number` is the raw ROM NUMBER byte;
 * the sequence renders exactly `number` distinct values.
 */
const seq = (start: number, hold: number, change: number, number: number): EnvelopeStep => ({
  start,
  hold,
  change,
  steps: number - 1,
})

/** N identical sequences — BN's six sweeps, WP's three (RBSOUN.MAC:164-178). */
const repeat = (n: number, step: EnvelopeStep): readonly EnvelopeStep[] => Array.from({ length: n }, () => step)

/**
 * The eight-slot table, with only the named channel's AUDF/AUDC chains filled in.
 * The sole constructor — it keeps `channel` and the populated slots in sync, and it
 * REQUIRES the channel's AUDC (a sound driving no volume register makes no sound at
 * all, so that is a programmer error, not a runtime state).
 */
function table(channel: 1 | 2 | 3 | 4, audf: RegisterChain, audc: readonly EnvelopeStep[]): PokeySound {
  const slots: RegisterChain[] = [null, null, null, null, null, null, null, null]
  slots[(channel - 1) * 2] = audf
  slots[(channel - 1) * 2 + 1] = audc
  return { channel, registers: slots as unknown as RegisterTable }
}

/**
 * The five envelope tables — byte-exact against the citable RBSOUN.MAC (rb4-10).
 *
 * Note the AUDF register carries its OWN full NUMBER × FRCNT duration even when its
 * CHANGE is 0 (a held pitch): that is what makes the AUDF and AUDC chains run out
 * together (the SN-003 proof). A one-frame `held` value would break that equality.
 */
export const POKEY_SOUNDS: Readonly<Record<ToneName, PokeySound>> = Object.freeze({
  // Score tick, small — SOUND 0, ch1 (RBSOUN.MAC:157-160). $30 pure tone, volume
  // 4 fading −1 every 7 frames to $A1: 4 distinct values, 4×7 = 28 frames.
  TK: table(1, [seq(0x30, 7, 0, 4)], [seq(0xa4, 7, -1, 4)]),

  // Score tick, larger — SOUND 4, ch1 (RBSOUN.MAC:197-199). LOWER + LONGER than TK:
  // divisor $38 (561 Hz vs 652), held 10 frames, same start volume 4. 40 frames.
  TP: table(1, [seq(0x38, 0x0a, 0, 4)], [seq(0xa4, 0x0a, -1, 4)]),

  // Bonus life — SOUND 2, ch1 (RBSOUN.MAC:164-171). SIX identical falling-pitch
  // sweeps (divisor 6→53 → pitch falls) at a CONSTANT volume 4. 288 frames.
  BN: table(1, repeat(6, seq(0x06, 1, 1, 0x30)), [seq(0xa4, 2, 0, 0x90)]),

  // Enemy plane announce — SOUND 1, ch3 (RBSOUN.MAC:176-180). THREE identical
  // sweeps whose divisor falls $54→$19 (pitch RISES) at a CONSTANT volume 4. 360 frames.
  WP: table(3, repeat(3, seq(0x54, 2, -1, 0x3c)), [seq(0xa4, 2, 0, 0xb4)]),

  // 300-point jingle — SOUND 3, ch2 (RBSOUN.MAC:185-192). Six constant-pitch notes
  // C4·D4·E4·B4·E4·B4 (the two B4s double-length) at a CONSTANT volume 4. 256 frames.
  TH: table(
    2,
    [
      seq(0x79, 2, 0, 0x10),
      seq(0x6c, 2, 0, 0x10),
      seq(0x60, 2, 0, 0x10),
      seq(0x40, 2, 0, 0x20),
      seq(0x60, 2, 0, 0x10),
      seq(0x40, 2, 0, 0x20),
    ],
    [seq(0xa4, 2, 0, 0x80)],
  ),
})

/**
 * MODSND: one sequence's value at `frame` (0-based, one frame = 4 ms).
 *
 * Each step is held `hold` frames; after `steps` steps the sequence RESTS at its
 * terminal value. Hardened: a non-finite frame, or a `hold` below 1 (which would
 * divide by zero), degrades to the sequence's start value, and the result is
 * clamped to the POKEY byte range — an out-of-range value is DANGEROUS downstream,
 * since `audcToGain` masks with `& 0x0f` and a negative would read back as FULL volume.
 */
export function stepEnvelope(step: EnvelopeStep, frame: number): number {
  if (!Number.isFinite(frame) || !Number.isFinite(step.hold) || step.hold < 1) {
    return clampRegister(step.start)
  }
  const elapsed = frame < 0 ? 0 : frame
  const taken = Math.min(Math.floor(elapsed / step.hold), Math.max(step.steps, 0))
  return clampRegister(step.start + step.change * taken)
}

/**
 * MODSND over a whole register CHAIN: the byte written at 4 ms-frame `frame`,
 * walking sequence-to-sequence. Sequence i spans `(steps_i + 1) · hold_i` frames;
 * when it runs out the next sequence loads (restarting at its `start`); after the
 * last, the register RESTS at that sequence's terminal value. Same hardening as
 * `stepEnvelope`.
 */
export function stepChain(chain: readonly EnvelopeStep[], frame: number): number {
  if (chain.length === 0) return REGISTER_MIN
  if (!Number.isFinite(frame)) return clampRegister(chain[0].start)
  const f = frame < 0 ? 0 : frame
  let offset = 0
  for (const s of chain) {
    const hold = Number.isFinite(s.hold) && s.hold >= 1 ? s.hold : 1
    const steps = Math.max(s.steps, 0)
    const length = (steps + 1) * hold
    if (f < offset + length) {
      const taken = Math.min(Math.floor((f - offset) / hold), steps)
      return clampRegister(s.start + s.change * taken)
    }
    offset += length
  }
  const last = chain[chain.length - 1]
  return clampRegister(last.start + last.change * Math.max(last.steps, 0))
}

/** Total 4 ms frames a chain runs — Σ (steps+1)·hold. A sound's whole duration. */
export function envelopeFrames(chain: readonly EnvelopeStep[]): number {
  return chain.reduce((sum, s) => sum + (Math.max(s.steps, 0) + 1) * Math.max(s.hold, 1), 0)
}

/** Keep a stepped value inside the POKEY byte range [0, 255]. */
function clampRegister(value: number): number {
  if (!Number.isFinite(value)) return REGISTER_MIN
  if (value < REGISTER_MIN) return REGISTER_MIN
  if (value > REGISTER_MAX) return REGISTER_MAX
  return value
}

// src/core/eol.ts
//
// THE END-OF-LIFE TIMER (EOGTMR) — story rb4-4 (AC-2). The machine that makes
// the two death channels DISTINCT and gives each the ROM's own duration.
//
// THE ROM (EOLSEQ, RBARON.MAC:1057-1201): death raises GREND's D7 — by enemy
// shells (`LDA I,80 / STA GREND ;SHELL CD`, :3758-3759) or by the ground
// (`ORA I,0C0 / STA GREND ;D6=GROUND COLLISION`, :4643-4645 — D6 is the
// discriminant). EOLSEQ seeds ONE count-up timer from the channel (:1061-1066):
//
//     shells (D6 clear) → EOGTMR = 0       (the full sequence)
//     ground (D6 set)   → EOGTMR = 0x0F    (the crash starts half-"over")
//
// then INCrements it every calc frame (:1114-1115). At .TIME1 = 0x10 = 16
// (";EOL COUNTS", :505) the spiral hands over to the STARFIELD (`CPX I,.TIME1
// ;TIME FOR STARFIELD ?`, :1163); at .TIME2 = 0x1C = 28 (:506) the sequence is
// done (`CMP I,.TIME2 / BCC 45$ / JMP ENDLFE`, :1124-1126) and ENDLFE takes the
// life — lives.ts's `loseLife` (DEC LIVES, :1207) models THAT part.
//
// So the durations are: SHELLS = 28 calc frames (2.688 s at 96 ms) and
// GROUND = 28 − 15 = 13 calc frames (1.248 s). NOTE: .TIME1 is the
// spiral→starfield boundary INSIDE the sequence, not a channel's length — this
// corrects both the story AC's parenthetical (TEA deviation, session file) and
// lives.ts's older header claim that the sub-stages had "no ROM-pinned
// durations". DEATH_SEQUENCE (the render-stage cursor) stays for the shell's
// visuals; THIS timer is what advances the death at the calc-frame cadence.
//
// PURE and deterministic. No DOM, no time, no randomness.

// ─── ROM-exact constants (RBARON.MAC, .RADIX 16 region — HEX) ─────────────────

/** .TIME1 = 0x10 = 16 (:505) — the EOGTMR value where the starfield begins (:1163). */
export const TIME1 = 0x10

/** .TIME2 = 0x1C = 28 (:506) — the EOGTMR value where the sequence ends → ENDLFE (:1124-1126). */
export const TIME2 = 0x1c

/** The ground channel's EOGTMR seed (`LDA I,0F`, :1064) — a crash skips most of the spiral. */
export const GROUND_EOL_START = 0x0f

// ─── the machine ──────────────────────────────────────────────────────────────

/** Which death this is — GREND 0x80 (shells) vs 0xC0 (D6 = ground collision). */
export type EolChannel = 'shells' | 'ground'

/** A death sequence in progress: the channel and the EOGTMR count-up. */
export interface EolState {
  readonly channel: EolChannel
  readonly timer: number
}

/** Begin the sequence: seed EOGTMR from the channel (:1061-1066). */
export function beginEol(channel: EolChannel): EolState {
  return { channel, timer: channel === 'ground' ? GROUND_EOL_START : 0 }
}

/** One calc frame: INC EOGTMR (:1114-1115). Pure — never mutates its input. */
export function tickEol(s: EolState): EolState {
  return { channel: s.channel, timer: s.timer + 1 }
}

/** Sequence done — time for ENDLFE (DEC LIVES → respawn or game over)? (:1124-1126) */
export function eolDone(s: EolState): boolean {
  return s.timer >= TIME2
}

/** The visible stage: spiral until .TIME1, starfield after (:1163). */
export function eolStage(s: EolState): 'spiral' | 'starfield' {
  return s.timer < TIME1 ? 'spiral' : 'starfield'
}

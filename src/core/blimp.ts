// src/core/blimp.ts
//
// The Blimp / Zeppelin — story rb2-10. The one enemy the sky owes the player that
// ISN'T a weaving biplane: it rolls in on a ~25 % chance, DRIFTS steadily across
// the screen (it does NOT weave/reverse like enemy.ts's window-follower), fires at
// the player, and is worth a flat 200 pts when gunned down — drawn with the
// authentic BLIMP/DBLIMP picture-ROM geometry (topology.ts, rb2-2). Grounded in
// findings §3 (BLMOTN, R2BRON.MAC:4165+: "~25 % random spawn, drifts across, also
// fires at the player, worth 200 pts. There is no separate barrage balloon — the
// airship is the blimp. [ROM-verified]") and §4 (blimp = 200 pts, flat).
//
// DRIFTS ACROSS, NOT A WEAVE (findings §3): the biplane (enemy.ts) accelerates ΔX
// toward the window limits and REVERSES at the bounds — its ΔX takes both signs.
// The blimp does the opposite: ONE steady drift with a CONSTANT-SIGN velocity that
// carries it from its entry side across centre to the far side. It flies LEVEL (no
// bank — a Zeppelin does not roll into a turn) and cruises at a constant depth; the
// motion is purely lateral.
//
// ALSO FIRES AT THE PLAYER (findings §3): unlike a plane, whose "@ PLAYER" bit is
// PLNLVL level-gated (enemy.planeFires: level < 4 → never), the blimp is a threat
// whenever it is present. `blimpFires` takes no level and fires on the established
// ÷2 FRAME cadence (findings §3, PLNSHL) — a menace even in the early sky the
// planes leave quiet.
//
// FRAME CADENCE (findings §1 — load-bearing): the drift and the fire cadence tick
// ONCE per calculation frame (~10.42 Hz / 96 ms), NOT per 62.5 Hz display frame —
// main.ts steps the blimp inside the SIM_TIMESTEP_S accumulator like every other
// rb2 motion object.
//
// SCALE NOTE: BLMOTN is not byte-transcribed in the quarry, so the ROM pins the
// DATA that IS documented — the ~25 % spawn (BLIMP_SPAWN_CHANCE), the flat 200-pt
// value (scoring.ts BLIMP_SCORE), the authentic geometry (topology.ts) — while the
// cruise depth, the drift speed, the entry offset, the bank (0), and the ÷2 fire
// phase are chosen HERE within the tested invariants (like enemy.ts's
// WEAVE_SPEED_CAP), and flagged as inferred in the session's Design Deviations.
//
// PURE and deterministic. No DOM, no time, no ambient randomness — the ONLY source
// of randomness is the seeded Rng handed to `spawn`.

import { type Rng, nextFloat } from '@arcade/shared/rng'
import { P_INDP } from './returning-ace'

// ─── ROM-exact data (findings §3, BLMOTN) ────────────────────────────────────

/**
 * The ~25 % random spawn roll (findings §3, BLMOTN). This is the blimp module's OWN
 * constant — a SEPARATE roll from enemy.ts's LONE_PLANE_CHANCE (which is also 0.25
 * but decides lone-plane-vs-formation); this one decides "a blimp appears at all".
 */
export const BLIMP_SPAWN_CHANCE = 0.25

// ─── tuning within the tested invariants (inferred — BLMOTN not byte-transcribed) ─

/**
 * Cruise depth the airship drifts across at — a visible mid-field distance. Inferred
 * (BLMOTN does not byte-pin it), but DENOMINATED IN THE AXIS rather than typed as a number.
 *
 * rb4-1 REWORK 2. This was a bare `600`, and "mid-field" was true of it only in the world we
 * misread: against the old 1080 spawn, 600 was 56% of the way out. Against the real P.INDP =
 * 4224 it is 14% — the airship was cruising in the player's face, and its own comment was the
 * only thing still claiming otherwise. Half the plane's spawn depth IS the mid-field, at any
 * scale, so the two can never drift apart again.
 */
const CRUISE_DEPTH = P_INDP / 2 // 2112

/** Per-calc-frame lateral drift — the airship is slow and steady. Inferred. */
const DRIFT_SPEED = 12

/** Entry X magnitude range: the blimp enters near a screen edge at [MIN, MIN+RANGE). Inferred. */
const ENTRY_X_MIN = 180
const ENTRY_X_RANGE = 120

/** Vertical spread of the random spawn Y (± window units) — keeps it on-screen. Inferred. */
const SPAWN_Y_RANGE = 40

// ─── state ───────────────────────────────────────────────────────────────────

/** The blimp's state — all ROM screen-window units. */
export interface Blimp {
  /** Screen-window X — DRIFTS across centre (0) in ONE direction (never reverses). */
  readonly x: number
  /** Vertical offset — random at spawn. */
  readonly y: number
  /** Depth in front of the eye (> 0); the airship cruises here and drifts sideways. */
  readonly depth: number
  /** Drift velocity — CONSTANT SIGN; carries the blimp from its entry side to the far side. */
  readonly deltaX: number
  /** Roll (radians): a Zeppelin flies LEVEL — always 0 (inferred; see Design Deviations). */
  readonly bank: number
  /** The screen side it entered from; it drifts toward the OTHER side. */
  readonly side: -1 | 1
  /** D7 "active" status. */
  readonly active: boolean
}

// ─── the ~25 % spawn roll ──────────────────────────────────────────────────────

/**
 * The BLMOTN spawn decision: a blimp appears when the caller's roll lands strictly
 * BELOW the ~25 % chance (findings §3). The caller draws `roll` (e.g. nextFloat of the
 * seeded Rng) so the decision is deterministic. Total — a NaN / non-finite roll fails
 * safe to "no blimp" (NaN < 0.25 is false), never conjuring a phantom airship.
 */
export function shouldSpawnBlimp(roll: number): boolean {
  return roll < BLIMP_SPAWN_CHANCE
}

// ─── spawn (BLMOTN side entry, drifting across) ────────────────────────────────

/**
 * Spawn a blimp entering from a random screen side and drifting toward the OTHER
 * side, level and at cruise depth. Consumes the seeded Rng for its side, entry X
 * (in the outer band), and Y. Pure per seed — the drift velocity points AWAY from
 * the entry edge (sign −side) so the airship crosses the player's view.
 */
export function spawn(rng: Rng): Blimp {
  const side: -1 | 1 = nextFloat(rng) < 0.5 ? -1 : 1
  const mag = ENTRY_X_MIN + nextFloat(rng) * ENTRY_X_RANGE
  const y = (nextFloat(rng) * 2 - 1) * SPAWN_Y_RANGE
  return {
    x: side * mag,
    y,
    depth: CRUISE_DEPTH,
    deltaX: -side * DRIFT_SPEED, // drift toward the far side, away from the entry edge
    bank: 0, // a Zeppelin flies level
    side,
    active: true,
  }
}

// ─── the calc-frame drift (one step per 96 ms calc frame — findings §1) ────────

/**
 * Advance the blimp one calculation frame: a steady lateral drift by `deltaX`, with
 * the depth, bank, side, and active status carried unchanged. UNLIKE the biplane's
 * weave, `deltaX` never reverses — the drift is monotone across the screen. Pure —
 * returns a fresh state, the input untouched.
 */
export function step(blimp: Blimp): Blimp {
  return { ...blimp, x: blimp.x + blimp.deltaX }
}

// ─── firing (BLMOTN "also fires at the player") ────────────────────────────────

/**
 * Does the blimp fire THIS calc-frame? It fires on the ÷2 FRAME cadence (findings §3,
 * PLNSHL — at most every OTHER calc-frame, gated by the FRAME LSB), and — unlike a
 * plane — with NO PLNLVL level gate: the blimp is a threat at every GMLEVL. Pure and
 * deterministic in the frame. Total — a non-finite frame fails safe to "hold fire".
 * NOTE: which frame parity fires is inferred (the ROM pins the ÷2, not the phase); we
 * fire on even FRAME.
 */
export function blimpFires(frame: number): boolean {
  if (!Number.isFinite(frame)) return false
  return (Math.floor(frame) & 1) === 0 // ÷2 FRAME cadence — fire on even frames
}

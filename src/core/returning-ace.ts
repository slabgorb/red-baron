// src/core/returning-ace.ts
//
// THE RETURNING ACE — the signature "bank hard to shake him" mechanic (story rb2-8).
// A plane flies by, closes past P.MNDP, then comes back on your six ("BEHIND YOU");
// the only way out is to break-turn to the correct side, hard enough, in time. The
// first pass is a freebie; after that it's a coin flip unless you fly it right.
//
// THE PASS (P.UPD0, findings §3, R2BRON.MAC:2723-2738): "when a plane closes past
// P.MNDP=140 it enables returning-plane shells, fires the 'BEHIND YOU' message,
// records ENSIDE (which side), and re-enters as a returning plane (NWENME) that
// intercepts the player." `closesPast(depth)` is the trigger; `beginPass(side)`
// records ENSIDE and arms the free first dodge. enemy.ts bores a plane in to a floor
// of exactly MIN_DEPTH=140 (= P.MNDP), so the trigger fires when it reaches that floor.
// Deeper GMLEVLs close FASTER (PLPOSZ, GMLEVL-indexed).
//
// THE EVADE CHECK (EOLSEQ, findings §5, R2BRON.MAC:1070-1102): at the ace's attack the
// game checks the player's bank — `ENSIDE EOR PLDELX` must show banking to the CORRECT
// side AND `|PLDELX| >= 0x1C` (a hard-enough turn) to evade. "First attack is a free
// dodge (BEFLAG 'FIRST TIME FREE'); every subsequent one is 50/50 (RANDOM)."
//
// EVADE SEMANTICS (branch order + correct-side polarity are INFERRED — see the two
// Dev design deviations logged for rb2-8; the finding pins the predicate + free/50-50
// split but not the nesting or which EOR branch is "correct"):
//   1. FIRST pass       -> EVADED unconditionally (BEFLAG free); BEFLAG is CONSUMED.
//   2. else SKILL dodge — correct side AND hard turn -> EVADED, guaranteed.
//   3. else             -> the 50/50 RANDOM: roll < 0.5 -> evaded, else -> hit.
// "Correct side" = sign(PLDELX) === ENSIDE (turn TOWARD the shoulder he came from).
//
// SCOPE: this module is the DECISION mechanism. Applying the 'hit' verdict — lives,
// the windshield bullet-hole (side = ENSIDE), respawn — is rb2-9 (findings §5); the
// re-entry FLIGHT PATH (drawing the plane boring in from six) is a later render story.
// Mirrors rb2-7's planeFires: a pure decision function whose damage channel lands with
// lives (rb2-9). No main.ts wiring here — the HUD "BEHIND YOU" cue is coupled to the
// rb2-9 death sequence.
//
// PURE and deterministic. No DOM, no time, no ambient randomness — the ONLY source of
// randomness is the `roll` the caller supplies to `evadeCheck` (same pattern as
// enemy.ts's planeFires).

// ─── ROM-exact thresholds (findings §3 P.UPD0, §5 EOLSEQ) ─────────────────────

/** P.MNDP — the close distance past which the fly-by becomes a returning attack (R2BRON.MAC:2723). */
export const P_MNDP = 140

/** The |PLDELX| a break-turn must reach to shake the ace — 0x1C (EOLSEQ, findings §5). */
export const HARD_TURN = 0x1c

/**
 * PLPOSZ — the GMLEVL-indexed close speed: deeper levels close FASTER (findings §3).
 * The source pins the mechanism (level-indexed, rising), NOT the byte values, so these
 * are chosen within the tested invariants (positive, non-decreasing, faster end-to-end);
 * level 0 matches enemy.ts's current CLOSE_SPEED=8. .LEVLS = 5 entries. [Deviation logged.]
 */
export const PLPOSZ: readonly number[] = Object.freeze([8, 10, 13, 16, 20])

// ─── pure helpers ─────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** Clamp a GMLEVL to a valid PLPOSZ index (0 .. .LEVLS-1); NaN/negative/over-range fold to a valid slot. */
const levelIndex = (level: number): number => clamp(Math.floor(level) || 0, 0, PLPOSZ.length - 1)

// ─── the P.UPD0 fly-by trigger ────────────────────────────────────────────────

/**
 * Has the plane closed past P.MNDP — the fly-by that becomes a returning attack?
 * Inclusive at the threshold (the enemy weave floors at MIN_DEPTH=140 = P.MNDP, so the
 * trigger fires when it reaches that floor). Total: a degenerate depth yields a boolean
 * (NaN -> false; -Infinity has closed past any finite threshold; +Infinity has not).
 */
export function closesPast(depth: number): boolean {
  return depth <= P_MNDP
}

/** PLPOSZ close speed for a GMLEVL — clamped/total, always one of the positive table values. */
export function closeSpeed(level: number): number {
  return PLPOSZ[levelIndex(level)]
}

// ─── the returning-ace state (records ENSIDE + the BEFLAG free dodge) ─────────

/** A plane that has begun its returning-ace pass. */
export interface ReturningAce {
  /** ENSIDE — the side it closed from (the "BEHIND YOU" shoulder). */
  readonly side: -1 | 1
  /** BEFLAG — is the FIRST-TIME-FREE dodge still armed? */
  readonly firstPass: boolean
}

/** Begin a returning-ace pass: record ENSIDE and arm the free first dodge (BEFLAG). */
export function beginPass(side: -1 | 1): ReturningAce {
  return { side, firstPass: true }
}

// ─── the EOLSEQ evade check (findings §5) ─────────────────────────────────────

/** The verdict of an evade check — evaded (shook him) or hit (he got you; damage is rb2-9). */
export type EvadeResult = 'evaded' | 'hit'

/**
 * Run the EOLSEQ evade check for one attack of the returning ace. Returns the verdict and
 * the ace's next state (the BEFLAG freebie is consumed after the first pass). Pure — the
 * input ace is never mutated; the 50/50 is deterministic in the supplied `roll`.
 *
 *   1. First pass -> 'evaded' (BEFLAG free), consume the freebie.
 *   2. else correct side (sign(turnRate) === side) AND |turnRate| >= HARD_TURN -> 'evaded'.
 *   3. else -> roll < 0.5 ? 'evaded' : 'hit'.
 *
 * turnRate is the player's live PLDELX (flight.ts FlightState.turnRate). NOTE: 0 is a
 * REAL "no turn" — it fails both the hard-turn and correct-side checks (sign(0) matches
 * no shoulder), so a level pass rides the coin flip; it is never a falsy fallback.
 */
export function evadeCheck(
  ace: ReturningAce,
  turnRate: number,
  roll: number,
): { result: EvadeResult; ace: ReturningAce } {
  if (ace.firstPass) {
    return { result: 'evaded', ace: { side: ace.side, firstPass: false } } // FIRST TIME FREE
  }
  const skillDodge = Math.sign(turnRate) === ace.side && Math.abs(turnRate) >= HARD_TURN
  if (skillDodge) {
    return { result: 'evaded', ace } // bank hard to the correct side — guaranteed shake
  }
  return { result: roll < 0.5 ? 'evaded' : 'hit', ace } // the 50/50 RANDOM
}

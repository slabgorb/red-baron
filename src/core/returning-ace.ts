// src/core/returning-ace.ts
//
// THE RETURNING ACE — the signature "bank hard to shake him" mechanic (story rb2-8).
// A plane flies by, closes past P.MNDP, then comes back on your six ("BEHIND YOU");
// the only way out is to break-turn to the correct side, hard enough, in time. The
// first pass is a freebie; after that it's a coin flip unless you fly it right.
//
// THE PASS (P.UPD0, RBARON.MAC:2727): "when a plane closes past
// P.MNDP=0x140 it enables returning-plane shells, fires the 'BEHIND YOU' message,
// records ENSIDE (which side), and re-enters as a returning plane (NWENME) that
// intercepts the player." `closesPast(depth)` is the trigger; `beginPass(side)`
// records ENSIDE and arms the free first dodge. enemy.ts bores a plane in to a floor
// of exactly MIN_DEPTH = P.MNDP = 0x140 = 320, so the trigger fires when it reaches it.
// Deeper GMLEVLs close FASTER (PLPOSZ, GMLEVL-indexed).
//
// THE EVADE CHECK (EOLSEQ, RBARON.MAC:1057): at the ace's attack the
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

// ─── ROM-exact thresholds (RBARON.MAC, `.RADIX 16` region — HEX) ──────────────
//
// RADIX WARNING (rb4-1): `.RADIX 16` is set at RBARON.MAC:74 and holds unbroken here.
// These digits are HEX. They were transcribed as decimal from a doc citing the DECOY
// BUILD — an image that never shipped.

// ─── THE DEPTH AXIS ──────────────────────────────────────────────────────────
//
// P.INDP and P.MNDP are the two ends of the axis the plane flies down: where it
// appears, and the closest it can ever get. EVERY other depth-denominated number in
// the game is a statement about this interval, so both live HERE, in the one core
// module that imports nothing — any module can reach the axis without a cycle.
//
// (P.INDP was in enemy.ts, but enemy.ts imports biplane.ts, so biplane.ts could not
// denominate its LOD switch against it without a circular import — the top-level
// `const` would have hit the TDZ and thrown at load. enemy.ts re-exports it, so its
// public surface is unchanged.)

/**
 * P.INDP — the depth the plane APPEARS at. The far end of the axis.
 * RBARON.MAC:464 `P.INDP =1080`, .RADIX 16 region (set at :74) → 0x1080 = 4224.
 * Read as decimal 1080 the whole world was 3.91× too shallow — which is the bug that
 * invalidated every constant measured in depth (see tests/core/depth-scale.test.ts).
 */
export const P_INDP = 0x1080

/**
 * P.MNDP — the close distance past which the fly-by becomes a returning attack (P.UPD0).
 * Also the plane's depth FLOOR: the near end of the axis, the closest it can ever get.
 * RBARON.MAC:469 `P.MNDP =140`, .RADIX 16 region (set at :74) → 0x140 = 320.
 * Read as decimal 140 the plane had to get 2.3× closer before the ace pass triggered.
 */
export const P_MNDP = 0x140

/** The |PLDELX| a break-turn must reach to shake the ace — 0x1C (EOLSEQ, findings §5). */
export const HARD_TURN = 0x1c

/**
 * PLSTAT+7 attack frame — the returning pass resolves its EOLSEQ evade check when
 * the plane's state counter reaches 0x0C (`LDA PLSTAT+7 / CMP I,0C`,
 * RBARON.MAC:1078-1080). rb4-4 uses it as the attack CADENCE while the pass is
 * armed; the full re-entry flight path that counter times is a later render story.
 */
export const ACE_ATTACK_FRAMES = 0x0c

/**
 * PLPOSZ — the GMLEVL-indexed depth delta of the returning pass.
 * RBARON.MAC:2482, .RADIX 16 region (set at :74):
 *
 *     PLPOSZ: .BYTE -4,-10,-20,-30,-40,-50,-60,-70,-80
 *
 * We had this wrong in all four respects (EN-014):
 *   SIGN      the bytes are NEGATIVE. The ROM ADDS this to the display depth
 *             (RBARON.MAC:2704-2707) so the depth FALLS. We stored positives.
 *   MAGNITUDE they are HEX: -4, -16, -32, … -128. We read the digits as decimal.
 *   LENGTH    NINE entries. We shipped five.
 *   RAMP      GMLEVL 0..5 is all PLNZD ever indexes (RBARON.MAC:2409-2411), i.e.
 *             PLPOSZ[0..5] = -0x04 .. -0x50 — a 20× acceleration across the game
 *             (0x50 / 0x04 = 80 / 4 = 20). We shipped 8 → 20, a 2.5× ramp: level 0
 *             twice too fast, level 5 four times too slow.
 *
 *             This line ONCE named PLPOSZ[8] as the top of the ramp. It is not: GMLEVL
 *             cannot reach index 8 (MAX_GMLEVL = max(PLNLVL) = 5), and that entry is
 *             -128, which would be a 32× ramp. The slip was writing the DECIMAL top of
 *             the ramp (80) as though it were hex — this story's own bug, in prose, in
 *             the file the story wrote. Indices 6..8 are transcribed because the ROM
 *             has nine bytes; they are simply never indexed.
 */
export const PLPOSZ: readonly number[] = Object.freeze([
  -0x04, -0x10, -0x20, -0x30, -0x40, -0x50, -0x60, -0x70, -0x80,
])

// ─── pure helpers ─────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** Clamp a GMLEVL to a valid PLPOSZ index (0 .. .LEVLS-1); NaN/negative/over-range fold to a valid slot. */
const levelIndex = (level: number): number => clamp(Math.floor(level) || 0, 0, PLPOSZ.length - 1)

// ─── the P.UPD0 fly-by trigger ────────────────────────────────────────────────

/**
 * Has the plane closed past P.MNDP — the fly-by that becomes a returning attack?
 * Inclusive at the threshold (the enemy weave floors at MIN_DEPTH = P.MNDP = 0x140, so the
 * trigger fires when it reaches that floor). Total: a degenerate depth yields a boolean
 * (NaN -> false; -Infinity has closed past any finite threshold; +Infinity has not).
 */
export function closesPast(depth: number): boolean {
  return depth <= P_MNDP
}

/**
 * PLPOSZ depth delta for a GMLEVL — clamped/total, always one of the NEGATIVE table
 * values. It is ADDED to the depth (the ROM's own idiom, RBARON.MAC:2704-2707), so a
 * more negative delta closes faster. Never returns 0: a clamped level still closes.
 */
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

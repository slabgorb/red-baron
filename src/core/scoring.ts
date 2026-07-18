// src/core/scoring.ts
//
// The score half of the kill payoff — story rb2-6. A downed plane is worth points,
// and the running KILL COUNT ramps the difficulty. Grounded in findings §4
// ("Scoring tied to mechanics", PLNSCR/DRNSCR, RBARON.MAC:3038/3042) and §3 (the
// OBJKLD → GMLEVL level table, PLNLVL). Two ROM facts drive this module:
//
//   1. THE LEAD'S VALUE COUNTS DOWN AS IT CLOSES. A far/dim plane pays the flat DRNPNT
//      (300); inside the bonus gate it pays PLVALU, which SHRINKS with the depth — so it
//      is worth 300 far, ~60 just inside the gate, and as little as 10 point-blank. It is
//      NEVER worth more than a drone. DRONES and the BLIMP are flat (300 / 200).
//   2. Each kill bumps OBJKLD, which indexes PLNLVL to set GMLEVL (ceiling .LEVLS=5) —
//      more kills → higher level → a more aggressive sky (drives the enemy weave width
//      and, at rb2-7, spawn counts).
//
// rb4-1 / CB-003 — WHAT THIS FILE USED TO SAY. This header previously claimed the exact
// opposite ("a lit/close LEAD plane is worth MORE the closer it is"), read from a findings
// doc that had it backwards, and implemented a score that CLIMBED to 1056 as the plane
// closed. The ROM pays you for the difficult DISTANT shot, not the easy close one. The
// arithmetic is derived from the primary source below; nothing here is inferred from prose.
//
// PURE and deterministic — no DOM, no time, no randomness. A leaf module with no imports.


// ─── ROM-exact data (findings §4, §3) ─────────────────────────────────────────

/** DRNPNT=30. ×10 — flat value of a drone / dim-far plane, at any depth (findings §4). */
export const DRONE_SCORE = 300

/** Flat value of the blimp/Zeppelin, at any depth (findings §4). */
export const BLIMP_SCORE = 200

/** PLNLVL — OBJKLD → GMLEVL: kill-count-indexed difficulty, saturating at 5 (findings §3). */
export const PLNLVL: readonly number[] = Object.freeze([0, 0, 0, 0, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 4, 4, 5])

/** .LEVLS — the difficulty ceiling: the top of the PLNLVL table. */
export const MAX_GMLEVL = Math.max(...PLNLVL)

// ─── PLVALU (RBARON.MAC:2710-2721 / 3038-3045, `.RADIX 16` region) ────────────
//
// rb4-1 / CB-003. We had this mechanism BACKWARDS. The old code paid MORE the closer
// the plane got, climbing to 1056; the ROM pays LESS, and never more than a drone.
//
//   PLNSCR:  LDA PLVALU / LDX PLSTAT+5 / CPX I,10 / BCC NWSCRE
//     depth MSB >= 0x10  -> falls through to DRNSCR: the flat DRNPNT, ";XTRA POINTS IF DIM"
//     depth MSB <  0x10  -> scores PLVALU instead
//   PLVALU:  depth_MSB x VALFRC, then DIVBY4 twice (= /16), floored at VALMIN
//
// Because the depth SHRINKS as the plane approaches, PLVALU SHRINKS with it. You are
// paid for the difficult DISTANT shot, not the easy close one.

/** The ROM's score table stores TENS of points: DRNPNT = 30. (decimal) = "300 POINTS/DRONE". */
const SCORE_UNIT = 10

/** The depth MSB at/above which a plane is "dim" and pays the flat DRNPNT (`CPX I,10`). */
const BONUS_DEPTH_MSB = 0x10

/** The PLVALU divisor — `JSR DIVBY4` twice (RBARON.MAC:2715-2716). */
const VALDIV = 16

/**
 * VALFRC — the score multiplier. `LDA I,7 / STA VALFRC ;INITIALLY 7/10*DEPTH PLANE SCORE`
 * (RBARON.MAC:5964-5965).
 */
const VALFRC = 7

/**
 * VALMIN — the floor under PLVALU (RBARON.MAC:2718-2720). It is zeroed with the other
 * game-start variables and then INCREMENTED, alongside VALFRC, once per plane launched
 * (STPLNE, RBARON.MAC:2277-2285), so by the time any plane can be scored it is >= 1 —
 * i.e. a point-blank plane is worth as little as 10 points.
 *
 * NOTE: that per-plane RAMP (both counters climbing to a 0x18 cap) is a stateful scoring
 * mechanic this story does not thread — see the session's Delivery Findings. Here we take
 * the values at the first scoreable kill, which is the ROM's own floor.
 */
const VALMIN = 1

// ─── scoring ──────────────────────────────────────────────────────────────────

/** What was shot down — the lead scores by depth; drones and the blimp are flat. */
export type KillKind = 'lead' | 'drone' | 'blimp'

/** Exhaustiveness guard: a new KillKind that dodges the switch is a compile error (rule #3). */
const assertNever = (kind: never): never => {
  throw new Error(`scoreKill: unhandled KillKind ${String(kind)}`)
}

/**
 * PLVALU — the lead's value, which COUNTS DOWN as it closes.
 *
 * A FAR/dim plane (depth MSB >= 0x10, i.e. depth >= HORZ) pays the flat DRNPNT. Inside
 * that gate it pays `depthMSB x VALFRC / 16`, floored at VALMIN — so it is worth 300 far,
 * ~60 just inside the gate, and as little as 10 point-blank. It is NEVER worth more than
 * a drone. Total: a degenerate depth folds to the VALMIN floor rather than leaking NaN.
 */
const leadScore = (depth: number): number => {
  const msb = Number.isFinite(depth) ? Math.floor(Math.max(0, depth) / 0x100) : 0
  if (msb >= BONUS_DEPTH_MSB) return DRONE_SCORE // "XTRA POINTS IF DIM"
  return Math.max(VALMIN, Math.floor((msb * VALFRC) / VALDIV)) * SCORE_UNIT
}

/**
 * Points for a kill. 'lead' is depth-scaled and counts DOWN as the plane closes (the
 * enemy depth convention: SMALLER depth is nearer); 'drone' and 'blimp' are flat,
 * depth-independent. Total — every KillKind returns a positive, finite score.
 */
export function scoreKill(kind: KillKind, depth: number): number {
  switch (kind) {
    case 'lead':
      return leadScore(depth)
    case 'drone':
      return DRONE_SCORE
    case 'blimp':
      return BLIMP_SCORE
    default:
      return assertNever(kind)
  }
}

/**
 * OBJKLD → GMLEVL = PLNLVL[min(OBJKLD >> 1, 0x10)]. The ROM HALVES the kill count before
 * the table lookup — `LSR` then `CMP I,10` (0x10 = 16) clamps the index (RBARON.MAC:2403-2405).
 * Indexing PLNLVL by OBJKLD directly ramped the difficulty exactly TWICE as fast as the
 * arcade's (rb4-7 AC-1). Total — a negative or non-finite count reads as level 0, never off
 * the table; the clamp saturates at MAX_GMLEVL.
 */
export function gmlevlForKills(objkld: number): number {
  if (!Number.isFinite(objkld)) return 0
  const halved = Math.max(0, Math.floor(objkld)) >> 1 // the ROM's LSR — halve, then clamp
  const index = Math.min(halved, PLNLVL.length - 1)
  return PLNLVL[index]
}

// src/core/scoring.ts
//
// The score half of the kill payoff — story rb2-6. A downed plane is worth points,
// and the running KILL COUNT ramps the difficulty. Grounded in findings §4
// ("Scoring tied to mechanics", PLNSCR/DRNSCR, R2BRON.MAC:3034-3046) and §3 (the
// OBJKLD → GMLEVL level table, PLNLVL). Two ROM facts drive this module:
//
//   1. PLVALU = depth × VALFRC — a lit/close LEAD plane is worth MORE the closer it is
//      when killed ("closer kills are worth more"). DRONES and dim/far planes are a flat
//      300 (DRNPNT=30. ×10); the BLIMP is a flat 200.
//   2. Each kill bumps OBJKLD, which indexes PLNLVL to set GMLEVL (ceiling .LEVLS=5) —
//      more kills → higher level → a more aggressive sky (drives the enemy weave width
//      and, at rb2-7, spawn counts).
//
// THE DEPTH-CONVENTION TWIST (findings §4 vs enemy.ts): the ROM writes PLVALU as
// `depth × VALFRC`, but our enemy depth SHRINKS as the plane nears (P_INDP=1080 far →
// MIN_DEPTH close), so "closer worth more" means the lead score must DECREASE with
// depth. We honour the doc's stated behaviour, not its literal arithmetic: the far/dim
// lead meets the flat DRONE_SCORE floor, and closing in adds a VALFRC-scaled bonus for
// the depth closed. (See the session's Design Deviations.)
//
// PURE and deterministic — no DOM, no time, no randomness. A leaf module: it only reads
// enemy.ts's ROM constant P_INDP (the far spawn depth) to anchor the closeness scale.

import { P_INDP } from './enemy'

// ─── ROM-exact data (findings §4, §3) ─────────────────────────────────────────

/** DRNPNT=30. ×10 — flat value of a drone / dim-far plane, at any depth (findings §4). */
export const DRONE_SCORE = 300

/** Flat value of the blimp/Zeppelin, at any depth (findings §4). */
export const BLIMP_SCORE = 200

/** PLNLVL — OBJKLD → GMLEVL: kill-count-indexed difficulty, saturating at 5 (findings §3). */
export const PLNLVL: readonly number[] = Object.freeze([0, 0, 0, 0, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 4, 4, 5])

/** .LEVLS — the difficulty ceiling: the top of the PLNLVL table. */
export const MAX_GMLEVL = Math.max(...PLNLVL)

// ─── tuning within the tested invariants (inferred — NOT ROM-pinned) ─────────

/**
 * VALFRC — the score fraction, "starts 7/10" (findings §4). The ROM's depth units are
 * not pinned to our screen-window space, so this scales the closeness BONUS above the
 * DRONE_SCORE floor; the ORDERING (closer = more) is the ROM fact, this rate is tuning.
 */
const VALFRC = 0.7

// ─── scoring ──────────────────────────────────────────────────────────────────

/** What was shot down — the lead scores by depth; drones and the blimp are flat. */
export type KillKind = 'lead' | 'drone' | 'blimp'

/** Exhaustiveness guard: a new KillKind that dodges the switch is a compile error (rule #3). */
const assertNever = (kind: never): never => {
  throw new Error(`scoreKill: unhandled KillKind ${String(kind)}`)
}

/**
 * PLVALU for the lit/close lead: the far/dim plane meets the flat DRONE_SCORE floor, and
 * every unit of depth CLOSED (below P_INDP) adds a VALFRC-scaled bonus — so a plane gunned
 * down up close is worth strictly more than one picked off far away (findings §4).
 */
const leadScore = (depth: number): number => DRONE_SCORE + Math.round(Math.max(0, P_INDP - depth) * VALFRC)

/**
 * Points for a kill. 'lead' is depth-scaled (closer = more, per the enemy depth
 * convention where SMALLER depth is nearer); 'drone' and 'blimp' are flat, depth-
 * independent. Total — every KillKind returns a positive, finite score.
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
 * OBJKLD → GMLEVL: index PLNLVL by the kill count, clamped to a valid rung, saturating at
 * MAX_GMLEVL. Total — a negative or non-finite count reads as level 0, never off the table.
 */
export function gmlevlForKills(objkld: number): number {
  if (!Number.isFinite(objkld)) return 0
  const index = Math.max(0, Math.min(Math.floor(objkld), PLNLVL.length - 1))
  return PLNLVL[index]
}

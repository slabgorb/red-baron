// tests/core/returning-ace.test.ts
//
// Story rb2-8 — RED phase (Han Solo / TEA). THE RETURNING ACE: the signature
// "bank hard to shake him" mechanic. A plane flies by, closes past P.MNDP, then
// comes back on your six — "BEHIND YOU" — and the only way out is to break-turn
// to the correct side, hard enough, in time. First one's a freebie; after that
// it's a coin flip unless you fly it right.
//
// CONTRACT for the GREEN phase (Yoda / DEV): create `src/core/returning-ace.ts`,
// a PURE module (no DOM, no time, the ONLY randomness is a supplied `roll`),
// exporting:
//
//   // --- ROM-exact constants (findings §3 P.UPD0, §5 EOLSEQ) ---
//   export const P_MNDP: number          // close threshold = 140 (R2BRON.MAC:2723-2738)
//   export const HARD_TURN: number        // |PLDELX| ≥ 0x1C (28) to shake him (EOLSEQ, findings §5)
//   export const PLPOSZ: readonly number[] // GMLEVL-indexed close speed — deeper levels close FASTER
//
//   // --- the P.UPD0 fly-by → return-from-six ---
//   export function closesPast(depth: number): boolean   // has the plane closed past P.MNDP?
//   export function closeSpeed(level: number): number     // PLPOSZ[GMLEVL] — clamped, total
//
//   export interface ReturningAce {
//     readonly side: -1 | 1        // ENSIDE — which side it closed from (the "BEHIND YOU" side)
//     readonly firstPass: boolean  // BEFLAG — is the FIRST-TIME-FREE dodge still armed?
//   }
//   export function beginPass(side: -1 | 1): ReturningAce  // records ENSIDE, arms BEFLAG
//
//   // --- the EOLSEQ evade check (findings §5) ---
//   export type EvadeResult = 'evaded' | 'hit'
//   export function evadeCheck(
//     ace: ReturningAce,
//     turnRate: number,   // the player's live PLDELX (flight.ts FlightState.turnRate)
//     roll: number,       // [0,1) — the RANDOM 50/50 draw (caller supplies; deterministic)
//   ): { result: EvadeResult; ace: ReturningAce }
//
// WHY THIS SHAPE (cited — findings §3 "The 'Red Baron' pass", §5 "Collision/damage"):
//   * THE PASS (P.UPD0, R2BRON.MAC:2723-2738): "when a plane closes past P.MNDP=140
//     it enables returning-plane shells, fires the 'BEHIND YOU' message, records
//     ENSIDE (which side), and re-enters as a returning plane (NWENME) that intercepts
//     the player." So `closesPast(depth)` is the trigger, and `beginPass(side)` records
//     ENSIDE + arms the free first dodge. enemy.ts already bores the plane in to a floor
//     of exactly MIN_DEPTH=140 (= P.MNDP) — the trigger fires when it reaches that floor.
//   * DEEPER LEVELS CLOSE FASTER (PLPOSZ, GMLEVL-indexed, findings §3): the close speed
//     is level-indexed and RISES with level. The source pins the mechanism, not the byte
//     values, so PLPOSZ is tested BEHAVIOURALLY — length .LEVLS=5, positive, non-decreasing,
//     clamped/total on a bad level — NOT as fabricated magic numbers.
//   * THE EVADE CHECK (EOLSEQ, R2BRON.MAC:1070-1102, findings §5): at the ace's attack
//     the game checks the player's bank — `ENSIDE EOR PLDELX` must show banking to the
//     CORRECT side AND `|PLDELX| ≥ 0x1C` (a hard-enough turn) to evade. "First attack is
//     a free dodge (BEFLAG 'FIRST TIME FREE'); every subsequent one is 50/50 (RANDOM)."
//     This is the core "bank hard to shake him" mechanic.
//
// EVADE SEMANTICS — the branch structure (INFERRED from the finding text; logged as a
// TEA design deviation, for the Reviewer/playtest to ratify):
//   1. FIRST pass  → EVADED unconditionally (BEFLAG free), and BEFLAG is CONSUMED.
//   2. after that, a SKILL dodge — correct side AND hard turn — → EVADED, guaranteed
//      (this is why it is "bank hard to SHAKE him", not a pure coin flip).
//   3. after that, WITHOUT a skill dodge (wrong side OR soft turn) → the 50/50 RANDOM:
//      roll < 0.5 → evaded, else → hit.
//   "Correct side" polarity is `sign(PLDELX) === ENSIDE` (turn TOWARD the side he came
//   from). The ROM does `ENSIDE EOR PLDELX` and branches on the sign bit; which branch is
//   "correct" is not pinned by the finding, so the polarity is inferred + logged.
//
// Loaded defensively (await import in beforeAll — the enemy.test.ts / flight.test.ts
// house pattern): during RED `src/core/returning-ace.ts` does not exist, so each test
// reports a clean assertion failure instead of a suite-collection crash. flight.ts and
// enemy.ts DO exist — imported statically so the integration tests drive the REAL flight
// model (the pilot really can reach HARD_TURN) and the REAL enemy weave (it really bores
// in to the P.MNDP trigger).

import { describe, it, expect, beforeAll } from 'vitest'
import { createRng } from '@arcade/shared/rng'
import {
  step as flightStep,
  INITIAL_FLIGHT,
  type FlightState,
  type ProximityBand,
} from '../../src/core/flight'
import { spawn as spawnEnemy, step as stepEnemy, type Enemy } from '../../src/core/enemy'

// --- local mirror of the RED contract (kept out of the static import graph so the
//     file loads while src/core/returning-ace.ts does not yet exist) ---

type EvadeResult = 'evaded' | 'hit'

interface ReturningAce {
  readonly side: -1 | 1
  readonly firstPass: boolean
}

interface ReturningAceModule {
  P_MNDP?: number
  HARD_TURN?: number
  PLPOSZ?: readonly number[]
  closesPast?: (depth: number) => boolean
  closeSpeed?: (level: number) => number
  beginPass?: (side: -1 | 1) => ReturningAce
  evadeCheck?: (
    ace: ReturningAce,
    turnRate: number,
    roll: number,
  ) => { result: EvadeResult; ace: ReturningAce }
}

let m: ReturningAceModule = {}

beforeAll(async () => {
  try {
    m = (await import('../../src/core/returning-ace')) as ReturningAceModule
  } catch {
    m = {}
  }
})

/** Fail loud-and-clear when a contract export is missing (RED-friendly). */
function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`src/core/returning-ace.ts must export ${name} (rb2-8 RED contract)`)
  }
  return value
}

/** A fresh returning ace from `side`, with the BEFLAG free-dodge armed. */
const ace = (side: -1 | 1): ReturningAce => need(m.beginPass, 'beginPass')(side)

/** An ace whose FIRST-TIME-FREE dodge has already been spent (firstPass = false). */
const veteranAce = (side: -1 | 1): ReturningAce => {
  // Spend the freebie via the real evadeCheck so the "consumed" state is genuine,
  // not hand-forged — a soft, wrong-side turn on the first pass is a free evade.
  const check = need(m.evadeCheck, 'evadeCheck')
  return check(ace(side), 0, 0.99).ace
}

/** Settle the REAL flight model at a yoke position and read PLDELX (turnRate). */
function settledTurnRate(turn: number, frames = 12, proximity: ProximityBand = 'near'): number {
  let s: FlightState = INITIAL_FLIGHT
  for (let i = 0; i < frames; i++) s = flightStep(s, { turn, pitch: 0, proximity })
  return s.turnRate
}

// ───────────────────────────────────────────────────────────────────────────
// AC-1 — the ROM-exact thresholds (P.MNDP close distance, 0x1C hard-turn)
// ───────────────────────────────────────────────────────────────────────────
describe('returning-ace — ROM thresholds (findings §3 P.UPD0, §5 EOLSEQ)', () => {
  // rb4-1 RE-BASELINE. Asserted the DECIMAL misreading and cited the DECOY build
  // (R2BRON.MAC — never shipped). `P.MNDP =140` is in a `.RADIX 16` region: 0x140 = 320.
  // The fly-by trigger was firing 2.3× too late.
  it('P_MNDP — the close distance that triggers the pass — is 0x140 = 320 (RBARON.MAC:469, .RADIX 16)', () => {
    expect(need(m.P_MNDP, 'P_MNDP')).toBe(0x140)
    expect(need(m.P_MNDP, 'P_MNDP')).not.toBe(140) // the decimal misreading we shipped
  })

  it('HARD_TURN — the |PLDELX| needed to shake him — is 0x1C = 28 (EOLSEQ, findings §5)', () => {
    expect(need(m.HARD_TURN, 'HARD_TURN')).toBe(0x1c)
    expect(need(m.HARD_TURN, 'HARD_TURN')).toBe(28)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-2 — closesPast: the P.UPD0 fly-by trigger (closes PAST P.MNDP)
// ───────────────────────────────────────────────────────────────────────────
describe('returning-ace — closesPast (P.UPD0 fly-by trigger)', () => {
  it('does NOT trigger while the plane is still far (spawn depth is not a pass)', () => {
    const closesPast = need(m.closesPast, 'closesPast')
    // rb4-1 RE-BASELINE: the threshold is P.MNDP = 0x140 = 320, so these fixtures — which
    // were keyed to the decimal 140 — all had to move OUT. 300 and 141 are now PAST it.
    expect(closesPast(0x1080)).toBe(false) // P.INDP spawn depth (4224)
    expect(closesPast(1000)).toBe(false)
    expect(closesPast(0x141)).toBe(false) // one unit shy of the threshold — not yet
  })

  it('triggers exactly when the plane reaches / passes P.MNDP (boundary is inclusive)', () => {
    const closesPast = need(m.closesPast, 'closesPast')
    const mndp = need(m.P_MNDP, 'P_MNDP')
    expect(closesPast(mndp)).toBe(true) // AT the threshold — the enemy floors here (MIN_DEPTH=140)
    expect(closesPast(mndp - 1)).toBe(true) // and past it
    expect(closesPast(1)).toBe(true) // point blank
  })

  it('is TOTAL — a degenerate depth (NaN, ±Infinity) yields a boolean, never throws (rule #4)', () => {
    const closesPast = need(m.closesPast, 'closesPast')
    for (const d of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(typeof closesPast(d)).toBe('boolean')
    }
    // −Infinity has "closed past" any finite threshold; +Infinity / NaN have not.
    expect(closesPast(Number.NEGATIVE_INFINITY)).toBe(true)
    expect(closesPast(Number.POSITIVE_INFINITY)).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-3 — PLPOSZ: deeper GMLEVLs close FASTER (findings §3)
//
// rb4-1 RE-BASELINE (EN-014). This block asserted a table that was wrong in all four
// respects the ROM pins. RBARON.MAC:2482, in the `.RADIX 16` region:
//
//     PLPOSZ: .BYTE -4,-10,-20,-30,-40,-50,-60,-70,-80
//
// SIGN      the entries are NEGATIVE — they are ADDED to the display depth
//           (RBARON.MAC:2704-2707), so the depth FALLS. We shipped positives.
// MAGNITUDE they are HEX: -4,-16,-32,-48,-64,-80,-96,-112,-128. We shipped decimals.
// LENGTH    NINE entries. We shipped five.
// RAMP      GMLEVL 0..5 is all that PLNZD ever indexes (:2409-2411), i.e. -4 .. -80 —
//           a 20× acceleration across the game. We shipped 8→20, a 2.5× ramp, with
//           level 0 twice too fast and level 5 four times too slow.
//
// The sign flip means `closeSpeed` now returns a NEGATIVE delta. Whether the caller
// ADDS it (the ROM's own idiom) or negates it is Dev's call — but it can no longer be
// "always positive", and asserting that was what locked the bug in. The derivation is
// audited from the ROM in tests/audit/radix-transcription.test.ts.
// ───────────────────────────────────────────────────────────────────────────
describe('returning-ace — PLPOSZ close speed rises with GMLEVL (findings §3)', () => {
  it('PLPOSZ is the GMLEVL-indexed table of NINE entries (RBARON.MAC:2482)', () => {
    const t = need(m.PLPOSZ, 'PLPOSZ')
    expect(t.length).toBe(9)
    expect(t.length).not.toBe(5) // the truncated table we shipped
  })

  it('every close speed is NEGATIVE — it is added to the depth, so the plane bores IN', () => {
    for (const v of need(m.PLPOSZ, 'PLPOSZ')) expect(v).toBeLessThan(0)
  })

  it('deeper levels close FASTER — the magnitudes rise strictly, 0x04 → 0x80', () => {
    const t = need(m.PLPOSZ, 'PLPOSZ')
    for (let lvl = 1; lvl < t.length; lvl++) {
      expect(Math.abs(t[lvl])).toBeGreaterThan(Math.abs(t[lvl - 1])) // strictly faster each level
    }
    // Only GMLEVL 0..5 is reachable (PLNZD, RBARON.MAC:2409-2411). The ROM byte at index 5
    // is the literal `-50` — i.e. -0x50 = -80 decimal. (The table's LAST byte is the literal
    // `-80` = -0x80 = -128, at index 8, which GMLEVL never reaches.) The audit's "4/frame at
    // GMLEVL 0 to 80/frame at GMLEVL 5" quotes DECIMAL 80 = 0x50 — and the 20× ratio below
    // only closes on that reading: 128/4 would be 32.
    expect(t[0]).toBe(-0x04)
    expect(t[5]).toBe(-0x50)
    expect(t[8]).toBe(-0x80) // the table's tail, beyond any reachable GMLEVL
    expect(Math.abs(t[5]) / Math.abs(t[0])).toBe(20) // the ROM's 20× ramp, not our 2.5×
  })

  it('closeSpeed(level) reads PLPOSZ and clamps an out-of-range GMLEVL — total, always negative', () => {
    const closeSpeed = need(m.closeSpeed, 'closeSpeed')
    const t = need(m.PLPOSZ, 'PLPOSZ')
    expect(closeSpeed(0)).toBe(t[0])
    expect(closeSpeed(4)).toBe(t[4])
    for (const bad of [-1, -100, 9, 99, Number.NaN, 2.7]) {
      const v = closeSpeed(bad)
      expect(Number.isFinite(v)).toBe(true) // no PLPOSZ[undefined] leak
      expect(v).toBeLessThan(0) // a clamped level still closes, never retreats
    }
    expect(closeSpeed(2.7)).toBe(t[2]) // a non-integer level floors to a valid index
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-4 — beginPass: record ENSIDE + arm the FIRST-TIME-FREE dodge (BEFLAG)
// ───────────────────────────────────────────────────────────────────────────
describe('returning-ace — beginPass records ENSIDE and arms BEFLAG', () => {
  it('records the side the plane closed from (ENSIDE) — the "BEHIND YOU" side', () => {
    expect(ace(1).side).toBe(1)
    expect(ace(-1).side).toBe(-1)
  })

  it('arms the first-time-free dodge (BEFLAG) on a fresh pass', () => {
    expect(ace(1).firstPass).toBe(true)
    expect(ace(-1).firstPass).toBe(true)
  })

  it('a returning ace can be built from a real enemy that entered from a side', () => {
    // ENSIDE = the plane's entry side. Prove the seam: spawn a real enemy, take its
    // `side`, and beginPass mirrors it — the returning ace remembers which shoulder to
    // check. (Several seeds so both -1 and +1 are exercised.)
    for (const seed of [1, 2, 7, 42, 100]) {
      const e: Enemy = spawnEnemy(createRng(seed), 0)
      expect(ace(e.side).side).toBe(e.side)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-5 — the FIRST pass is free (BEFLAG "FIRST TIME FREE"), then consumed
// ───────────────────────────────────────────────────────────────────────────
describe('returning-ace — evadeCheck: the first pass is a free dodge', () => {
  it('the FIRST pass ALWAYS evades — even with no bank and a losing roll', () => {
    const check = need(m.evadeCheck, 'evadeCheck')
    // Zero turn (no skill) + a roll that would LOSE a coin flip (>= 0.5): still free.
    expect(check(ace(1), 0, 0.99).result).toBe('evaded')
    expect(check(ace(-1), 0, 0.99).result).toBe('evaded')
  })

  it('the FIRST pass CONSUMES BEFLAG — the returned ace is no longer on its first pass', () => {
    const check = need(m.evadeCheck, 'evadeCheck')
    const after = check(ace(1), 0, 0.99).ace
    expect(after.firstPass).toBe(false) // the freebie is spent
    expect(after.side).toBe(1) // ...but it still remembers ENSIDE
  })

  it('consumes the freebie EVEN when the first pass was also a valid skill dodge', () => {
    // A hard, correct-side first pass evades either way; BEFLAG is still spent, so the
    // NEXT pass gets no freebie. (Pins that "first pass" means the first check, not the
    // first *failed* check.)
    const check = need(m.evadeCheck, 'evadeCheck')
    const skillFirst = check(ace(1), 40, 0.99) // correct side (+), hard turn (40 ≥ 28)
    expect(skillFirst.result).toBe('evaded')
    expect(skillFirst.ace.firstPass).toBe(false)
  })

  it('after the freebie, a defenceless pass (no bank, losing roll) HITS — the free ride is over', () => {
    const check = need(m.evadeCheck, 'evadeCheck')
    const veteran = veteranAce(1)
    expect(veteran.firstPass).toBe(false)
    expect(check(veteran, 0, 0.99).result).toBe('hit') // no skill, roll lost → death
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-6 — the SKILL dodge: correct side AND hard turn shakes him, guaranteed
// ───────────────────────────────────────────────────────────────────────────
describe('returning-ace — evadeCheck: bank hard to the correct side always shakes him', () => {
  it('correct-side + hard turn EVADES regardless of the roll (skill beats the coin flip)', () => {
    const check = need(m.evadeCheck, 'evadeCheck')
    // ace from +1 → correct bank is +; a hard +40 turn evades even on a would-be-losing roll.
    expect(check(veteranAce(1), 40, 0.99).result).toBe('evaded')
    expect(check(veteranAce(1), 40, 0.0).result).toBe('evaded')
    // symmetric on the other shoulder
    expect(check(veteranAce(-1), -40, 0.99).result).toBe('evaded')
  })

  it('the skill dodge is a GUARANTEE across the whole roll range (never a hidden coin flip)', () => {
    const check = need(m.evadeCheck, 'evadeCheck')
    for (let roll = 0; roll < 1; roll += 0.1) {
      expect(check(veteranAce(1), 40, roll).result).toBe('evaded')
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-7 — no skill dodge → the 50/50 RANDOM coin flip (roll-driven, deterministic)
// ───────────────────────────────────────────────────────────────────────────
describe('returning-ace — evadeCheck: 50/50 when the maneuver is not flown', () => {
  it('a WINNING roll (< 0.5) survives a defenceless subsequent pass', () => {
    const check = need(m.evadeCheck, 'evadeCheck')
    expect(check(veteranAce(1), 0, 0.49).result).toBe('evaded')
    expect(check(veteranAce(1), 0, 0.0).result).toBe('evaded')
  })

  it('a LOSING roll (≥ 0.5) is death on a defenceless subsequent pass', () => {
    const check = need(m.evadeCheck, 'evadeCheck')
    expect(check(veteranAce(1), 0, 0.5).result).toBe('hit') // exactly 0.5 is a loss (< 0.5 to win)
    expect(check(veteranAce(1), 0, 0.99).result).toBe('hit')
  })

  it('is DETERMINISTIC in the roll — same (ace, turnRate, roll) gives the same verdict', () => {
    const check = need(m.evadeCheck, 'evadeCheck')
    const v = veteranAce(1)
    expect(check(v, 0, 0.3).result).toBe(check(v, 0, 0.3).result)
    expect(check(v, 0, 0.7).result).toBe(check(v, 0, 0.7).result)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-8 — BOTH conditions required; the HARD_TURN boundary; correct-side polarity
// ───────────────────────────────────────────────────────────────────────────
describe('returning-ace — evadeCheck: both correct-side AND hard-turn are required', () => {
  it('correct side but a SOFT turn is NOT a skill dodge — it falls to the coin flip', () => {
    const check = need(m.evadeCheck, 'evadeCheck')
    const soft = need(m.HARD_TURN, 'HARD_TURN') - 1 // 27: correct sign, but not hard enough
    expect(check(veteranAce(1), soft, 0.99).result).toBe('hit') // losing roll → dies
    expect(check(veteranAce(1), soft, 0.0).result).toBe('evaded') // winning roll → the coin saved him, not skill
  })

  it('a hard turn to the WRONG side is NOT a skill dodge — it falls to the coin flip', () => {
    const check = need(m.evadeCheck, 'evadeCheck')
    // ace from +1 → correct bank is +; a hard NEGATIVE turn is the wrong way.
    expect(check(veteranAce(1), -40, 0.99).result).toBe('hit')
    expect(check(veteranAce(1), -40, 0.0).result).toBe('evaded') // saved by the roll, not the (wrong-way) bank
  })

  it('the HARD_TURN boundary is inclusive — exactly 0x1C shakes him, one less does not', () => {
    const check = need(m.evadeCheck, 'evadeCheck')
    const hard = need(m.HARD_TURN, 'HARD_TURN') // 28
    expect(check(veteranAce(1), hard, 0.99).result).toBe('evaded') // 28, correct side, losing roll → still evades
    expect(check(veteranAce(1), hard - 1, 0.99).result).toBe('hit') // 27 is not hard enough → dies on the roll
  })

  it('correct-side polarity is symmetric — each shoulder demands its own bank direction', () => {
    const check = need(m.evadeCheck, 'evadeCheck')
    // from +1: +hard evades, −hard does not (needs the roll); from −1: mirror image.
    expect(check(veteranAce(1), 40, 0.99).result).toBe('evaded')
    expect(check(veteranAce(1), -40, 0.99).result).toBe('hit')
    expect(check(veteranAce(-1), -40, 0.99).result).toBe('evaded')
    expect(check(veteranAce(-1), 40, 0.99).result).toBe('hit')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-9 — rule #4 (0 is a real turn-rate, not a falsy default), purity, exhaustive union
// ───────────────────────────────────────────────────────────────────────────
describe('returning-ace — evadeCheck: totality, purity, exhaustive result', () => {
  it('turnRate = 0 is a REAL "no turn", handled as soft & side-less — not a falsy fallback (rule #4)', () => {
    // The classic `turnRate || default` bug: 0 is falsy but a VALID (zero) turn-rate that
    // must FAIL both the hard-turn and correct-side checks. On a veteran pass it therefore
    // rides the coin flip — never an accidental auto-evade or auto-hit.
    const check = need(m.evadeCheck, 'evadeCheck')
    expect(check(veteranAce(1), 0, 0.4).result).toBe('evaded') // 0 → coin flip, won
    expect(check(veteranAce(1), 0, 0.6).result).toBe('hit') // 0 → coin flip, lost
    expect(check(veteranAce(-1), 0, 0.6).result).toBe('hit') // sign-less 0 is wrong for either shoulder
  })

  it('does NOT mutate the input ace — the readonly state contract holds', () => {
    const check = need(m.evadeCheck, 'evadeCheck')
    const a = ace(1)
    const snapshot = JSON.stringify(a)
    check(a, 40, 0.5)
    expect(JSON.stringify(a)).toBe(snapshot) // caller's ace untouched; a fresh one is returned
  })

  it('ALWAYS returns a valid EvadeResult union member and a well-formed ace (exhaustive sweep)', () => {
    const check = need(m.evadeCheck, 'evadeCheck')
    for (const side of [-1, 1] as const) {
      for (const first of [ace(side), veteranAce(side)]) {
        for (const turnRate of [-40, -28, -1, 0, 1, 27, 28, 40]) {
          for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
            const out = check(first, turnRate, roll)
            expect(['evaded', 'hit']).toContain(out.result) // no stray result value
            expect(out.ace.side).toBe(side) // ENSIDE preserved
            expect(typeof out.ace.firstPass).toBe('boolean')
          }
        }
      }
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-10 — end-to-end: the pilot really can bank hard enough, and the real enemy
//          really closes to the trigger (keeps the thresholds honest, not decorative)
// ───────────────────────────────────────────────────────────────────────────
describe('returning-ace — integration with the REAL flight model + enemy weave', () => {
  it('a FULL-yoke break-turn reaches HARD_TURN through the real flight model — the dodge is flyable', () => {
    const hard = need(m.HARD_TURN, 'HARD_TURN')
    const right = settledTurnRate(1) // full right yoke
    const left = settledTurnRate(-1) // full left yoke
    expect(Math.abs(right)).toBeGreaterThanOrEqual(hard) // the player CAN reach a hard turn
    expect(Math.abs(left)).toBeGreaterThanOrEqual(hard)
    expect(Math.sign(right)).toBe(1) // ...and the sign tracks the yoke direction (ENSIDE polarity)
    expect(Math.sign(left)).toBe(-1)
  })

  it('a full-yoke turn to the correct side actually EVADES a real veteran ace', () => {
    // Close the loop: fly the real controls, feed the settled PLDELX into the evade check.
    const check = need(m.evadeCheck, 'evadeCheck')
    const rightTurn = settledTurnRate(1) // +, hard
    expect(check(veteranAce(1), rightTurn, 0.99).result).toBe('evaded') // flew it right → shook him
    expect(check(veteranAce(-1), rightTurn, 0.99).result).toBe('hit') // wrong shoulder → the roll lost
  })

  it('a GENTLE turn does NOT reach HARD_TURN — a lazy bank cannot skill-dodge', () => {
    const hard = need(m.HARD_TURN, 'HARD_TURN')
    const gentle = settledTurnRate(0.5) // half yoke → settles below the hard-turn bar
    expect(Math.abs(gentle)).toBeLessThan(hard)
    const check = need(m.evadeCheck, 'evadeCheck')
    expect(check(veteranAce(1), gentle, 0.99).result).toBe('hit') // not hard enough → dies on the roll
  })

  it('the REAL enemy weave bores in until closesPast fires — spawn is far, the floor triggers', () => {
    // enemy.step closes the depth toward its MIN_DEPTH floor (= P.MNDP = 0x140 = 320).
    // closesPast is false at the far spawn and true once the plane reaches that floor.
    // rb4-1: the spawn depth is now 0x1080 = 4224, so the plane needs ~490 calc-frames to
    // bore in at CLOSE_SPEED — the old 400-step budget no longer reached the floor.
    const closesPast = need(m.closesPast, 'closesPast')
    let e: Enemy = spawnEnemy(createRng(7), 0)
    expect(closesPast(e.depth)).toBe(false) // spawns far — no pass yet
    for (let i = 0; i < 800; i++) e = stepEnemy(e, 0) // bore all the way in
    expect(closesPast(e.depth)).toBe(true) // reached the P.MNDP floor → the pass triggers
  })
})

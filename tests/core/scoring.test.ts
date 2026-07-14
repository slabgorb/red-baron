// tests/core/scoring.test.ts
//
// Story rb2-6 — RED phase (O'Brien / TEA). The score half of the kill payoff: a
// downed plane is worth points, and the KILL COUNT ramps the difficulty. Grounded in
// findings §4 ("Scoring tied to mechanics", PLNSCR/DRNSCR, R2BRON.MAC:3034-3046) and
// §3 (the OBJKLD → GMLEVL level table, PLNLVL). Two ROM facts drive this module:
//
//   1. PLVALU = depth × VALFRC — a lit/close LEAD plane is worth more the CLOSER it is
//      when killed ("closer kills are worth more"); DRONES and dim/far planes are a flat
//      300 (DRNPNT=30. ×10); the BLIMP is a flat 200.
//   2. Each kill bumps OBJKLD, which indexes PLNLVL to set GMLEVL (ceiling .LEVLS=5) —
//      more kills → higher level → a more aggressive sky (drives rb2-7 spawn scaling).
//
// CONTRACT for the GREEN phase (Julia / DEV): create `src/core/scoring.ts`, the pure
// scoring + level-ramp module, exporting:
//
//   // --- ROM-exact data (findings §4, §3) ---
//   export const DRONE_SCORE: number  // 300 — flat drone / dim-far plane value (DRNPNT=30. ×10)
//   export const BLIMP_SCORE: number  // 200 — flat blimp value
//   export const MAX_GMLEVL: number   // 5   — the .LEVLS difficulty ceiling
//   export const PLNLVL: readonly number[]  // [0,0,0,0,1,2,2,2,3,3,3,4,4,4,4,4,5], OBJKLD-indexed
//
//   export type KillKind = 'lead' | 'drone' | 'blimp'  // what was shot down
//
//   // PLVALU / DRNSCR — points for a kill. 'lead' is depth-scaled (closer = MORE points,
//   // per the enemy depth convention where a SMALLER depth is nearer); 'drone' is a flat
//   // DRONE_SCORE and 'blimp' a flat BLIMP_SCORE, both independent of depth.
//   export function scoreKill(kind: KillKind, depth: number): number
//
//   // OBJKLD → GMLEVL. Index PLNLVL by the kill count, clamped to [0, PLNLVL.length-1];
//   // the value tops out at MAX_GMLEVL. Total: a non-finite / negative count clamps to 0.
//   export function gmlevlForKills(objkld: number): number
//
// WHY THIS SHAPE (cited — findings §4 "Scoring", §3 "OBJKLD → GMLEVL", R2BRON.MAC):
//   * CLOSER KILLS ARE WORTH MORE (PLVALU). The lead's score is a STRICTLY decreasing
//     function of kill-depth: a plane gunned down up close (small depth) scores more than
//     the same plane picked off far away (large depth). A flat lead score — depth-scaling
//     removed — FAILS the monotonicity test. This is the ROM's reward-for-closing, pinned
//     behaviourally (the exact VALFRC curve is Dev tuning; the ORDERING is the ROM fact).
//   * DRONE / BLIMP ARE FLAT. A drone is worth DRONE_SCORE and a blimp BLIMP_SCORE at ANY
//     depth — killing one point-blank or at the horizon scores the same. Pinned as exact
//     byte values (300 / 200) AND as depth-INDEPENDENCE (the counterpoint to the lead).
//   * OBJKLD → GMLEVL RAMP. PLNLVL is byte-pinned; gmlevlForKills is a monotone non-
//     decreasing step function that saturates at MAX_GMLEVL and clamps a nonsense count to
//     level 0. This is what turns "you keep winning" into "the sky gets harder" (rb2-7).
//
// PURE and deterministic — no DOM, no time, no randomness. scoring.ts imports nothing
// from the sim; it is a leaf module, so it is imported statically once GREEN creates it.
// Loaded defensively (await import in beforeAll, the guns.test.ts house pattern) so this
// file loads cleanly during RED while src/core/scoring.ts does not yet exist.

import { describe, it, expect, beforeAll } from 'vitest'

// --- local mirror of the RED contract (kept out of the static import graph) ---

type KillKind = 'lead' | 'drone' | 'blimp'

interface ScoringModule {
  DRONE_SCORE?: number
  BLIMP_SCORE?: number
  MAX_GMLEVL?: number
  PLNLVL?: readonly number[]
  scoreKill?: (kind: KillKind, depth: number) => number
  gmlevlForKills?: (objkld: number) => number
}

let m: ScoringModule = {}

beforeAll(async () => {
  try {
    m = (await import('../../src/core/scoring')) as ScoringModule
  } catch {
    m = {}
  }
})

/** Fail loud-and-clear when a contract export is missing (RED-friendly). */
function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`src/core/scoring.ts must export ${name} (rb2-6 RED contract)`)
  }
  return value
}

// The enemy depth convention (enemy.ts): P_INDP=1080 is the far spawn depth, MIN_DEPTH=140
// is as close as it bores in. So NEAR = small depth, FAR = large depth.
// rb4-1 RE-BASELINE: both fixtures were the DECIMAL misreadings (P.MNDP =140 is
// 0x140 = 320; P.INDP =1080 is 0x1080 = 4224). The ROM's bonus-depth gate is the
// depth MSB against 0x10 (PLNSCR, RBARON.MAC:3039-3041), i.e. depth 0x1000 = 4096:
// at or beyond it the plane is "dim" and pays the flat DRNPNT; inside it the plane
// pays the (much smaller) PLVALU.
const NEAR_DEPTH = 0x140 // 320 — P.MNDP, nose-to-nose
const FAR_DEPTH = 0x1080 // 4224 — P.INDP, the spawn depth: DIM, beyond the bonus gate
const BONUS_DEPTH = 0x1000 // 4096 — the PLNSCR gate (depth MSB = 0x10)
const KINDS: readonly KillKind[] = ['lead', 'drone', 'blimp']

/** The ROM PLNLVL table (findings §3): OBJKLD-indexed, value = GMLEVL, saturates at 5. */
const EXPECTED_PLNLVL: readonly number[] = [0, 0, 0, 0, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 4, 4, 5]

// ───────────────────────────────────────────────────────────────────────────
// AC-1 — ROM-exact score values (drone 300, blimp 200) + the PLNLVL table
// ───────────────────────────────────────────────────────────────────────────
describe('scoring — ROM constants (findings §4, §3)', () => {
  it('DRONE_SCORE is 300 — flat drone / dim-far value (DRNPNT=30. ×10)', () => {
    expect(need(m.DRONE_SCORE, 'DRONE_SCORE')).toBe(300)
  })

  it('BLIMP_SCORE is 200 — flat blimp value (findings §4)', () => {
    expect(need(m.BLIMP_SCORE, 'BLIMP_SCORE')).toBe(200)
  })

  it('MAX_GMLEVL is 5 — the .LEVLS difficulty ceiling, and the table never exceeds it', () => {
    const max = need(m.MAX_GMLEVL, 'MAX_GMLEVL')
    expect(max).toBe(5)
    expect(Math.max(...need(m.PLNLVL, 'PLNLVL'))).toBe(max) // ceiling matches the table's top
  })

  it('PLNLVL is the byte-exact OBJKLD → GMLEVL table (findings §3)', () => {
    expect([...need(m.PLNLVL, 'PLNLVL')]).toEqual([...EXPECTED_PLNLVL])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-2 — PLVALU: the lead's value COUNTS DOWN as it closes (CB-003)
//
// rb4-1 RE-BASELINE — this block asserted the mechanism BACKWARDS. It was written from
// the poisoned findings doc ("closer kills are worth more"). The ROM does the opposite,
// and the primary source is unambiguous:
//
//   PLNSCR (RBARON.MAC:3038-3045):  LDA PLVALU / LDX PLSTAT+5 / CPX I,10 / BCC NWSCRE
//     depth MSB >= 0x10  ->  falls through to DRNSCR: the FLAT DRNPNT, ";XTRA POINTS IF DIM"
//     depth MSB <  0x10  ->  scores PLVALU instead
//   PLVALU (RBARON.MAC:2710-2721):  depth_MSB x VALFRC, then DIVBY4 twice (= /16),
//     floored at VALMIN. VALFRC starts at 7 (":5965  STA VALFRC ;INITIALLY 7/10*DEPTH").
//
// Because the depth SHRINKS as the plane approaches, PLVALU SHRINKS with it. The ROM's
// lead plane is worth 300 far, ~60 just inside the gate, and as little as VALMIN point-
// blank — it is NEVER worth more than a drone. You are paid for the difficult DISTANT
// shot, not the easy close one.
//
// Ours rose to 300 + (P_INDP - depth) x 0.7 = 1056 up close. And rb4-1 makes that WORSE
// on its own: correcting P_INDP to 0x1080 lifts the ceiling to 300 + 4224 x 0.7 = 3257,
// eleven times the ROM's. The radix fix and this inversion must land together.
// ───────────────────────────────────────────────────────────────────────────
describe('scoring — the lead\'s value COUNTS DOWN as it closes (PLVALU, CB-003)', () => {
  it('a FAR/dim lead pays the flat DRNPNT — and a near one pays STRICTLY LESS', () => {
    const scoreKill = need(m.scoreKill, 'scoreKill')
    const drone = need(m.DRONE_SCORE, 'DRONE_SCORE')
    expect(scoreKill('lead', FAR_DEPTH)).toBe(drone) // beyond the gate: the flat 300
    expect(scoreKill('lead', NEAR_DEPTH)).toBeLessThan(scoreKill('lead', FAR_DEPTH))
  })

  it('THE HEADLINE — a lead is NEVER worth more than a drone, at any depth', () => {
    // The single assertion that refutes what we shipped. Our leadScore peaked at 1056
    // (3257 once P_INDP is corrected); the ROM's ceiling is DRNPNT itself.
    const scoreKill = need(m.scoreKill, 'scoreKill')
    const drone = need(m.DRONE_SCORE, 'DRONE_SCORE')
    for (let depth = 0; depth <= 0x2000; depth += 0x40) {
      expect(scoreKill('lead', depth)).toBeLessThanOrEqual(drone)
    }
  })

  it('the lead score never RISES as the plane closes — it counts down', () => {
    // Sweep from far to near and require the score to never increase. This is the
    // behavioural detector for the inversion: our old implementation climbed here.
    const scoreKill = need(m.scoreKill, 'scoreKill')
    const depths = [FAR_DEPTH, BONUS_DEPTH, 0xf00, 0xa00, 0x600, 0x300, NEAR_DEPTH]
    for (let i = 1; i < depths.length; i++) {
      expect(scoreKill('lead', depths[i])).toBeLessThanOrEqual(scoreKill('lead', depths[i - 1]))
    }
    // …and it genuinely MOVES across the range — a flat lead score is not the fix.
    expect(scoreKill('lead', NEAR_DEPTH)).toBeLessThan(scoreKill('lead', FAR_DEPTH))
  })

  it('a lead kill is always a positive, finite number of points', () => {
    const scoreKill = need(m.scoreKill, 'scoreKill')
    for (const d of [NEAR_DEPTH, 300, 700, FAR_DEPTH]) {
      const pts = scoreKill('lead', d)
      expect(Number.isFinite(pts)).toBe(true)
      expect(pts).toBeGreaterThan(0)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-3 — drone / blimp are FLAT: depth-independent, exactly 300 / 200
// ───────────────────────────────────────────────────────────────────────────
describe('scoring — drones & the blimp are flat, depth-independent (findings §4)', () => {
  it('a drone is worth DRONE_SCORE at ANY depth — point-blank or at the horizon', () => {
    const scoreKill = need(m.scoreKill, 'scoreKill')
    const drone = need(m.DRONE_SCORE, 'DRONE_SCORE')
    for (const d of [NEAR_DEPTH, 300, 700, FAR_DEPTH]) {
      expect(scoreKill('drone', d)).toBe(drone) // flat — the depth does not matter
    }
  })

  it('a blimp is worth BLIMP_SCORE at ANY depth', () => {
    const scoreKill = need(m.scoreKill, 'scoreKill')
    const blimp = need(m.BLIMP_SCORE, 'BLIMP_SCORE')
    for (const d of [NEAR_DEPTH, 300, 700, FAR_DEPTH]) {
      expect(scoreKill('blimp', d)).toBe(blimp)
    }
  })

  it('the LEAD depends on depth but the DRONE does NOT — the two paths are genuinely different', () => {
    // Guards against a "score is always flat" regression that would pass AC-3 alone: the
    // lead MUST vary with depth while the drone MUST NOT. Both facts asserted together.
    const scoreKill = need(m.scoreKill, 'scoreKill')
    expect(scoreKill('lead', NEAR_DEPTH)).not.toBe(scoreKill('lead', FAR_DEPTH)) // lead varies
    expect(scoreKill('drone', NEAR_DEPTH)).toBe(scoreKill('drone', FAR_DEPTH)) // drone flat
  })

  it('every KillKind returns a positive finite score (#3 exhaustive union — no stray kind)', () => {
    const scoreKill = need(m.scoreKill, 'scoreKill')
    for (const kind of KINDS) {
      const pts = scoreKill(kind, 400)
      expect(Number.isFinite(pts)).toBe(true)
      expect(pts).toBeGreaterThan(0)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-4 — OBJKLD → GMLEVL: the kill-driven difficulty ramp
// ───────────────────────────────────────────────────────────────────────────
describe('scoring — OBJKLD → GMLEVL ramp (PLNLVL, findings §3)', () => {
  it('indexes PLNLVL by the kill count — every entry maps exactly', () => {
    const gmlevlForKills = need(m.gmlevlForKills, 'gmlevlForKills')
    EXPECTED_PLNLVL.forEach((level, kills) => {
      expect(gmlevlForKills(kills)).toBe(level) // OBJKLD k → PLNLVL[k]
    })
  })

  it('starts at level 0 with no kills (0 is a REAL level, not a falsy default — rule #4)', () => {
    expect(need(m.gmlevlForKills, 'gmlevlForKills')(0)).toBe(0)
  })

  it('the ramp never goes DOWN — more kills is never an easier sky (monotone non-decreasing)', () => {
    const gmlevlForKills = need(m.gmlevlForKills, 'gmlevlForKills')
    for (let k = 1; k <= 40; k++) {
      expect(gmlevlForKills(k)).toBeGreaterThanOrEqual(gmlevlForKills(k - 1))
    }
  })

  it('specific rungs: 4 kills → level 1, 5 → level 2, 16 → level 5 (findings §3)', () => {
    const gmlevlForKills = need(m.gmlevlForKills, 'gmlevlForKills')
    expect(gmlevlForKills(4)).toBe(1)
    expect(gmlevlForKills(5)).toBe(2)
    expect(gmlevlForKills(16)).toBe(5)
  })

  it('saturates at MAX_GMLEVL — a huge kill count never exceeds the .LEVLS ceiling', () => {
    const gmlevlForKills = need(m.gmlevlForKills, 'gmlevlForKills')
    const max = need(m.MAX_GMLEVL, 'MAX_GMLEVL')
    for (const k of [17, 30, 100, 10_000]) expect(gmlevlForKills(k)).toBe(max) // clamped, no overrun
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-5 — purity, determinism, totality (module contract; rb2-5 review lesson)
// ───────────────────────────────────────────────────────────────────────────
describe('scoring — pure, deterministic & total', () => {
  it('scoreKill and gmlevlForKills are pure — same inputs give the same outputs', () => {
    const scoreKill = need(m.scoreKill, 'scoreKill')
    const gmlevlForKills = need(m.gmlevlForKills, 'gmlevlForKills')
    expect(scoreKill('lead', 400)).toBe(scoreKill('lead', 400))
    expect(gmlevlForKills(7)).toBe(gmlevlForKills(7))
  })

  it('gmlevlForKills is TOTAL — a negative / non-finite kill count clamps to level 0 (VALUE pinned)', () => {
    // Pin the VALUE (0), not just "a number", so a regression that let a bad count read
    // garbage out of PLNLVL (undefined / NaN level) is caught — the rb2-5 review lesson.
    const gmlevlForKills = need(m.gmlevlForKills, 'gmlevlForKills')
    for (const bad of [-1, -100, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(gmlevlForKills(bad)).toBe(0)
    }
    // and a fractional count floors into a real rung, never undefined
    const frac = gmlevlForKills(4.9)
    expect(Number.isInteger(frac)).toBe(true)
    expect(need(m.PLNLVL, 'PLNLVL')).toContain(frac)
  })
})

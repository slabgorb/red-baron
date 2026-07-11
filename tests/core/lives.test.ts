// tests/core/lives.test.ts
//
// Story rb2-9 — RED phase (Han Solo / TEA). LIVES + DEATH SEQUENCE + RESPAWN GRACE.
// The damage channel the returning ace (rb2-8) hands off to: you get hit, the
// windshield takes a bullet-hole, the world spins down through a starfield, and
// ENDLFE decrements your planes — respawning you (briefly untouchable) if any
// remain, or ending the game if they don't.
//
// CONTRACT for the GREEN phase (Yoda / DEV): create `src/core/lives.ts`, a PURE
// module (no DOM, no time, no ambient randomness) exporting:
//
//   // --- ROM-exact constants (findings §5, R2BRON.MAC:1055-1291) ---
//   export const INITLF: readonly number[]   // options-indexed initial lives = [2,3,4,5]
//   export const WO_CNT: number              // spawn-grace = 5 frames (PLSTAT+7 disables enemies)
//   export const RESPAWN_ALTITUDE: number    // I4YPOS reset = 0x0210 (== flight.ts INITIAL_FLIGHT.altitude)
//
//   // --- the on-death windshield sequence, in ROM order (findings §5) ---
//   export type DeathPhase = 'bullethole' | 'spiral' | 'starfield'
//   export const DEATH_SEQUENCE: readonly DeathPhase[]   // ['bullethole','spiral','starfield']
//   export interface DeathSequence { readonly side: -1 | 1; readonly phase: number }
//   export function beginDeath(side: -1 | 1): DeathSequence               // bullet-hole first, records ENSIDE
//   export function advanceDeath(seq: DeathSequence): DeathSequence        // → next phase, clamps at the end (total)
//   export function currentPhase(seq: DeathSequence): DeathPhase | 'done'  // stage name, or 'done' when finished
//   export function deathComplete(seq: DeathSequence): boolean             // past starfield → ENDLFE fires
//
//   // --- lives + WO.CNT spawn grace (ENDLFE / GMINIT-INITIAL) ---
//   export interface Lives { readonly count: number; readonly grace: number }
//   export function initialLives(option?: number): Lives                   // seed count from INITLF[option], arm grace
//   export function loseLife(lives: Lives): { lives: Lives; gameOver: boolean } // DEC LIVES → respawn or game over
//   export function tickGrace(lives: Lives): Lives                         // one calc-frame: DEC grace, floor 0 (total)
//   export function enemiesDisabled(lives: Lives): boolean                 // WO.CNT gate: grace > 0 → planes off
//
// WHY THIS SHAPE (cited — findings §5 "Collision / damage / lives / respawn"):
//   * LIVES & RESPAWN (EOLSEQ→ENDLFE, R2BRON.MAC:1055-1210): "on death the windshield
//     BULLET-HOLE graphics step in (side = ENSIDE), the horizon scrolls down and the
//     playfield spins with a spiral sound, then a STARFIELD + plane-explosion; ENDLFE
//     does DEC LIVES → INITIAL respawn if any remain, else high-score entry. Initial
//     lives from options INITLF: .BYTE 2,3,4,5." So the death sequence is three ordered
//     stages (bullet-hole → spiral → starfield) and ENDLFE is DEC-then-respawn-or-over.
//   * RESPAWN SPAWN-GRACE (GMINIT/INITIAL, R2BRON.MAC:1215-1291): "on (re)spawn,
//     PLSTAT+7 = WO.CNT(5) DISABLES ENEMY PLANES FOR 5 FRAMES ... resets eye altitude
//     I4YPOS=0x0210. (Analogous to Battlezone's rez_protect spawn grace.)" So WO.CNT=5
//     is the grace window, enemiesDisabled is the gate, and RESPAWN_ALTITUDE=0x0210 is
//     the same altitude flight.ts already spawns at (INITIAL_FLIGHT.altitude).
//   * THE SEAM FROM rb2-8: returning-ace.ts states plainly its 'hit' verdict's damage
//     channel — "lives, the windshield bullet-hole (side = ENSIDE), respawn — is rb2-9".
//     The integration block below closes that loop: a real 'hit' feeds the real
//     bullet-hole side into beginDeath, runs the sequence, and lands on ENDLFE.
//
// INFERRED (finding pins the facts, not the encoding — logged as TEA design deviations):
//   * LIVES boundary: `count` is planes remaining (incl. the one being flown); ENDLFE's
//     "respawn if any remain" means game over exactly when the post-DEC count hits 0.
//   * DEATH_SEQUENCE has no per-stage frame DURATIONS in the source (unlike WO.CNT=5), so
//     it is modelled as an ordered cursor advanced one stage per advanceDeath — the shell
//     owns how many frames each stage renders. No fabricated stage lengths.
//   * INITLF default option is 0 (→ 2 lives); the operator DIP selects the real one.
//
// Loaded defensively (await import in beforeAll — the house RED pattern from
// returning-ace.test.ts): during RED `src/core/lives.ts` does not exist, so each test
// reports a clean assertion failure instead of a suite-collection crash. flight.ts and
// returning-ace.ts DO exist — imported statically so the integration tests drive the
// REAL spawn altitude and the REAL rb2-8 evade verdict feeding rb2-9's damage channel.

import { describe, it, expect, beforeAll } from 'vitest'
import { INITIAL_FLIGHT } from '../../src/core/flight'
import { beginPass, evadeCheck } from '../../src/core/returning-ace'

// --- local mirror of the RED contract (kept out of the static import graph so the
//     file loads while src/core/lives.ts does not yet exist) ---

type DeathPhase = 'bullethole' | 'spiral' | 'starfield'

interface DeathSequence {
  readonly side: -1 | 1
  readonly phase: number
}

interface Lives {
  readonly count: number
  readonly grace: number
}

interface LivesModule {
  INITLF?: readonly number[]
  WO_CNT?: number
  RESPAWN_ALTITUDE?: number
  DEATH_SEQUENCE?: readonly DeathPhase[]
  beginDeath?: (side: -1 | 1) => DeathSequence
  advanceDeath?: (seq: DeathSequence) => DeathSequence
  currentPhase?: (seq: DeathSequence) => DeathPhase | 'done'
  deathComplete?: (seq: DeathSequence) => boolean
  initialLives?: (option?: number) => Lives
  loseLife?: (lives: Lives) => { lives: Lives; gameOver: boolean }
  tickGrace?: (lives: Lives) => Lives
  enemiesDisabled?: (lives: Lives) => boolean
}

let m: LivesModule = {}

beforeAll(async () => {
  try {
    m = (await import('../../src/core/lives')) as LivesModule
  } catch {
    m = {}
  }
})

/** Fail loud-and-clear when a contract export is missing (RED-friendly). */
function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`src/core/lives.ts must export ${name} (rb2-9 RED contract)`)
  }
  return value
}

// ───────────────────────────────────────────────────────────────────────────
// AC-1 — ROM-exact constants (INITLF options table, WO.CNT grace, I4YPOS altitude)
// ───────────────────────────────────────────────────────────────────────────
describe('lives — ROM constants (findings §5, R2BRON.MAC)', () => {
  it('INITLF is the options-indexed initial-lives table .BYTE 2,3,4,5', () => {
    const t = need(m.INITLF, 'INITLF')
    expect(Array.from(t)).toEqual([2, 3, 4, 5])
  })

  it('WO_CNT — the respawn spawn-grace window — is 5 frames (PLSTAT+7 = WO.CNT)', () => {
    expect(need(m.WO_CNT, 'WO_CNT')).toBe(5)
  })

  it('RESPAWN_ALTITUDE is the ROM I4YPOS reset 0x0210 (findings §5)', () => {
    expect(need(m.RESPAWN_ALTITUDE, 'RESPAWN_ALTITUDE')).toBe(0x0210)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-2 — the death sequence: three ordered stages (bullet-hole → spiral → starfield)
// ───────────────────────────────────────────────────────────────────────────
describe('lives — DEATH_SEQUENCE ordered stages (findings §5)', () => {
  it('is exactly [bullethole, spiral, starfield] in ROM order', () => {
    const seq = need(m.DEATH_SEQUENCE, 'DEATH_SEQUENCE')
    expect(Array.from(seq)).toEqual(['bullethole', 'spiral', 'starfield'])
  })

  it('the bullet-hole steps in FIRST and the starfield is LAST (the death "spins down")', () => {
    const seq = need(m.DEATH_SEQUENCE, 'DEATH_SEQUENCE')
    expect(seq[0]).toBe('bullethole')
    expect(seq[seq.length - 1]).toBe('starfield')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-3 — beginDeath / advanceDeath / currentPhase / deathComplete: the progression
// ───────────────────────────────────────────────────────────────────────────
describe('lives — death sequence progression (bullet-hole records ENSIDE, then spins down)', () => {
  it('beginDeath records ENSIDE (the bullet-hole side) and opens on the bullet-hole', () => {
    const beginDeath = need(m.beginDeath, 'beginDeath')
    const currentPhase = need(m.currentPhase, 'currentPhase')
    expect(beginDeath(1).side).toBe(1)
    expect(beginDeath(-1).side).toBe(-1)
    expect(currentPhase(beginDeath(1))).toBe('bullethole') // the hole is on ENSIDE, shown first
    expect(currentPhase(beginDeath(-1))).toBe('bullethole')
  })

  it('advances through the stages in order, then completes into ENDLFE', () => {
    const beginDeath = need(m.beginDeath, 'beginDeath')
    const advanceDeath = need(m.advanceDeath, 'advanceDeath')
    const currentPhase = need(m.currentPhase, 'currentPhase')
    const deathComplete = need(m.deathComplete, 'deathComplete')

    let d = beginDeath(1)
    expect(currentPhase(d)).toBe('bullethole')
    expect(deathComplete(d)).toBe(false)

    d = advanceDeath(d)
    expect(currentPhase(d)).toBe('spiral') // horizon scrolls down, playfield spins

    d = advanceDeath(d)
    expect(currentPhase(d)).toBe('starfield') // then the starfield
    expect(deathComplete(d)).toBe(false) // still a visible stage — not done yet

    d = advanceDeath(d)
    expect(deathComplete(d)).toBe(true) // past the last stage → ENDLFE fires
    expect(currentPhase(d)).toBe('done')
  })

  it('advancing PAST the end is total — it clamps at "done", never off the end', () => {
    const beginDeath = need(m.beginDeath, 'beginDeath')
    const advanceDeath = need(m.advanceDeath, 'advanceDeath')
    const currentPhase = need(m.currentPhase, 'currentPhase')
    const deathComplete = need(m.deathComplete, 'deathComplete')
    let d = beginDeath(-1)
    for (let i = 0; i < 20; i++) d = advanceDeath(d) // over-advance
    expect(deathComplete(d)).toBe(true)
    expect(currentPhase(d)).toBe('done')
    expect(d.side).toBe(-1) // ENSIDE survives to the end
  })

  it('advanceDeath does NOT mutate its input (readonly state contract)', () => {
    const beginDeath = need(m.beginDeath, 'beginDeath')
    const advanceDeath = need(m.advanceDeath, 'advanceDeath')
    const d = beginDeath(1)
    const snapshot = JSON.stringify(d)
    advanceDeath(d)
    expect(JSON.stringify(d)).toBe(snapshot) // caller's sequence untouched
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-4 — initialLives: seed count from INITLF[option] + arm the WO.CNT grace
// ───────────────────────────────────────────────────────────────────────────
describe('lives — initialLives seeds from INITLF and arms spawn grace', () => {
  it('each option maps to its INITLF entry', () => {
    const initialLives = need(m.initialLives, 'initialLives')
    const t = need(m.INITLF, 'INITLF')
    for (let opt = 0; opt < t.length; opt++) {
      expect(initialLives(opt).count).toBe(t[opt])
    }
  })

  it('arms the WO.CNT spawn grace on the very first spawn (GMINIT/INITIAL)', () => {
    const initialLives = need(m.initialLives, 'initialLives')
    expect(initialLives(1).grace).toBe(need(m.WO_CNT, 'WO_CNT'))
    expect(need(m.enemiesDisabled, 'enemiesDisabled')(initialLives(1))).toBe(true)
  })

  it('option 0 is a REAL option (2 lives) — never a falsy fallback to another default (rule #4)', () => {
    // The `option || defaultIndex` trap: 0 is falsy but the FIRST, valid INITLF slot.
    const initialLives = need(m.initialLives, 'initialLives')
    const t = need(m.INITLF, 'INITLF')
    expect(initialLives(0).count).toBe(t[0])
    expect(initialLives(0).count).toBe(2)
  })

  it('a bad option is total — clamps to a valid INITLF entry, always one of 2..5, grace armed', () => {
    const initialLives = need(m.initialLives, 'initialLives')
    const t = need(m.INITLF, 'INITLF')
    const wo = need(m.WO_CNT, 'WO_CNT')
    for (const bad of [-1, -100, 4, 99, Number.NaN, 2.7]) {
      const l = initialLives(bad)
      expect(Array.from(t)).toContain(l.count) // no INITLF[undefined] leak
      expect(l.grace).toBe(wo)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-5 — loseLife (ENDLFE): DEC LIVES → respawn if any remain, else game over
// ───────────────────────────────────────────────────────────────────────────
describe('lives — loseLife decrements and respawns or ends the game (ENDLFE)', () => {
  it('a death with lives left decrements the count and is NOT game over', () => {
    const initialLives = need(m.initialLives, 'initialLives')
    const loseLife = need(m.loseLife, 'loseLife')
    const before = initialLives(0) // 2 planes
    expect(before.count).toBe(2)
    const r = loseLife(before)
    expect(r.gameOver).toBe(false)
    expect(r.lives.count).toBe(1) // DEC LIVES
  })

  it('the LAST life ends the game — game over exactly when the post-DEC count hits 0', () => {
    const initialLives = need(m.initialLives, 'initialLives')
    const loseLife = need(m.loseLife, 'loseLife')
    const r1 = loseLife(initialLives(0)) // 2 → 1
    const r2 = loseLife(r1.lives) // 1 → 0
    expect(r2.lives.count).toBe(0)
    expect(r2.gameOver).toBe(true) // none remain → high-score entry
  })

  it('a surviving death RESPAWNS: re-arms the WO.CNT grace so enemies are disabled again', () => {
    const initialLives = need(m.initialLives, 'initialLives')
    const loseLife = need(m.loseLife, 'loseLife')
    const tickGrace = need(m.tickGrace, 'tickGrace')
    const enemiesDisabled = need(m.enemiesDisabled, 'enemiesDisabled')
    const wo = need(m.WO_CNT, 'WO_CNT')

    // Burn off the initial grace so we can see the respawn RE-arm it.
    let l = initialLives(1) // 3 planes
    while (enemiesDisabled(l)) l = tickGrace(l)
    expect(l.grace).toBe(0)

    const r = loseLife(l)
    expect(r.gameOver).toBe(false)
    expect(r.lives.grace).toBe(wo) // respawn grace re-armed
    expect(enemiesDisabled(r.lives)).toBe(true)
  })

  it('deaths-to-game-over equals INITLF[option] for every option', () => {
    const initialLives = need(m.initialLives, 'initialLives')
    const loseLife = need(m.loseLife, 'loseLife')
    const t = need(m.INITLF, 'INITLF')
    t.forEach((planes, opt) => {
      let l = initialLives(opt)
      let deaths = 0
      let over = false
      while (!over && deaths <= 50) {
        const r = loseLife(l)
        l = r.lives
        over = r.gameOver
        deaths++
      }
      expect(deaths).toBe(planes) // N lives = N deaths, game over on the Nth
    })
  })

  it('is total past game over — count never goes negative and stays game over (rule #4: count 0 is real)', () => {
    const initialLives = need(m.initialLives, 'initialLives')
    const loseLife = need(m.loseLife, 'loseLife')
    let l = initialLives(0) // 2
    const over = loseLife(loseLife(l).lives) // 2 → 1 → 0 (game over)
    expect(over.gameOver).toBe(true)
    expect(over.lives.count).toBe(0)
    const again = loseLife(over.lives) // count 0 is a REAL terminal, not a falsy default
    expect(again.lives.count).toBe(0) // never negative
    expect(again.gameOver).toBe(true)
  })

  it('does NOT mutate its input (readonly state contract)', () => {
    const initialLives = need(m.initialLives, 'initialLives')
    const loseLife = need(m.loseLife, 'loseLife')
    const l = initialLives(2)
    const snapshot = JSON.stringify(l)
    loseLife(l)
    expect(JSON.stringify(l)).toBe(snapshot)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-6 — WO.CNT spawn grace: enemies disabled for EXACTLY 5 frames after (re)spawn
// ───────────────────────────────────────────────────────────────────────────
describe('lives — WO.CNT spawn grace disables enemies for 5 frames (findings §5)', () => {
  it('enemiesDisabled is TRUE while grace remains and FALSE once it runs out (rule #4: grace 0 is real)', () => {
    const initialLives = need(m.initialLives, 'initialLives')
    const tickGrace = need(m.tickGrace, 'tickGrace')
    const enemiesDisabled = need(m.enemiesDisabled, 'enemiesDisabled')
    const fresh = initialLives(0)
    expect(enemiesDisabled(fresh)).toBe(true) // grace > 0 → planes off
    let l = fresh
    while (l.grace > 0) l = tickGrace(l)
    expect(l.grace).toBe(0)
    expect(enemiesDisabled(l)).toBe(false) // grace 0 → planes on; NOT a falsy default
  })

  it('the grace window is EXACTLY WO_CNT (5) calc frames', () => {
    const initialLives = need(m.initialLives, 'initialLives')
    const tickGrace = need(m.tickGrace, 'tickGrace')
    const enemiesDisabled = need(m.enemiesDisabled, 'enemiesDisabled')
    const wo = need(m.WO_CNT, 'WO_CNT')
    let l = initialLives(0)
    let frames = 0
    while (enemiesDisabled(l)) {
      l = tickGrace(l)
      frames++
      if (frames > 50) break // guard against a non-decrementing tick
    }
    expect(frames).toBe(wo) // 5 frames of grace, then enemies re-enable
  })

  it('tickGrace floors at 0 and is total — ticking a spent grace stays 0, never negative', () => {
    const initialLives = need(m.initialLives, 'initialLives')
    const tickGrace = need(m.tickGrace, 'tickGrace')
    let l = initialLives(0)
    for (let i = 0; i < 20; i++) l = tickGrace(l) // over-tick well past WO_CNT
    expect(l.grace).toBe(0)
    expect(l.count).toBe(2) // ticking grace never touches the life count
  })

  it('tickGrace does NOT mutate its input (readonly state contract)', () => {
    const initialLives = need(m.initialLives, 'initialLives')
    const tickGrace = need(m.tickGrace, 'tickGrace')
    const l = initialLives(0)
    const snapshot = JSON.stringify(l)
    tickGrace(l)
    expect(JSON.stringify(l)).toBe(snapshot)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-7 — integration: the rb2-8 → rb2-9 seam + the ROM spawn altitude
// ───────────────────────────────────────────────────────────────────────────
describe('lives — integration with the REAL flight spawn altitude and rb2-8 evade verdict', () => {
  it('RESPAWN_ALTITUDE is the same altitude the flight model spawns at (I4YPOS 0x0210)', () => {
    // Respawn returns the pilot to the flight model's start altitude — one source of truth.
    expect(need(m.RESPAWN_ALTITUDE, 'RESPAWN_ALTITUDE')).toBe(INITIAL_FLIGHT.altitude)
  })

  it('a real returning-ace HIT feeds ENSIDE into the bullet-hole, then ENDLFE respawns you', () => {
    // returning-ace.ts (rb2-8) says its 'hit' damage channel IS rb2-9. Close that loop:
    // a veteran ace + no dodge + a losing roll is a guaranteed 'hit'; the shoulder he came
    // from (ENSIDE) is the bullet-hole side; ENDLFE then decrements and respawns.
    const beginDeath = need(m.beginDeath, 'beginDeath')
    const advanceDeath = need(m.advanceDeath, 'advanceDeath')
    const deathComplete = need(m.deathComplete, 'deathComplete')
    const initialLives = need(m.initialLives, 'initialLives')
    const loseLife = need(m.loseLife, 'loseLife')
    const enemiesDisabled = need(m.enemiesDisabled, 'enemiesDisabled')

    const side = 1 as const
    let ace = beginPass(side)
    ace = evadeCheck(ace, 0, 0.99).ace // spend the FIRST-TIME-FREE freebie → veteran
    expect(evadeCheck(ace, 0, 0.99).result).toBe('hit') // no dodge, losing roll → he got you

    // rb2-9 takes over the 'hit': bullet-hole on ENSIDE, run the sequence, then ENDLFE.
    let death = beginDeath(side)
    expect(death.side).toBe(side) // bullet-hole side = the shoulder he came from
    while (!deathComplete(death)) death = advanceDeath(death)

    const after = loseLife(initialLives(0)) // 2 planes → respawn with 1
    expect(after.gameOver).toBe(false)
    expect(after.lives.count).toBe(1)
    expect(enemiesDisabled(after.lives)).toBe(true) // WO.CNT grace on the respawn
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-8 — totality sweep: every helper stays defined/finite across degenerate inputs
// ───────────────────────────────────────────────────────────────────────────
describe('lives — totality across degenerate inputs', () => {
  it('initialLives, loseLife, tickGrace and the gates never produce NaN / undefined', () => {
    const initialLives = need(m.initialLives, 'initialLives')
    const loseLife = need(m.loseLife, 'loseLife')
    const tickGrace = need(m.tickGrace, 'tickGrace')
    const enemiesDisabled = need(m.enemiesDisabled, 'enemiesDisabled')
    for (const opt of [0, 1, 2, 3, -1, 99, Number.NaN]) {
      let l = initialLives(opt)
      for (let i = 0; i < 10; i++) {
        expect(Number.isInteger(l.count)).toBe(true)
        expect(l.count).toBeGreaterThanOrEqual(0)
        expect(Number.isInteger(l.grace)).toBe(true)
        expect(l.grace).toBeGreaterThanOrEqual(0)
        expect(typeof enemiesDisabled(l)).toBe('boolean')
        l = tickGrace(l)
      }
      const r = loseLife(l)
      expect(typeof r.gameOver).toBe('boolean')
      expect(r.lives.count).toBeGreaterThanOrEqual(0)
    }
  })
})

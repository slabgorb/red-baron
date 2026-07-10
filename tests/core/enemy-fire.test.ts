// tests/core/enemy-fire.test.ts
//
// Story rb2-7 — RED phase (O'Brien / TEA). The enemy's PLNLVL LEVEL-GATED FIRING
// decision: whether a plane is granted the "@ PLAYER" shoot bit by the difficulty
// level, and — when granted — the ÷2 FRAME cadence that lets it fire every other
// calc-frame. Grounded in findings §3 (PLNSHL / NWPLNE, R2BRON.MAC:4798-4807 &
// 2345-2355): "level < 4 never shoots (0B0); level 4 = 50 %; level 5 = always (0B8)",
// and "fires only if status D3 set; FRAME LSB gates ÷2".
//
// CONTRACT for the GREEN phase (Julia / DEV): extend `src/core/enemy.ts` with the
// pure firing-decision helpers:
//
//   // PLNLVL fire GRANT by GMLEVL — the fraction of planes allowed to shoot (§3):
//   //   level < 4 → 0 (never), level === 4 → 0.5 (half), level ≥ 5 → 1 (always).
//   export function planeFireChance(level: number): number
//
//   // Does a plane fire THIS calc-frame? Combines the level grant with the ÷2 FRAME
//   // cadence (a plane fires at most every OTHER calc-frame) and a supplied roll in
//   // [0,1) for the level-4 coin-flip. Pure — the caller draws `roll` (e.g. from the
//   // seeded Rng) so the decision is deterministic and testable.
//   export function planeFires(level: number, frame: number, roll: number): boolean
//
// WHY THIS SHAPE (cited — findings §3, R2BRON.MAC):
//   * THE D3 "@ PLAYER" GRANT IS LEVEL-GATED (NWPLNE:2345-2355): a plane can only
//     shoot once the kill-driven GMLEVL reaches 4, and only half the time at 4; at 5
//     it always may. Below 4 the sky never shoots back — the early game is a turkey
//     shoot, exactly as the ROM plays.
//   * THE ÷2 CADENCE (PLNSHL:4798-4807): even a shooting plane fires only every other
//     calc-frame (FRAME LSB), halving the shell rate. This is a PROPERTY (half the
//     frames, never two in a row), not a fixed phase — the exact parity is inferred.
//   * SCOPE: rb2-7 pins the FIRE DECISION (mechanism). The enemy SHELL / player-damage
//     channel is deferred — the returning-ace EVADE check is rb2-8 and lives/respawn
//     is rb2-9 (findings §5). See the session Design Deviations for the split.

import { describe, it, expect, beforeAll } from 'vitest'

interface EnemyFireModule {
  planeFireChance?: (level: number) => number
  planeFires?: (level: number, frame: number, roll: number) => boolean
}

let m: EnemyFireModule = {}

beforeAll(async () => {
  try {
    m = (await import('../../src/core/enemy')) as EnemyFireModule
  } catch {
    m = {}
  }
})

/** Fail loud-and-clear when a contract export is missing (RED-friendly). */
function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`src/core/enemy.ts must export ${name} (rb2-7 RED contract)`)
  }
  return value
}

// ───────────────────────────────────────────────────────────────────────────
// AC-7 — planeFireChance: the PLNLVL level gate (findings §3, NWPLNE:2345-2355)
// ───────────────────────────────────────────────────────────────────────────
describe('enemy fire — planeFireChance level gate (findings §3)', () => {
  it('level < 4 never shoots — chance is 0 at every rung below 4', () => {
    const chance = need(m.planeFireChance, 'planeFireChance')
    for (const lvl of [0, 1, 2, 3]) expect(chance(lvl)).toBe(0)
  })

  it('level 4 is a 50 % coin flip', () => {
    expect(need(m.planeFireChance, 'planeFireChance')(4)).toBe(0.5)
  })

  it('level 5 always shoots — chance is 1, and it saturates above 5', () => {
    const chance = need(m.planeFireChance, 'planeFireChance')
    expect(chance(5)).toBe(1)
    expect(chance(6)).toBe(1) // GMLEVL ceiling is 5; anything higher stays "always"
  })

  it('returns only the three ROM grants — 0, 0.5, or 1 — across the whole level range', () => {
    const chance = need(m.planeFireChance, 'planeFireChance')
    for (let lvl = -2; lvl <= 8; lvl++) {
      expect([0, 0.5, 1]).toContain(chance(lvl))
    }
  })

  it('is total on degenerate level — non-finite / negative never fires (fail safe)', () => {
    const chance = need(m.planeFireChance, 'planeFireChance')
    expect(chance(Number.NaN)).toBe(0)
    expect(chance(-3)).toBe(0)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-8 — planeFires: the ÷2 FRAME cadence over the level gate (findings §3, PLNSHL)
// ───────────────────────────────────────────────────────────────────────────
describe('enemy fire — planeFires ÷2 cadence + gate (findings §3, R2BRON.MAC:4798-4807)', () => {
  /** Which of frames 0..n-1 are fire-eligible at level 5 (roll irrelevant when always-fire). */
  const eligibleFrames = (n: number): number[] => {
    const fires = need(m.planeFires, 'planeFires')
    const out: number[] = []
    for (let f = 0; f < n; f++) if (fires(5, f, 0.99)) out.push(f)
    return out
  }

  it('a level < 4 plane NEVER fires — no frame, no roll lets it shoot', () => {
    const fires = need(m.planeFires, 'planeFires')
    for (let f = 0; f < 8; f++) {
      for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
        expect(fires(3, f, roll)).toBe(false)
      }
    }
  })

  it('the ÷2 cadence: exactly half of consecutive frames are fire-eligible, never two in a row', () => {
    const elig = eligibleFrames(10)
    expect(elig.length).toBe(5) // half of 10 frames
    // no two eligible frames are adjacent — that is what "÷2 / every other frame" means
    for (let i = 1; i < elig.length; i++) expect(elig[i] - elig[i - 1]).toBeGreaterThanOrEqual(2)
  })

  it('a level 5 plane fires on EVERY eligible frame regardless of roll, and never on a non-eligible one', () => {
    const fires = need(m.planeFires, 'planeFires')
    const elig = new Set(eligibleFrames(10))
    for (let f = 0; f < 10; f++) {
      for (const roll of [0, 0.5, 0.999]) {
        expect(fires(5, f, roll)).toBe(elig.has(f))
      }
    }
  })

  it('a level 4 plane fires on an eligible frame ONLY when the coin-flip roll < 0.5', () => {
    const fires = need(m.planeFires, 'planeFires')
    const fireFrame = eligibleFrames(10)[0] // a frame the cadence allows
    expect(fires(4, fireFrame, 0.0)).toBe(true) // heads → fire
    expect(fires(4, fireFrame, 0.49)).toBe(true)
    expect(fires(4, fireFrame, 0.5)).toBe(false) // the boundary is strict (roll < 0.5)
    expect(fires(4, fireFrame, 0.9)).toBe(false) // tails → hold fire
  })

  it('a level 4 plane never fires on a non-eligible frame even on a winning roll', () => {
    const fires = need(m.planeFires, 'planeFires')
    const eligible = new Set(eligibleFrames(10))
    const offFrame = [0, 1, 2, 3].find((f) => !eligible.has(f)) as number
    expect(fires(4, offFrame, 0.0)).toBe(false) // the ÷2 gate beats a winning coin flip
  })

  it('is deterministic — identical (level, frame, roll) yields an identical decision', () => {
    const fires = need(m.planeFires, 'planeFires')
    expect(fires(4, 2, 0.3)).toBe(fires(4, 2, 0.3))
    expect(fires(5, 7, 0.8)).toBe(fires(5, 7, 0.8))
  })
})

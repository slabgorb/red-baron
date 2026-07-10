// tests/core/explosion.test.ts
//
// Story rb2-6 — RED phase (O'Brien / TEA). The kill payoff: a downed enemy becomes
// a falling, spinning wreck (UPPLEX) that plummets under gravity, then bursts into
// the four ROM explosion-debris pieces, and finally goes quiet — the moment the ROM
// would promote a wingman to lead (PLNXCG, rb2-7). Grounded in findings §3
// ("Killed enemy = falling/spinning wreck", UPPLEX, R2BRON.MAC:2957-3030) and §1
// (the load-bearing calc-frame cadence: the wreck advances ONE step per calc-frame).
//
// CONTRACT for the GREEN phase (Julia / DEV): create `src/core/explosion.ts`, the
// pure wreck sim, exporting:
//
//   // --- ROM-exact data (findings §3, R2BRON.MAC:2957-3030) ---
//   export const EX_ACY: number         // gravity accel per calc-frame = -20 (downward)
//   export const EXPL1_FRAMES: number   // .EXPL1 = 6  — the falling phase length
//   export const EXPL2_FRAMES: number   // .EXPL2 = 12 — the exploding (debris) phase length
//   export const DEBRIS_COUNT: number   // 4 — the PIECE0-3 explosion-debris models (topology.ts)
//
//   export type WreckPhase = 'falling' | 'exploding' | 'done'  // the UPPLEX lifecycle
//
//   export interface Wreck {
//     readonly x: number       // screen-window X, inherited from the killed enemy
//     readonly y: number       // screen-window Y — DROPS under gravity as it falls
//     readonly depth: number   // depth at the kill (where the debris is drawn)
//     readonly vy: number      // vertical velocity; accumulates EX_ACY each frame (starts 0)
//     readonly spin: number    // Z rotation angle; ADVANCES each frame (the wreck spins)
//     readonly phase: WreckPhase
//     readonly timer: number   // calc-frames remaining in the current phase
//   }
//
//   // UPPLEX spawn — turn the killed enemy into a fresh falling wreck at its pose.
//   export function explode(enemy: Enemy): Wreck
//
//   // One calc-frame of the wreck: apply gravity (vy += EX_ACY, y += vy → an
//   // ACCELERATING fall), advance the Z spin, and count down the phase timer —
//   // falling(6) → exploding(12) → done. Idempotent once 'done'. Pure.
//   export function stepWreck(wreck: Wreck): Wreck
//
// WHY THIS SHAPE (cited — findings §3 "falling/spinning wreck", UPPLEX, §1 cadence):
//   * GRAVITY EX.ACY = -20 (accelerating fall). The wreck does not drop at a constant
//     rate — velocity accumulates, so each frame it falls FARTHER than the last. Pinned
//     BEHAVIOURALLY by a monotone-increasing drop, not a single golden y. A constant-
//     velocity fall (or no gravity) FAILS the acceleration test. [EX_ACY byte-pinned.]
//   * SPINS ABOUT Z. `spin` advances a fixed non-zero step every live frame, so the
//     total rotation grows without bound while it falls. A wreck that does not spin
//     FAILS the spin test — the rotation must be load-bearing, not decorative.
//   * .EXPL1=6 FALL → .EXPL2=12 EXPLODE → done. The lifecycle is exactly 18 calc-frames:
//     6 spent falling, then 12 exploding, then quiet (the PLNXCG hand-off point). Pinned
//     at the phase boundaries (5→falling, 6→exploding, 17→exploding, 18→done) so an
//     off-by-one or a collapsed phase is caught. [.EXPL1 / .EXPL2 byte-pinned.]
//   * DEBRIS via PIECE0-3. DEBRIS_COUNT is exactly the four ROM explosion pieces that
//     topology.ts (rb2-2) transcribed from 037007.XXX — tied to EXPLOSION_PIECES.length
//     so the count can never drift from the real debris data.
//
// The ROM DATA is byte-pinned (EX_ACY=-20, EXPL1=6, EXPL2=12, 4 pieces). The spin RATE
// and the fall's world units are Dev tuning (the findings pin the accel sign+magnitude
// and the frame counts, not the render scale) — those are pinned BEHAVIOURALLY
// (accelerating fall, monotone spin, exact phase boundaries), never as fabricated values.
//
// Loaded defensively (await import in beforeAll, the guns.test.ts house pattern): during
// RED `src/core/explosion.ts` does not exist, so each test reports a clean assertion
// failure instead of a suite-collection crash. enemy.ts and topology.ts DO exist (on
// develop) — imported statically so explode() runs on the REAL enemy + debris data.

import { describe, it, expect, beforeAll } from 'vitest'
import { createRng } from '@arcade/shared/rng'
import { spawn, type Enemy } from '../../src/core/enemy'
import { EXPLOSION_PIECES } from '../../src/core/topology'

// --- local mirror of the RED contract (kept out of the static import graph so the file
//     loads while src/core/explosion.ts does not yet exist) ---

type WreckPhase = 'falling' | 'exploding' | 'done'

interface Wreck {
  readonly x: number
  readonly y: number
  readonly depth: number
  readonly vy: number
  readonly spin: number
  readonly phase: WreckPhase
  readonly timer: number
}

interface ExplosionModule {
  EX_ACY?: number
  EXPL1_FRAMES?: number
  EXPL2_FRAMES?: number
  DEBRIS_COUNT?: number
  explode?: (enemy: Enemy) => Wreck
  stepWreck?: (wreck: Wreck) => Wreck
}

let m: ExplosionModule = {}

beforeAll(async () => {
  try {
    m = (await import('../../src/core/explosion')) as ExplosionModule
  } catch {
    m = {}
  }
})

/** Fail loud-and-clear when a contract export is missing (RED-friendly). */
function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`src/core/explosion.ts must export ${name} (rb2-6 RED contract)`)
  }
  return value
}

/** A real rb2-4 enemy pinned at a chosen pose — the thing that just got shot down. */
const enemyAt = (x: number, y: number, depth: number, bank = 0): Enemy => ({
  ...spawn(createRng(1), 0),
  x,
  y,
  depth,
  bank,
})

/** Step a wreck `n` calc-frames from a fresh explode(enemy). */
function stepN(enemy: Enemy, n: number): Wreck {
  const explode = need(m.explode, 'explode')
  const stepWreck = need(m.stepWreck, 'stepWreck')
  let w = explode(enemy)
  for (let i = 0; i < n; i++) w = stepWreck(w)
  return w
}

/** The full valid phase set — every live wreck.phase must be one of these (#3 union). */
const PHASES: readonly WreckPhase[] = ['falling', 'exploding', 'done']

// ───────────────────────────────────────────────────────────────────────────
// AC-1 — ROM-exact constants (EX_ACY=-20, EXPL1=6, EXPL2=12, 4 debris pieces)
// ───────────────────────────────────────────────────────────────────────────
describe('explosion — ROM constants (findings §3, UPPLEX R2BRON.MAC:2957-3030)', () => {
  it('EX_ACY is -20 — downward gravity accel per calc-frame (findings §3)', () => {
    const g = need(m.EX_ACY, 'EX_ACY')
    expect(g).toBe(-20)
    expect(g).toBeLessThan(0) // negative = the wreck accelerates DOWN, not up
  })

  it('EXPL1_FRAMES is 6 — the falling phase (.EXPL1, findings §3)', () => {
    expect(need(m.EXPL1_FRAMES, 'EXPL1_FRAMES')).toBe(6)
  })

  it('EXPL2_FRAMES is 12 — the exploding/debris phase (.EXPL2, findings §3)', () => {
    expect(need(m.EXPL2_FRAMES, 'EXPL2_FRAMES')).toBe(12)
  })

  it('DEBRIS_COUNT is 4 AND equals the ROM PIECE0-3 count in topology.ts (debris via PIECE0-3)', () => {
    const n = need(m.DEBRIS_COUNT, 'DEBRIS_COUNT')
    expect(n).toBe(4)
    expect(n).toBe(EXPLOSION_PIECES.length) // tied to the real transcribed debris — cannot drift
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-2 — explode(): a killed enemy becomes a fresh falling wreck at its pose
// ───────────────────────────────────────────────────────────────────────────
describe('explosion — explode() spawns the wreck (UPPLEX)', () => {
  it('inherits the killed enemy pose (x, y, depth) and starts falling, un-moved', () => {
    const explode = need(m.explode, 'explode')
    const e = enemyAt(120, -34, 500, Math.PI / 5)
    const w = explode(e)
    expect(w.x).toBe(e.x) // debris starts where the plane died
    expect(w.depth).toBe(e.depth)
    expect(w.y).toBe(e.y) // has not fallen yet — the first drop is on the first step
    expect(w.phase).toBe('falling')
    expect(PHASES).toContain(w.phase) // #3 exhaustive union — a real WreckPhase
  })

  it('starts at rest: vy is 0 (a REAL starting velocity, not a falsy "unset" — rule #4)', () => {
    const w = need(m.explode, 'explode')(enemyAt(0, 0, 400))
    expect(w.vy).toBe(0) // 0 m/frame is a genuine at-rest value; gravity acts from frame 1
    expect(w.timer).toBe(need(m.EXPL1_FRAMES, 'EXPL1_FRAMES')) // 6 falling frames ahead
  })

  it('the fresh wreck is NOT already done (timer/phase are live, not zero-defaulted)', () => {
    const w = need(m.explode, 'explode')(enemyAt(0, 0, 400))
    expect(w.phase).not.toBe('done')
    expect(w.timer).toBeGreaterThan(0)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-3 — gravity EX.ACY: an ACCELERATING fall (not constant velocity, not static)
// ───────────────────────────────────────────────────────────────────────────
describe('explosion — gravity is an accelerating fall (EX.ACY, findings §3)', () => {
  it('velocity accumulates EX_ACY every frame — vy after k steps is k·EX_ACY', () => {
    const stepWreck = need(m.stepWreck, 'stepWreck')
    const gAccel = need(m.EX_ACY, 'EX_ACY')
    let w = need(m.explode, 'explode')(enemyAt(0, 0, 400))
    for (let k = 1; k <= 4; k++) {
      w = stepWreck(w)
      expect(w.vy).toBe(k * gAccel) // -20, -40, -60, -80 — the ROM gravity integrator
    }
  })

  it('the wreck FALLS and the fall ACCELERATES — each frame drops farther than the last', () => {
    // This is the whole point of EX.ACY: not a parachute. A constant-velocity fall or a
    // static wreck FAILS here, so the test detects the gravity mechanism's absence.
    const stepWreck = need(m.stepWreck, 'stepWreck')
    let w = need(m.explode, 'explode')(enemyAt(0, 0, 400))
    const ys: number[] = [w.y]
    const drops: number[] = []
    for (let i = 0; i < 5; i++) {
      const prev = w.y
      w = stepWreck(w)
      ys.push(w.y)
      drops.push(prev - w.y) // positive = fell downward this frame
    }
    for (const d of drops) expect(d).toBeGreaterThan(0) // it always falls (y decreases)
    for (let i = 1; i < drops.length; i++) {
      expect(drops[i]).toBeGreaterThan(drops[i - 1]) // and falls FARTHER each frame — accelerating
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-4 — spins about Z (the rotation is load-bearing, not decorative)
// ───────────────────────────────────────────────────────────────────────────
describe('explosion — spins about Z (findings §3)', () => {
  it('spin advances a fixed non-zero step every live frame — total rotation grows', () => {
    const stepWreck = need(m.stepWreck, 'stepWreck')
    let w = need(m.explode, 'explode')(enemyAt(0, 0, 400, 0))
    const spins: number[] = [w.spin]
    for (let i = 0; i < 6; i++) {
      w = stepWreck(w)
      spins.push(w.spin)
    }
    // strictly monotone: the wreck keeps spinning one way, it never sits still.
    for (let i = 1; i < spins.length; i++) expect(spins[i]).not.toBe(spins[i - 1])
    // a CONSTANT angular velocity — successive deltas are equal (linear spin), and non-zero.
    const d0 = spins[1] - spins[0]
    expect(d0).not.toBe(0) // a wreck that does not spin FAILS here
    for (let i = 1; i < spins.length - 1; i++) {
      expect(spins[i + 1] - spins[i]).toBeCloseTo(d0, 10) // same step each frame
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-5 — the UPPLEX lifecycle: falling(6) → exploding(12) → done (18 frames)
// ───────────────────────────────────────────────────────────────────────────
describe('explosion — falling → exploding → done lifecycle (.EXPL1/.EXPL2, findings §3)', () => {
  it('spends exactly EXPL1_FRAMES falling, then flips to exploding', () => {
    const e = enemyAt(0, 0, 400)
    const expl1 = need(m.EXPL1_FRAMES, 'EXPL1_FRAMES')
    expect(stepN(e, expl1 - 1).phase).toBe('falling') // still falling one frame before
    expect(stepN(e, expl1).phase).toBe('exploding') // the EXPL1-th step bursts it
  })

  it('spends exactly EXPL2_FRAMES exploding, then goes done at EXPL1+EXPL2 = 18', () => {
    const e = enemyAt(0, 0, 400)
    const expl1 = need(m.EXPL1_FRAMES, 'EXPL1_FRAMES')
    const expl2 = need(m.EXPL2_FRAMES, 'EXPL2_FRAMES')
    expect(stepN(e, expl1 + expl2 - 1).phase).toBe('exploding') // still bursting one frame before
    expect(stepN(e, expl1 + expl2).phase).toBe('done') // quiet at frame 18 (the PLNXCG hand-off)
  })

  it('every phase in the lifecycle is a valid WreckPhase — no stray state (#3 union)', () => {
    const explode = need(m.explode, 'explode')
    const stepWreck = need(m.stepWreck, 'stepWreck')
    let w = explode(enemyAt(0, 0, 400))
    for (let i = 0; i < 25; i++) {
      expect(PHASES).toContain(w.phase)
      w = stepWreck(w)
    }
  })

  it("the exploding phase is when the PIECE0-3 debris shows — it lasts the full .EXPL2 window", () => {
    // Count the frames the wreck reports 'exploding'; it must be exactly EXPL2_FRAMES,
    // the window the 4 debris pieces are drawn. A collapsed/instant explosion fails.
    const explode = need(m.explode, 'explode')
    const stepWreck = need(m.stepWreck, 'stepWreck')
    let w = explode(enemyAt(0, 0, 400))
    let exploding = 0
    for (let i = 0; i < 30; i++) {
      if (w.phase === 'exploding') exploding++
      w = stepWreck(w)
    }
    expect(exploding).toBe(need(m.EXPL2_FRAMES, 'EXPL2_FRAMES'))
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-6 — purity, determinism, totality (module contract; rb2-5 review lesson)
// ───────────────────────────────────────────────────────────────────────────
describe('explosion — pure, deterministic & total', () => {
  it('explode and stepWreck are pure — same inputs give the same outputs', () => {
    const explode = need(m.explode, 'explode')
    const e = enemyAt(50, 10, 600, 0.3)
    expect(explode(e)).toEqual(explode(e))
    expect(stepN(e, 9)).toEqual(stepN(e, 9)) // a whole 9-frame run reproduces exactly
  })

  it('never mutates its input wreck — a stepped wreck leaves the prior one byte-for-byte', () => {
    const explode = need(m.explode, 'explode')
    const stepWreck = need(m.stepWreck, 'stepWreck')
    const w0 = explode(enemyAt(0, 0, 400))
    const snapshot = JSON.stringify(w0)
    stepWreck(w0)
    expect(JSON.stringify(w0)).toBe(snapshot) // readonly contract honoured
  })

  it("is TOTAL past 'done' — over-stepping is idempotent (no runaway timer/motion)", () => {
    // Once the wreck is done, further steps must NOT drive timer negative, keep falling
    // forever, or flip the phase back. Pin the VALUE (a stable done wreck), not a type.
    const stepWreck = need(m.stepWreck, 'stepWreck')
    const done = stepN(enemyAt(0, 0, 400), 18)
    expect(done.phase).toBe('done')
    const past = stepWreck(stepWreck(stepWreck(done)))
    expect(past.phase).toBe('done') // stays done
    expect(past.timer).toBe(done.timer) // timer does not run negative
    expect(past.y).toBe(done.y) // motion has stopped — no eternal fall
    expect(past.spin).toBe(done.spin) // and it stops spinning once quiet
  })

  it('timer is a REAL count, hitting exactly 0 when done (0 is genuine, not falsy-unset — rule #4)', () => {
    const done = stepN(enemyAt(0, 0, 400), 18)
    expect(done.timer).toBe(0)
    expect(done.phase).toBe('done') // 0 timer + done phase is the terminal state, deliberately
  })
})

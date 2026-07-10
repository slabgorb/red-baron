// tests/core/waves.test.ts
//
// Story rb2-7 — RED phase (O'Brien / TEA). The squadron layer that turns rb2-4's
// lone weaving plane into MULTI-PLANE WAVES: score-scaled spawn counts, drone
// formation offsets, the MODECT plane-wave alternation + MCOUNT inter-wave counts,
// and the PLNXCG "shoot the lead, a wingman takes over" promotion. Grounded in
// findings §3 (enemy behavior, NWPLNE/STPLNE, R2BRON.MAC:2237-2386) and §4 (wave
// sequence, MODECT/MCOUNT, R2BRON.MAC:2254-2269, 1296-1297).
//
// CONTRACT for the GREEN phase (Julia / DEV): create `src/core/waves.ts`, the pure
// wave/formation/schedule module, exporting:
//
//   // --- ROM-exact data (findings §3, §4) ---
//   export const SCORE_2_PLANES: number   // 300  — score ≥ this → ≥ 2 planes (§3)
//   export const SCORE_3_PLANES: number   // 1000 — score ≥ this → up to 3 planes (§3)
//   export const DRONE_OFFSETS: readonly (readonly [number, number])[]
//                                          // PLANE1 -100,+100 / PLANE2 -100,-100 (§3)
//   export const MCOUNT: readonly number[] // [4,2,3,2,1,3,4,2] inter-wave counts
//                                          //   (§4, R2BRON.MAC:1296-1297)
//
//   // score-scaled wave size: <300 → 1, [300,1000) → 2, ≥1000 → 3 (§3)
//   export function planeCountForScore(score: number): number
//
//   // one wave: the 25 % RANDOM lone-plane roll (LONE_PLANE_CHANCE), else a
//   // score-scaled count — a 'lead' plane + drones at DRONE_OFFSETS. Consumes the
//   // seeded Rng (lone roll first, then delegates to enemy.spawn for the lead;
//   // drones are deterministic offsets of the lead). Pure per seed.
//   export function spawnWave(rng: Rng, score: number, level?: number): readonly Enemy[]
//
//   // PLNXCG — kill the lead and a surviving drone is promoted to the new lead
//   // (§3, UPPLEX/PLNXCG, R2BRON.MAC:2957-3030). Idempotent when a lead is present.
//   export function promoteLead(survivors: readonly Enemy[]): readonly Enemy[]
//
//   // MODECT plane-wave alternation: LSB selects plane wave vs (deferred) ground
//   // wave (§4). isPlaneWave(0) = true — the game opens with planes.
//   export function isPlaneWave(modect: number): boolean
//
//   // MCOUNT inter-wave frame count, cycling the table by wave index (§4).
//   export function interWaveDelay(modect: number): number
//
//   // the calc-frame wave clock: counts a wave's MCOUNT gap down one calc-frame at
//   // a time, then advances MODECT and signals whether the next wave is a plane wave.
//   export interface WaveClock { readonly modect: number; readonly countdown: number }
//   export const INITIAL_WAVE_CLOCK: WaveClock            // { modect: 0, countdown: 0 }
//   export function stepWaveClock(clock: WaveClock): { clock: WaveClock; spawnPlaneWave: boolean }
//
// AND (the BLOCKING seam gap from rb2-6) extend `src/core/enemy.ts`:
//   export type EnemyKind = 'lead' | 'drone'   // what kind of plane this is
//   // Enemy gains: readonly kind: EnemyKind
//   // spawn() sets kind: 'lead' (the lone plane is a lead). NOTE: every existing
//   // Enemy builder SPREADS spawn(), so adding a required `kind` is migration-free.
//
// WHY THIS SHAPE (cited — findings §3/§4, R2BRON.MAC):
//   * SCORE-SCALED COUNT + 25 % LONE ROLL (NWPLNE/STPLNE, R2BRON.MAC:2237-2386):
//     "Score ≥ 1000 → up to 3 planes (2 drones); ≥ 300 → ≥ 2 planes (1 drone)"; a
//     RANDOM roll gives a 25 % lone plane. rb2-4 shipped the lone case; THIS story
//     ships the formation counts. The count is a step function of score, and the
//     lone roll can override any high score down to a single plane.
//   * DRONE FORMATION OFFSETS are BYTE-PINNED: PLANE1 -100,+100 / PLANE2 -100,-100
//     (§3) — drones spawn at fixed (x,y) offsets from the lead and share its depth.
//   * PLNXCG (UPPLEX, R2BRON.MAC:2957-3030): killing the lead HANDS THE FIGHT to a
//     wingman — a surviving drone is promoted to lead. This is why rb2-6 flagged the
//     kind discriminant as blocking: scoring + promotion must know which plane died.
//   * MODECT / MCOUNT (§4, R2BRON.MAC:2254-2269, 1296-1297): a NEWCT countdown steps
//     MODECT, whose LSB alternates plane vs ground waves, spaced by MCOUNT frames.
//     GROUND waves are rb3 — the alternation MECHANISM is pinned here (ground slots
//     are no-op waits); only plane waves spawn planes in rb2. Pinned at calc-frame
//     cadence (findings §1) — the countdown ticks per 96 ms calc frame, not display.
//   * THE KIND SEAM: rb2-6's main.ts hardcoded scoreKill('lead', …) because Enemy
//     carried no discriminant. A drone must score the flat DRONE_SCORE and a close
//     lead its depth bonus — so the kind must ride on the Enemy and reach scoreKill.

import { describe, it, expect, beforeAll } from 'vitest'
import { createRng, type Rng } from '@arcade/shared/rng'
import { spawn, type Enemy } from '../../src/core/enemy'
import { scoreKill, DRONE_SCORE } from '../../src/core/scoring'

// ─── the GREEN contract surface (all optional so RED fails loud, not undefined-explodes) ──

interface WaveClock {
  readonly modect: number
  readonly countdown: number
}

interface WavesModule {
  SCORE_2_PLANES?: number
  SCORE_3_PLANES?: number
  DRONE_OFFSETS?: readonly (readonly [number, number])[]
  MCOUNT?: readonly number[]
  planeCountForScore?: (score: number) => number
  spawnWave?: (rng: Rng, score: number, level?: number) => readonly Enemy[]
  promoteLead?: (survivors: readonly Enemy[]) => readonly Enemy[]
  isPlaneWave?: (modect: number) => boolean
  interWaveDelay?: (modect: number) => number
  INITIAL_WAVE_CLOCK?: WaveClock
  stepWaveClock?: (clock: WaveClock) => { clock: WaveClock; spawnPlaneWave: boolean }
}

let m: WavesModule = {}

beforeAll(async () => {
  try {
    m = (await import('../../src/core/waves')) as WavesModule
  } catch {
    m = {}
  }
})

/** Fail loud-and-clear when a contract export is missing (RED-friendly). */
function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`src/core/waves.ts must export ${name} (rb2-7 RED contract)`)
  }
  return value
}

/** The kind of a plane — reads the rb2-7 discriminant the wave layer relies on. */
const kindOf = (e: Enemy): string => (e as { kind?: string }).kind ?? '(missing kind)'

// ───────────────────────────────────────────────────────────────────────────
// AC-0 — the BLOCKING seam: Enemy carries a lead/drone `kind` that reaches scoreKill
// ───────────────────────────────────────────────────────────────────────────
describe('rb2-7 seam — Enemy.kind discriminant (findings §3; rb2-6 blocking finding)', () => {
  it('the lone spawn is a LEAD — spawn() sets kind = "lead"', () => {
    // rb2-6's main.ts hardcoded 'lead' because Enemy had no kind; the lone plane IS a lead.
    expect(kindOf(spawn(createRng(1), 0))).toBe('lead')
  })

  it('a wave lead scores as a lead and a wave drone scores the flat DRONE_SCORE — the kind ROUTES scoreKill', () => {
    const spawnWave = need(m.spawnWave, 'spawnWave')
    // A close depth where a lead is worth MORE than the flat 300 — so lead ≠ drone proves routing.
    const CLOSE = 200
    // Find a non-lone wave (≥ 2 planes) so we have both a lead and a drone.
    let wave: readonly Enemy[] = []
    for (let seed = 1; seed <= 400 && wave.length < 2; seed++) wave = spawnWave(createRng(seed), 5000, 0)
    expect(wave.length).toBeGreaterThanOrEqual(2)
    const lead = wave.find((e) => kindOf(e) === 'lead') as Enemy
    const drone = wave.find((e) => kindOf(e) === 'drone') as Enemy
    expect(lead).toBeDefined()
    expect(drone).toBeDefined()
    // The kind on the Enemy, fed to scoreKill, must pick the right branch.
    expect(scoreKill(kindOf(drone) as 'drone', CLOSE)).toBe(DRONE_SCORE)
    expect(scoreKill(kindOf(lead) as 'lead', CLOSE)).toBeGreaterThan(DRONE_SCORE)
    // …and the two kinds route to DIFFERENT scores — the discriminant is load-bearing.
    expect(scoreKill(kindOf(lead) as 'lead', CLOSE)).not.toBe(scoreKill(kindOf(drone) as 'drone', CLOSE))
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-1 — score-scaled plane count (findings §3: ≥300 → 2, ≥1000 → 3)
// ───────────────────────────────────────────────────────────────────────────
describe('waves — planeCountForScore (findings §3, NWPLNE/STPLNE)', () => {
  it('the score thresholds are byte-pinned: 300 → 2 planes, 1000 → 3 planes', () => {
    expect(need(m.SCORE_2_PLANES, 'SCORE_2_PLANES')).toBe(300)
    expect(need(m.SCORE_3_PLANES, 'SCORE_3_PLANES')).toBe(1000)
  })

  it('is a step function of score with exact boundaries (299→1, 300→2, 999→2, 1000→3)', () => {
    const n = need(m.planeCountForScore, 'planeCountForScore')
    expect(n(0)).toBe(1)
    expect(n(299)).toBe(1)
    expect(n(300)).toBe(2) // the ≥300 boundary is inclusive
    expect(n(999)).toBe(2)
    expect(n(1000)).toBe(3) // the ≥1000 boundary is inclusive
    expect(n(50_000)).toBe(3) // saturates at 3 — the object budget is 3 (1 lead + 2 drones)
  })

  it('never exceeds the 3-object budget and never returns fewer than 1', () => {
    const n = need(m.planeCountForScore, 'planeCountForScore')
    for (const s of [0, 1, 299, 300, 700, 1000, 9999]) {
      expect(n(s)).toBeGreaterThanOrEqual(1)
      expect(n(s)).toBeLessThanOrEqual(3)
    }
  })

  it('is monotone non-decreasing in score (more score never fields fewer planes)', () => {
    const n = need(m.planeCountForScore, 'planeCountForScore')
    let prev = 0
    for (let s = 0; s <= 2000; s += 50) {
      const c = n(s)
      expect(c).toBeGreaterThanOrEqual(prev)
      prev = c
    }
  })

  it('is total on degenerate score — negative / non-finite falls back to a single plane', () => {
    const n = need(m.planeCountForScore, 'planeCountForScore')
    expect(n(-500)).toBe(1)
    expect(n(Number.NaN)).toBe(1)
    expect(n(Number.POSITIVE_INFINITY)).toBe(3) // an "infinite" score still caps at the budget
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-2 — spawnWave: formation offsets, kinds, and the 25 % lone-plane roll
// ───────────────────────────────────────────────────────────────────────────
describe('waves — spawnWave formation + lone roll (findings §3, PLANE1/PLANE2 offsets)', () => {
  it('DRONE_OFFSETS is the byte-exact PLANE1 -100,+100 / PLANE2 -100,-100 table', () => {
    const off = need(m.DRONE_OFFSETS, 'DRONE_OFFSETS')
    expect(off.map((o) => [...o])).toEqual([
      [-100, 100],
      [-100, -100],
    ])
    expect(off.length).toBe(2) // exactly two drones — the object budget is 1 lead + 2 drones
  })

  it('a full (non-lone) wave at score ≥ 1000 is 1 lead + 2 drones at the exact offsets, sharing the lead depth', () => {
    const spawnWave = need(m.spawnWave, 'spawnWave')
    const off = need(m.DRONE_OFFSETS, 'DRONE_OFFSETS')
    // Take the first seed that yields the full 3-plane formation (i.e. not the lone roll).
    let wave: readonly Enemy[] = []
    for (let seed = 1; seed <= 400 && wave.length !== 3; seed++) wave = spawnWave(createRng(seed), 1500, 0)
    expect(wave.length).toBe(3)

    const [lead, d1, d2] = wave
    expect(kindOf(lead)).toBe('lead')
    expect(kindOf(d1)).toBe('drone')
    expect(kindOf(d2)).toBe('drone')

    // drones are the lead's position + the fixed formation offsets (x, y); depth is shared.
    expect(d1.x).toBe(lead.x + off[0][0])
    expect(d1.y).toBe(lead.y + off[0][1])
    expect(d2.x).toBe(lead.x + off[1][0])
    expect(d2.y).toBe(lead.y + off[1][1])
    expect(d1.depth).toBe(lead.depth)
    expect(d2.depth).toBe(lead.depth)
  })

  it('a two-plane wave at score in [300,1000) is 1 lead + 1 drone at PLANE1', () => {
    const spawnWave = need(m.spawnWave, 'spawnWave')
    const off = need(m.DRONE_OFFSETS, 'DRONE_OFFSETS')
    let wave: readonly Enemy[] = []
    for (let seed = 1; seed <= 400 && wave.length !== 2; seed++) wave = spawnWave(createRng(seed), 500, 0)
    expect(wave.length).toBe(2)
    expect(kindOf(wave[0])).toBe('lead')
    expect(kindOf(wave[1])).toBe('drone')
    expect(wave[1].x).toBe(wave[0].x + off[0][0])
    expect(wave[1].y).toBe(wave[0].y + off[0][1])
  })

  it('the 25 % RANDOM roll fires roughly a quarter of the time and forces a LONE lead, overriding a high score', () => {
    const spawnWave = need(m.spawnWave, 'spawnWave')
    // At score 5000 the count would be 3; the lone roll must still knock some waves down to 1.
    const N = 600
    let lone = 0
    for (let seed = 1; seed <= N; seed++) {
      const wave = spawnWave(createRng(seed), 5000, 0)
      expect(wave.length === 1 || wave.length === 3).toBe(true) // only lone (1) or full (3) at this score
      if (wave.length === 1) {
        expect(kindOf(wave[0])).toBe('lead') // a lone plane is a lead, never a stray drone
        lone++
      }
    }
    // LONE_PLANE_CHANCE = 0.25 — expect ~25 % lone over the seed sweep (generous band for RNG spread).
    const frac = lone / N
    expect(frac).toBeGreaterThan(0.15)
    expect(frac).toBeLessThan(0.35)
  })

  it('score < 300 is always a single lead — no drones regardless of the lone roll', () => {
    const spawnWave = need(m.spawnWave, 'spawnWave')
    for (let seed = 1; seed <= 200; seed++) {
      const wave = spawnWave(createRng(seed), 100, 0)
      expect(wave.length).toBe(1)
      expect(kindOf(wave[0])).toBe('lead')
    }
  })

  it('is deterministic per seed — the same seed yields an identical wave', () => {
    const spawnWave = need(m.spawnWave, 'spawnWave')
    expect(spawnWave(createRng(7), 1500, 0)).toEqual(spawnWave(createRng(7), 1500, 0))
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-3 — PLNXCG lead promotion (findings §3, UPPLEX/PLNXCG)
// ───────────────────────────────────────────────────────────────────────────
describe('waves — promoteLead / PLNXCG (findings §3, R2BRON.MAC:2957-3030)', () => {
  const drone = (x: number): Enemy => ({ ...spawn(createRng(x), 0), kind: 'drone' } as Enemy)

  it('promotes the FIRST surviving drone to lead when the lead is gone', () => {
    const promote = need(m.promoteLead, 'promoteLead')
    const out = promote([drone(1), drone(2)])
    expect(out.length).toBe(2) // count preserved — a promotion, not a spawn
    expect(kindOf(out[0])).toBe('lead') // the first wingman takes over the fight
    expect(kindOf(out[1])).toBe('drone') // the other stays a wingman
  })

  it('is idempotent when a lead is already present — the sky already has its leader', () => {
    const promote = need(m.promoteLead, 'promoteLead')
    const lead = spawn(createRng(9), 0) // kind 'lead'
    const out = promote([lead, drone(2)])
    expect(out.map(kindOf)).toEqual(['lead', 'drone'])
  })

  it('is a no-op on an empty sky and total on a single drone', () => {
    const promote = need(m.promoteLead, 'promoteLead')
    expect(promote([]).length).toBe(0)
    expect(kindOf(promote([drone(3)])[0])).toBe('lead')
  })

  it('does not mutate its input (pure — returns fresh planes)', () => {
    const promote = need(m.promoteLead, 'promoteLead')
    const input = [drone(1), drone(2)]
    promote(input)
    expect(input.map(kindOf)).toEqual(['drone', 'drone']) // the caller's array is untouched
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-4 — MODECT plane-wave alternation (findings §4)
// ───────────────────────────────────────────────────────────────────────────
describe('waves — isPlaneWave / MODECT alternation (findings §4, R2BRON.MAC:2254-2269)', () => {
  it('the game opens on a plane wave — isPlaneWave(0) is true', () => {
    expect(need(m.isPlaneWave, 'isPlaneWave')(0)).toBe(true)
  })

  it('strictly alternates plane ↔ ground on every MODECT step (LSB select)', () => {
    const isPlane = need(m.isPlaneWave, 'isPlaneWave')
    for (let n = 0; n < 16; n++) {
      // adjacent MODECT values must differ — the whole point of "alternation"
      expect(isPlane(n)).not.toBe(isPlane(n + 1))
    }
  })

  it('plane waves land on even MODECT, ground slots on odd (parity is the LSB gate)', () => {
    const isPlane = need(m.isPlaneWave, 'isPlaneWave')
    for (let n = 0; n < 16; n++) {
      expect(isPlane(n)).toBe(n % 2 === 0)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-5 — MCOUNT inter-wave counts (findings §4, R2BRON.MAC:1296-1297)
// ───────────────────────────────────────────────────────────────────────────
describe('waves — MCOUNT / interWaveDelay (findings §4)', () => {
  const TABLE = [4, 2, 3, 2, 1, 3, 4, 2]

  it('MCOUNT is the byte-exact 8-entry inter-wave table', () => {
    const t = need(m.MCOUNT, 'MCOUNT')
    expect([...t]).toEqual(TABLE)
    expect(t.length).toBe(8)
  })

  it('every inter-wave count is a positive integer — a wave always has a real gap', () => {
    for (const v of need(m.MCOUNT, 'MCOUNT')) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThan(0)
    }
  })

  it('interWaveDelay cycles the table by wave index', () => {
    const delay = need(m.interWaveDelay, 'interWaveDelay')
    for (let i = 0; i < 18; i++) {
      expect(delay(i)).toBe(TABLE[i % TABLE.length])
    }
  })

  it('is total on a negative wave index — still a positive count from the table (never NaN)', () => {
    const delay = need(m.interWaveDelay, 'interWaveDelay')
    const v = delay(-1)
    expect(Number.isInteger(v)).toBe(true)
    expect(v).toBeGreaterThan(0)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-6 — the calc-frame wave clock (findings §1 cadence + §4 MODECT/MCOUNT)
// ───────────────────────────────────────────────────────────────────────────
describe('waves — stepWaveClock scheduler (findings §1 calc-frame + §4)', () => {
  interface Frame {
    step: number
    modectBefore: number
    countdownBefore: number
    spawn: boolean
    countdownAfter: number
  }
  /**
   * Step the clock `n` calc-frames from the initial clock, recording the PRE-step
   * state each frame. A wave DECISION is exactly a frame whose pre-step countdown was
   * 0 (the gap has elapsed) — the reliable signal, since the decision itself advances
   * MODECT (so a MODECT-change is visible only on the FOLLOWING frame).
   */
  function run(n: number): Frame[] {
    const step = need(m.stepWaveClock, 'stepWaveClock')
    let clock = need(m.INITIAL_WAVE_CLOCK, 'INITIAL_WAVE_CLOCK')
    const trace: Frame[] = []
    for (let i = 0; i < n; i++) {
      const r = step(clock)
      trace.push({
        step: i,
        modectBefore: clock.modect,
        countdownBefore: clock.countdown,
        spawn: r.spawnPlaneWave,
        countdownAfter: r.clock.countdown,
      })
      clock = r.clock
    }
    return trace
  }
  /** The frames on which a wave decision fires — the gap has elapsed (pre-step countdown 0). */
  const decisionsOf = (trace: Frame[]): Frame[] => trace.filter((t) => t.countdownBefore === 0)

  it('INITIAL_WAVE_CLOCK is { modect: 0, countdown: 0 } — the opening wave is due immediately', () => {
    const init = need(m.INITIAL_WAVE_CLOCK, 'INITIAL_WAVE_CLOCK')
    expect(init.modect).toBe(0)
    expect(init.countdown).toBe(0)
  })

  it('the very first calc-frame spawns the opening plane wave', () => {
    const first = run(1)[0]
    expect(first.spawn).toBe(true) // isPlaneWave(0) === true
  })

  it('spawns ONLY when the countdown has elapsed — no wave fires mid-gap', () => {
    const delay = need(m.interWaveDelay, 'interWaveDelay')
    const decisions = decisionsOf(run(40))
    // MODECT advances by exactly 1 at each decision — one wave slot per decision.
    for (let k = 1; k < decisions.length; k++) {
      expect(decisions[k].modectBefore).toBe(decisions[k - 1].modectBefore + 1)
    }
    // between two decisions there are exactly `interWaveDelay(nextModect)` non-decision frames.
    for (let k = 0; k < decisions.length - 1; k++) {
      const gapFrames = decisions[k + 1].step - decisions[k].step - 1
      expect(gapFrames).toBe(delay(decisions[k].modectBefore + 1))
    }
  })

  it('each decision spawns iff its MODECT is a plane wave — ground slots are silent no-op waits', () => {
    const isPlane = need(m.isPlaneWave, 'isPlaneWave')
    const decisions = decisionsOf(run(40))
    for (const d of decisions) {
      expect(d.spawn).toBe(isPlane(d.modectBefore))
    }
    // and over 40 frames we saw BOTH a plane spawn and a silent ground slot (real alternation).
    expect(decisions.some((d) => d.spawn)).toBe(true)
    expect(decisions.some((d) => !d.spawn)).toBe(true)
  })

  it('non-decision frames just tick the countdown down by exactly one, spawning nothing', () => {
    const trace = run(12)
    for (let i = 1; i < trace.length; i++) {
      if (trace[i].countdownBefore !== 0) {
        // a mid-gap tick — never spawns, and the countdown drops by exactly one.
        expect(trace[i].spawn).toBe(false)
        expect(trace[i].countdownAfter).toBe(trace[i - 1].countdownAfter - 1)
      }
    }
  })
})

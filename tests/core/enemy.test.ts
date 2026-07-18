// tests/core/enemy.test.ts
//
// Story rb2-4 — RED phase (Furiosa / TEA). The single-enemy dogfight AI + spawn:
// the weaving window-follower steering, the side-entry spawn, and the DISCHK
// proximity wiring that sharpens the player's control feel as the enemy closes.
//
// CONTRACT for the GREEN phase (The Word Burgers / DEV): create
// `src/core/enemy.ts`, the pure enemy-plane sim, exporting:
//
//   // --- ROM-exact data (findings §3, R2BRON.MAC) ---
//   export const P_OLIM: readonly number[]  // outer window limit, GMLEVL-indexed:
//                                            //   [0x40,0x80,0x120,0x1A0,0x200] (R2BRON.MAC:2935)
//   export const P_ILIM: readonly number[]  // inner window limit, GMLEVL-indexed:
//                                            //   [0x20,0x30,0x80,0x120,0x160] (R2BRON.MAC:2952)
//   export const P_INDP: number             // spawn depth = 1080 (NWPLNE, R2BRON.MAC:2237)
//   export const ACCEL: number              // ΔX acceleration per calc frame = 30 (findings §3)
//   export const LONE_PLANE_CHANCE: number  // RANDOM roll → 25 % lone plane = 0.25 (findings §3)
//
//   export interface Enemy {
//     readonly x: number        // screen-window X — weaves across centre (0), bounded ±P_OLIM
//     readonly y: number        // vertical — random at spawn
//     readonly depth: number    // Z distance in front of the eye; P_INDP at spawn, closes in
//     readonly deltaX: number   // ΔX weave velocity/turn-rate (accelerates by ACCEL, reverses)
//     readonly bank: number     // roll (radians): ±90° entry flourish, then ∝ deltaX via biplaneBank
//     readonly side: -1 | 1     // which screen side it entered from
//     readonly active: boolean  // D7 "active" status bit
//     readonly facingAway: boolean // rb4-13: PLSTAT+6 D4 mirror — true ⇔ D4=0 "PLANE FACING
//                               // AWAY" (:2652); false ⇔ D4=1 rotated toward the viewer.
//                               // Picks the biplane model (DRNPIC :4961) — depth NEVER does.
//   }
//
//   export function spawn(rng: Rng, level?: number): Enemy   // one lone plane (25 % case)
//   export function step(enemy: Enemy, level?: number): Enemy // one calc-frame of weaving AI
//   export function proximityBand(depth: number): ProximityBand // DISCHK depth → near/mid/far
//
// WHY THIS SHAPE (cited — findings §3 "Enemy behavior", R2BRON.MAC):
//   * SPAWN (NWPLNE/STPLNE, R2BRON.MAC:2237-2386): the enemy enters from a screen
//     SIDE banked 90°, random X/Y, at depth P.INDP=1080. Score gates the count
//     (≥1000 → 3 planes, ≥300 → 2), and a RANDOM roll gives a 25 % lone plane — this
//     story builds THE LONE-PLANE CASE FIRST. The drone-formation branches (PLANE1
//     -100,+100 / PLANE2 -100,-100) are rb2-7; `spawn` returns ONE plane here.
//   * STEERING is a WEAVING WINDOW-FOLLOWER, NOT a beeline seeker (UPDPLN/PLNDEL/
//     P.WINDW, R2BRON.MAC:2566-2870): the plane accelerates ΔX (ACCEL=30) toward the
//     window limits and REVERSES at the inner/outer boundaries, weaving across screen
//     centre; the limit tables are GMLEVL-indexed (higher level = wider, more
//     aggressive weave). It follows the WINDOW, not the player — a player sitting at
//     centre is NOT chased to a standstill.
//   * BANK ∝ turn-rate. The story context (rb2-3 carryforward) rules that the enemy
//     reuses flight.ts's `biplaneBank` (PFROTN = ΔX×8, clamped ±0x100 → ±45°) so
//     enemy and horizon share ONE coupling with no duplicated ROLL_SCALE. NOTE: the
//     raw ROM (findings §3) banks via `X/Y rotation = −4·ΔX` clamped `P.MAXR=0x1FF`
//     (±90°) — a different factor, sign, and clamp. This suite pins the CONTEXT's
//     biplaneBank decision (higher spec authority) for the settled weave; the ROM
//     discrepancy is logged as a Delivery Finding + design deviation for the Reviewer
//     / playtest to ratify or escalate. The 90° SPAWN bank (both sources agree) is an
//     entry flourish the plane rolls out of as it settles into the weave.
//   * DISCHK PROXIMITY WIRING (findings §2). rb2-1 hardcoded `proximity: 'far'` in
//     main.ts because there were no enemies. THIS story wires the live nearest-enemy
//     depth through `proximityBand` into FlightInput.proximity, so the control feel
//     sharpens (near ×1.0 / mid ×0.625 / far ×0.375) as the enemy closes. The band
//     thresholds are an INFERRED tunable (not ROM-pinned) — tested BEHAVIOURALLY
//     (spawn depth is 'far'; monotone; total on degenerate input), not as magic
//     numbers.
//
// The exact ROM DATA is pinned to the byte (the window tables, P.INDP, ACCEL, the
// 25 % roll, the 90° entry). Where the ROM→radian scale, the proximity thresholds,
// and the depth-closing rate are Dev tuning (the source does not pin them), the
// behaviour is pinned BEHAVIOURALLY — sign, bounds, monotonicity, weave/reversal —
// not as fabricated constants.
//
// Loaded defensively (await import in beforeAll, the flight.test.ts house pattern):
// during RED `src/core/enemy.ts` does not exist, so each test reports a clean
// assertion failure instead of a suite-collection crash. flight.ts / biplane.ts /
// scene.ts and @arcade/shared/rng DO exist — imported statically so the integration
// tests drive the REAL flight model, render substrate, and seeded PRNG.

import { describe, it, expect, beforeAll } from 'vitest'
import { multiply, translation, rotationZ, type Mat4 } from '@arcade/shared/math3d'
import { createRng, type Rng } from '@arcade/shared/rng'
import { step as flightStep, INITIAL_FLIGHT, DISCHK, type ProximityBand } from '../../src/core/flight'
import { biplaneLOD, biplaneBank, renderModel } from '../../src/core/biplane'
import { sceneProjection } from '../../src/core/scene'

// --- local mirror of the RED contract (kept out of the static import graph so the
//     file loads while src/core/enemy.ts does not yet exist) ---

interface Enemy {
  readonly kind: 'lead' | 'drone' // rb2-7 added the lead/drone discriminant to Enemy
  readonly x: number
  readonly y: number
  readonly depth: number
  /** rb4-16 — POSITION Z, the depth the servo's perspective divide reads; `?? depth` when absent. */
  readonly positionZ?: number
  readonly deltaX: number
  /** rb4-6 — ΔY, the vertical weave velocity. Optional, exactly as the real Enemy has it. */
  readonly deltaY?: number
  readonly bank: number
  /** rb4-6 — frames of ±90° entry-bank flourish still to roll out (RBARON.MAC:2620-2652). */
  readonly entryFrames?: number
  readonly side: -1 | 1
  readonly active: boolean
  /**
   * rb4-13 — the PLSTAT+6 D4 orientation mirror. `true` ⇔ D4=0 "PLANE FACING
   * AWAY" (RBARON.MAC:2652); `false` ⇔ D4=1, still rotated toward the viewer.
   * THIS, not depth, picks the biplane model (DRNPIC, RBARON.MAC:4961-4970).
   */
  readonly facingAway: boolean
}

interface EnemyModule {
  P_OLIM?: readonly number[]
  P_ILIM?: readonly number[]
  P_INDP?: number
  /** P.MNDP — the plane's depth FLOOR. Re-exported by enemy.ts (its ROM name; rb4-1). */
  P_MNDP?: number
  ACCEL?: number
  LONE_PLANE_CHANCE?: number
  /** rb4-16 — the perspective-divide fixed-point the servo reads its zone in (screen == world at this depth). */
  POSITH_SCALE?: number
  spawn?: (rng: Rng, level?: number) => Enemy
  step?: (enemy: Enemy, level?: number) => Enemy
  proximityBand?: (depth: number) => ProximityBand
}

let m: EnemyModule = {}

beforeAll(async () => {
  try {
    m = (await import('../../src/core/enemy')) as EnemyModule
  } catch {
    m = {}
  }
})

/** Fail loud-and-clear when a contract export is missing (RED-friendly). */
function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`src/core/enemy.ts must export ${name} (rb2-4 RED contract)`)
  }
  return value
}

/** A fresh seeded plane; a fixed seed keeps each test deterministic. */
const spawnAt = (seed = 1, level = 0): Enemy => need(m.spawn, 'spawn')(createRng(seed), level)

/** Override Enemy fields while carrying whatever extra fields Dev adds (robust hand-build). */
const withEnemy = (overrides: Partial<Enemy>, seed = 1, level = 0): Enemy => ({
  ...spawnAt(seed, level),
  ...overrides,
})

/** Advance `n` calc frames, returning the per-frame trace of the weave. */
function trace(seed: number, level: number, n: number): { xs: number[]; deltas: number[]; banks: number[]; depths: number[] } {
  const step = need(m.step, 'step')
  let e = spawnAt(seed, level)
  const xs = [e.x]
  const deltas = [e.deltaX]
  const banks = [e.bank]
  const depths = [e.depth]
  for (let i = 0; i < n; i++) {
    e = step(e, level)
    xs.push(e.x)
    deltas.push(e.deltaX)
    banks.push(e.bank)
    depths.push(e.depth)
  }
  return { xs, deltas, banks, depths }
}

// `crossings()` lived here to count weaves ACROSS centre. rb4-6 retired its last caller: the ROM's
// P.INER reverses a plane AWAY from centre at the inner window (:2794-2796), so a plane never
// crosses, and that test is now a liveness check (L306). Removed rather than left dead.

const range = (xs: readonly number[]): number => Math.max(...xs) - Math.min(...xs)
const maxAbs = (xs: readonly number[]): number => Math.max(...xs.map(Math.abs))

// ───────────────────────────────────────────────────────────────────────────
// AC-1 — the GMLEVL-indexed weave window (P.OLIM / P.ILIM tables)
// ───────────────────────────────────────────────────────────────────────────
describe('enemy — P.OLIM / P.ILIM window tables (findings §3, R2BRON.MAC:2935-2952)', () => {
  const OLIM = [0x40, 0x80, 0x120, 0x1a0, 0x200]
  const ILIM = [0x20, 0x30, 0x80, 0x120, 0x160]

  it('P_OLIM is the byte-exact outer-limit table (5 GMLEVL entries)', () => {
    const t = need(m.P_OLIM, 'P_OLIM')
    expect([...t]).toEqual(OLIM)
    expect(t.length).toBe(5) // .LEVLS = 5 (GMLEVL 0..4)
  })

  it('P_ILIM is the byte-exact inner-limit table (5 GMLEVL entries)', () => {
    const t = need(m.P_ILIM, 'P_ILIM')
    expect([...t]).toEqual(ILIM)
    expect(t.length).toBe(5)
  })

  it('the window is well-formed at EVERY level — inner strictly inside outer, both positive', () => {
    // A weave window with inner ≥ outer would never turn around; guard the whole table.
    const olim = need(m.P_OLIM, 'P_OLIM')
    const ilim = need(m.P_ILIM, 'P_ILIM')
    for (let lvl = 0; lvl < olim.length; lvl++) {
      expect(ilim[lvl]).toBeGreaterThan(0)
      expect(ilim[lvl]).toBeLessThan(olim[lvl])
    }
  })

  it('higher GMLEVL means a wider, more aggressive window (outer limit is non-decreasing)', () => {
    const olim = need(m.P_OLIM, 'P_OLIM')
    for (let lvl = 1; lvl < olim.length; lvl++) {
      expect(olim[lvl]).toBeGreaterThanOrEqual(olim[lvl - 1])
    }
    expect(olim[olim.length - 1]).toBeGreaterThan(olim[0]) // and strictly wider end-to-end
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-2 — ROM spawn/steer constants
// ───────────────────────────────────────────────────────────────────────────
describe('enemy — ROM constants P.INDP / ACCEL / lone-plane roll (findings §3)', () => {
  // rb4-1 RE-BASELINE. These two asserted the DECIMAL misreading and cited the DECOY
  // build (R2BRON.MAC — never shipped). RBARON.MAC is `.RADIX 16` from :74, so the
  // literals are HEX. Derivation is audited in tests/audit/radix-transcription.test.ts.
  it('P_INDP spawn depth is 0x1080 = 4224 (P.INDP, RBARON.MAC:464, .RADIX 16)', () => {
    expect(need(m.P_INDP, 'P_INDP')).toBe(0x1080)
    expect(need(m.P_INDP, 'P_INDP')).not.toBe(1080) // the decimal misreading we shipped
  })

  it('ACCEL — the ΔX weave acceleration per calc frame — is 0x30 = 48 (RBARON.MAC:465, .RADIX 16)', () => {
    expect(need(m.ACCEL, 'ACCEL')).toBe(0x30)
    expect(need(m.ACCEL, 'ACCEL')).not.toBe(30) // the decimal misreading we shipped
  })

  it('LONE_PLANE_CHANCE is the 25 % RANDOM roll (findings §3)', () => {
    // The roll selects lone-vs-formation once formations exist (rb2-7); this story
    // ships the lone-plane branch, but the ROM probability is pinned now.
    expect(need(m.LONE_PLANE_CHANCE, 'LONE_PLANE_CHANCE')).toBeCloseTo(0.25, 12)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-3 — spawn: a lone plane, from a screen side, banked 90°, at depth P.INDP
// ───────────────────────────────────────────────────────────────────────────
describe('enemy — spawn (NWPLNE: side entry, 90° bank, depth P.INDP)', () => {
  it('spawns AT depth P.INDP — the plane enters far away', () => {
    expect(spawnAt(1).depth).toBe(need(m.P_INDP, 'P_INDP'))
    expect(spawnAt(99).depth).toBe(need(m.P_INDP, 'P_INDP'))
  })

  it('enters banked 90° (±π/2) — the entry flourish, steeper than any steering bank', () => {
    // "enters from a screen side banked 90°". 90° = π/2 exceeds biplaneBank's ±45°
    // clamp, so this is a literal entry orientation, not a steering-derived bank.
    for (const seed of [1, 2, 7, 42]) {
      expect(Math.abs(spawnAt(seed).bank)).toBeCloseTo(Math.PI / 2, 6)
    }
  })

  it('enters from a SIDE — x is on the side it came from and inside the outer window', () => {
    for (const seed of [1, 2, 7, 42, 100]) {
      const e = spawnAt(seed, 0)
      expect(e.side === -1 || e.side === 1).toBe(true)
      expect(Math.sign(e.x)).toBe(e.side) // on the side it entered
      expect(Math.abs(e.x)).toBeGreaterThan(0) // not dead centre
      expect(Math.abs(e.x)).toBeLessThanOrEqual(need(m.P_OLIM, 'P_OLIM')[0] + 1e-9) // within the window
    }
  })

  it('spawns ACTIVE and ready to weave', () => {
    expect(spawnAt(1).active).toBe(true)
  })

  it('is deterministic per seed and independently varies X and Y across seeds (consumes the Rng)', () => {
    // Same seed → identical plane (pure, seeded). Different seeds → X AND Y must EACH
    // vary — a broken single-axis draw masked by the other axis must NOT slip through
    // (the old combined `${x},${y}` set couldn't tell them apart).
    expect(spawnAt(5)).toEqual(spawnAt(5))
    const many = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => spawnAt(s))
    expect(new Set(many.map((e) => e.x)).size).toBeGreaterThan(1) // X actually randomized
    expect(new Set(many.map((e) => e.y)).size).toBeGreaterThan(1) // Y actually randomized
    // ...and Y stays finite and on-screen-bounded (never NaN or an absurd off-screen value).
    const olimMax = need(m.P_OLIM, 'P_OLIM')[need(m.P_OLIM, 'P_OLIM').length - 1]
    for (const e of many) {
      expect(Number.isFinite(e.y)).toBe(true)
      expect(Math.abs(e.y)).toBeLessThanOrEqual(olimMax)
    }
  })

  it('advances the Rng seed — spawn is not a no-op on the generator', () => {
    const rng = createRng(1234)
    const before = rng.seed
    need(m.spawn, 'spawn')(rng, 0)
    expect(rng.seed).not.toBe(before)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-4 — weaving window-follower steering (accelerate to limits, reverse, weave)
// ───────────────────────────────────────────────────────────────────────────
describe('enemy — weaving window-follower steering (UPDPLN, findings §3)', () => {
  it('stays inside the outer window — the weave never escapes ±P_OLIM', () => {
    const olim = need(m.P_OLIM, 'P_OLIM')[0]
    const { xs } = trace(7, 0, 300)
    expect(maxAbs(xs)).toBeLessThanOrEqual(olim + 1e-6)
  })

  // rb4-6 ROUND 2 RE-SEAT (the three tests below): driven at GMLEVL 2, not 0.
  //
  // Round 2 transcribed the ROM's per-zone target deltas, and P.IIDL[0] = 0 (`.3WORD 0,…`,
  // RBARON.MAC:2955) — at GMLEVL 0 the inner target is a DEAD STOP. A level-0 plane therefore
  // drifts in at P.IDLX[0]/4 = 6 units/frame, reaches the inner window, and PARKS: ΔX never takes
  // a negative sign and the late half never swings back past P.ILIM. That is not a regression, it
  // is the byte — GMLEVL 0 is the gentle level, and the plane sits in your sights (AC-R3 measures
  // it in reach for 599 of 600 frames). These tests are about the WINDOW-FOLLOWER machine, so they
  // now run at a GMLEVL where the machine actually weaves; the level-0 dead stop is pinned as a
  // contract by enemy-machine.test.ts's `P.IIDL — INNER deltas`.
  it('weaves — moves a real range and reverses (rb4-6 moved the turnaround to the INNER window, so it need not cross centre)', () => {
    // rb4-6 AC-1: the reversal is now at the INNER window (HEAD AWAY FROM CENTER), so the
    // plane weaves on its ENTRY SIDE and no longer necessarily crosses centre. The
    // surviving intent here is liveness — it is not stuck on a spot. The one-sided
    // inner-reversal SHAPE is pinned deterministically in enemy-machine.test.ts.
    // (Was: crossings(xs) >= 2, which encoded the old outer-only weave that drifts across
    // centre — that is exactly the machine rb4-6 replaces.)
    const { xs, deltas } = trace(7, 2, 300)
    expect(range(xs)).toBeGreaterThan(0) // it moves across a real range
    expect(deltas.some((d) => d > 0) && deltas.some((d) => d < 0)).toBe(true) // and reverses
  })

  it('REVERSES at the boundaries — ΔX takes both signs over a run', () => {
    const { deltas } = trace(7, 2, 300)
    expect(deltas.some((d) => d > 0)).toBe(true)
    expect(deltas.some((d) => d < 0)).toBe(true)
  })

  it('flies OUT toward the limit — the excursion clears the inner window band', () => {
    // A weave that only jittered near centre would pass "crosses 0" vacuously; pin
    // that it actually swings out past P.ILIM toward the outer turnaround.
    const ilim = need(m.P_ILIM, 'P_ILIM')[0]
    const { xs } = trace(7, 0, 300)
    expect(maxAbs(xs)).toBeGreaterThan(ilim)
  })

  it('is NOT a beeline seeker — with the player at centre it never settles at 0', () => {
    // A seeker would drive the plane to centre AND stop (deltaX → 0). The window-follower keeps
    // WEAVING — it never stops reversing. rb4-16 re-seat: the servo now reads the plane's SCREEN
    // position, and as the plane closes its screen window maps to a SHRINKING world excursion
    // (correctly keeping it on screen), so the old `maxAbs(world) > ilim` proxy no longer separates
    // weave from seek — a faithful weaver's world excursion legitimately falls toward the boresight
    // centre as depth closes. The discriminator that survives is the DELTA: a seeker's would decay to
    // ~0, the window-follower's keeps taking BOTH signs. (100 frames — within the plane's life before
    // it bores past P.MNDP; the late half is still airborne.)
    const { deltas } = trace(7, 2, 100)
    const late = deltas.slice(deltas.length / 2)
    expect(late.some((d) => d > 0), 'deltaX never went positive late — the weave decayed to a seek').toBe(true)
    expect(late.some((d) => d < 0), 'deltaX never went negative late — the weave decayed to a seek').toBe(true)
  })

  it('a higher GMLEVL weaves WIDER — level 4 swings past the entire level-0 window', () => {
    const olim0 = need(m.P_OLIM, 'P_OLIM')[0]
    const wide = maxAbs(trace(7, 4, 400).xs)
    const narrow = maxAbs(trace(7, 0, 400).xs)
    expect(narrow).toBeLessThanOrEqual(olim0 + 1e-6) // level 0 stays in its small window
    expect(wide).toBeGreaterThan(olim0) // level 4 flies out past it
  })

  it('a higher GMLEVL CLOSES faster — through step(), not just closeSpeed() in isolation', () => {
    // rb4-1 REWORK 2 (Reviewer finding 5). The rework deleted the invented flat CLOSE_SPEED
    // and wired the ROM's own PLPOSZ[GMLEVL] — which PLNZD stores as "PLANE MOTION DEPTH
    // DELTA" (RBARON.MAC:2409-2411). enemy.ts:52 now claims deeper levels close "up to 20x
    // faster", and that claim was only ever tested on closeSpeed() directly. The weave has a
    // through-step() test (above); the closing rate — the thing the player actually feels —
    // had none. So the plane's approach rate could be wired to anything and this suite would
    // not have noticed.
    const step = need(m.step, 'step')
    const P_MNDP = need(m.P_MNDP, 'P_MNDP')

    /** Calc-frames for a freshly-spawned plane at `level` to bore in to its P.MNDP floor. */
    const framesToFloor = (level: number, cap = 4000): number => {
      let e = spawnAt(7, level)
      for (let f = 0; f < cap; f++) {
        e = step(e, level)
        if (e.depth <= P_MNDP + 1e-9) return f + 1
      }
      return cap
    }

    const slow = framesToFloor(0) // PLPOSZ[0] = -0x04
    const fast = framesToFloor(5) // PLPOSZ[5] = -0x50 — twenty times the delta
    expect(slow).toBeLessThan(4000) // it does arrive (a flat/zero rate would hit the cap)
    expect(fast).toBeLessThan(slow) // …and the ace arrives first
    // 20x the per-frame delta means ~1/20th the frames. Bound it loosely (the weave and the
    // floor clamp cost a frame either side) but tightly enough that a flat rate cannot pass.
    expect(slow / fast).toBeGreaterThan(10)
  })

  it('the plane never tunnels BEHIND the eye — while active its depth stays in front (rb4-6: it flies PAST, not to a floor)', () => {
    // rb4-6 AC-3: P.MNDP is no longer a floor — the plane bores PAST it and is destroyed
    // (active → false; the fly-past is pinned in enemy-machine.test.ts). The surviving
    // safety intent is that while it is a LIVE object its depth stays in FRONT of the eye
    // (> 0); it never tunnels to a negative depth. Once it flies past it deactivates and
    // this loop stops tracking it. (Was: depth >= P_MNDP for 2000 frames — the old clamp.)
    const step = need(m.step, 'step')
    for (const level of [0, 3, 5]) {
      let e = spawnAt(7, level)
      for (let f = 0; f < 2000 && e.active; f++) {
        e = step(e, level)
        if (!e.active) break
        expect(e.depth, `GMLEVL ${level} tunnelled behind the eye on frame ${f}`).toBeGreaterThan(0)
      }
    }
  })

  it('is a pure, deterministic step — same (enemy, level) gives the same next frame, input untouched', () => {
    const step = need(m.step, 'step')
    const e = spawnAt(3, 0)
    const snapshot = JSON.stringify(e)
    expect(step(e, 0)).toEqual(step(e, 0)) // deterministic
    expect(JSON.stringify(e)).toBe(snapshot) // no mutation of the input (readonly contract)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-4b — GMLEVL clamping + direct boundary reversal (review-rework edge cases)
// ───────────────────────────────────────────────────────────────────────────
describe('enemy — GMLEVL clamping & direct boundary reversal', () => {
  const olimMax = (): number => {
    const t = need(m.P_OLIM, 'P_OLIM')
    return t[t.length - 1]
  }

  it('clamps an out-of-range GMLEVL — negative / >max / NaN / non-integer never read P_OLIM[undefined]', () => {
    const step = need(m.step, 'step')
    const P_INDP = need(m.P_INDP, 'P_INDP')
    for (const bad of [-1, -100, 5, 99, Number.NaN, 2.7]) {
      const e = spawnAt(3, bad)
      expect(Number.isFinite(e.x)).toBe(true) // no NaN leak from a bad level index
      expect(Math.abs(e.x)).toBeLessThanOrEqual(olimMax() + 1e-9) // inside SOME valid window
      const s = step(e, bad) // stepping a degenerate level must also stay total + bounded
      expect(Number.isFinite(s.x)).toBe(true)
      expect(Math.abs(s.x)).toBeLessThanOrEqual(olimMax() + 1e-9)

      // rb4-1 REWORK 2 (Reviewer finding 5). The rework wired `level` into the plane's
      // CLOSING RATE (closeSpeed -> PLPOSZ[GMLEVL]), so a bad level index now reaches the
      // DEPTH axis and not just x. And the two clamps live in different modules over
      // different-length tables — enemy.ts clamps to P_OLIM (5), returning-ace.ts to
      // PLPOSZ (9) — so `x` being safe is no longer evidence that `depth` is.
      expect(Number.isFinite(s.depth), `a GMLEVL of ${String(bad)} leaked a non-finite depth`).toBe(
        true,
      )
      expect(s.depth).toBeLessThanOrEqual(P_INDP)
      expect(s.depth).toBeGreaterThan(0) // never dives through the player
    }
  })

  it('spawns inside the WIDER band at a higher GMLEVL — level indexes the window', () => {
    const olim0 = need(m.P_OLIM, 'P_OLIM')[0]
    const olim4 = need(m.P_OLIM, 'P_OLIM')[4]
    const seeds = [1, 2, 7, 42, 100]
    for (const seed of seeds) {
      const e = spawnAt(seed, 4)
      expect(Math.sign(e.x)).toBe(e.side)
      expect(Math.abs(e.x)).toBeLessThanOrEqual(olim4 + 1e-9) // inside the level-4 window
    }
    // and the band really widened: at least one level-4 spawn lands past the whole level-0 window
    const widest = Math.max(...seeds.map((s) => Math.abs(spawnAt(s, 4).x)))
    expect(widest).toBeGreaterThan(olim0)
  })

  it('reverses IMMEDIATELY at the outer wall — a plane pinned at ±P_OLIM turns back inward', () => {
    // Deterministic, not inferred from a random trace: seed the plane at the outer window moving
    // outward; one step must decelerate its delta, and within a short run it weaves back inward.
    //
    // rb4-16 (AC-3): the old ±P_OLIM WORLD fence is RETIRED — the world position is no longer clamped
    // to ±olim. The bound is now PLONSN's depth-scaled SCREEN window (far outside olim at this depth),
    // and the servo reads the plane's SCREEN zone. Seat the plane at the identity depth (positionZ =
    // POSITH_SCALE ⇒ screen == world) so `x = olim` sits AT the outer window; pin the REVERSAL the
    // servo performs there, not a world-position ceiling (which was the stand-in clamp this story kills).
    const step = need(m.step, 'step')
    const olim = need(m.P_OLIM, 'P_OLIM')[0]
    const identity = need(m.POSITH_SCALE, 'POSITH_SCALE')

    const right = step(withEnemy({ x: olim, deltaX: 50, positionZ: identity }), 0)
    expect(right.deltaX).toBeLessThan(50) // ΔX decelerating — heading reversed at the outer window
    let e = withEnemy({ x: olim, deltaX: 50, positionZ: identity })
    let minX = e.x
    for (let i = 0; i < 20; i++) {
      e = step(e, 0)
      minX = Math.min(minX, e.x)
    }
    expect(minX).toBeLessThan(olim) // it left the +wall and weaved back inward

    const left = step(withEnemy({ x: -olim, deltaX: -50, positionZ: identity }), 0) // symmetric at the −window
    expect(left.deltaX).toBeGreaterThan(-50) // ΔX decelerating — heading reversed at the −outer window
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-5 — bank ∝ turn-rate, reusing the player's biplaneBank coupling
// ───────────────────────────────────────────────────────────────────────────
describe('enemy — bank ∝ turn-rate via biplaneBank (context: shared ±45° coupling)', () => {
  it('rolls OUT of the 90° entry as it settles into the weave (settled bank is shallower)', () => {
    const { banks } = trace(7, 0, 300)
    expect(Math.abs(banks[0])).toBeCloseTo(Math.PI / 2, 6) // entry: 90°
    const settled = banks.slice(200) // long after entry
    for (const b of settled) expect(Math.abs(b)).toBeLessThan(Math.PI / 2 - 0.1) // shallower now
  })

  it('the settled steering bank IS biplaneBank(ΔX) — one shared coupling, no duplicated ROLL_SCALE', () => {
    // The context rules the enemy reuses flight.ts's biplaneBank (findings §2), so the
    // enemy and the player horizon bank through the SAME PFROTN×8 clamp. Pin the exact
    // identity across the settled weave. [Deviation logged: the raw ROM §3 uses
    // −4·ΔX/±0x1FF — see Delivery Findings.]
    const { banks, deltas } = trace(7, 0, 300)
    for (let i = 200; i < banks.length; i++) {
      expect(banks[i]).toBeCloseTo(biplaneBank(deltas[i]), 9)
    }
  })

  it('a ΔX = 0 frame produced BY step() has zero bank — 0 is a real value, not a falsy default (rule #4)', () => {
    // The classic `x || fallback` numeric bug: 0 is falsy but a VALID turn-rate.
    // Drive a REAL step() through the ΔX=0 crossing (don't hand-set bank): at the
    // outer wall the weave decelerates through zero as it reverses — seed x=P_OLIM
    // with ΔX=+ACCEL so the very next step's ΔX is exactly 0.
    //
    // rb4-6 round-2 re-seat: `entryFrames: 0` — a SETTLED plane. The bank is only
    // biplaneBank(ΔX) once the ±90° entry flourish has rolled out (problem item 5); while the
    // ramp runs, the bank is the ramp's, by design, whatever ΔX does. `withEnemy` spreads a fresh
    // spawn, which enters mid-flourish, so this fixture was reading the ramp's bank and calling it
    // the coupling's. It only passed in round 1 because the ramp ALSO terminated on ΔX = 0 — one
    // signal doing two jobs, which is the coupling AC-4 caught (see enemy.ts's `entryFrames`).
    // The ΔX=0 → bank=0 intent is unchanged; it is now asserted on the state that governs it.
    const step = need(m.step, 'step')
    const olim = need(m.P_OLIM, 'P_OLIM')[0]
    const accel = need(m.ACCEL, 'ACCEL')
    const reversing = step(withEnemy({ x: olim, deltaX: accel, entryFrames: 0 }), 0)
    expect(reversing.deltaX).toBe(0) // step() actually produced a zero turn-rate...
    expect(reversing.bank).toBe(0) // ...and the bank read a genuine 0, not a fallback
    expect(biplaneBank(0)).toBe(0) // and the coupling itself maps 0 → 0
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-6 — DISCHK proximity wiring (live nearest-enemy depth → ProximityBand)
// ───────────────────────────────────────────────────────────────────────────
describe('enemy — proximityBand: depth → DISCHK band (findings §2 wiring)', () => {
  it('a freshly-spawned (far) plane reads the slow FAR band', () => {
    const proximityBand = need(m.proximityBand, 'proximityBand')
    expect(proximityBand(spawnAt(1).depth)).toBe('far')
    expect(proximityBand(need(m.P_INDP, 'P_INDP'))).toBe('far')
  })

  it('a point-blank plane reads the sharp NEAR band', () => {
    expect(need(m.proximityBand, 'proximityBand')(1)).toBe('near')
  })

  it('covers all three bands and returns ONLY a valid ProximityBand for any depth (exhaustive)', () => {
    const proximityBand = need(m.proximityBand, 'proximityBand')
    const seen = new Set<ProximityBand>()
    for (let depth = 0; depth <= need(m.P_INDP, 'P_INDP'); depth += 5) {
      const band = proximityBand(depth)
      expect(['near', 'mid', 'far']).toContain(band) // #3 exhaustive union — no stray value
      seen.add(band)
    }
    expect(seen).toEqual(new Set<ProximityBand>(['near', 'mid', 'far'])) // all three reachable
  })

  it('is MONOTONE — closing the distance never jumps to a slower band', () => {
    const proximityBand = need(m.proximityBand, 'proximityBand')
    const rank: Record<ProximityBand, number> = { far: 0, mid: 1, near: 2 }
    let prev = rank[proximityBand(need(m.P_INDP, 'P_INDP'))]
    for (let depth = need(m.P_INDP, 'P_INDP'); depth >= 0; depth -= 5) {
      const r = rank[proximityBand(depth)]
      expect(r).toBeGreaterThanOrEqual(prev) // closer ⇒ same-or-sharper band, never slower
      prev = r
    }
  })

  it('is TOTAL — degenerate depth (negative, NaN, ±Infinity) still yields a valid band (rule #4)', () => {
    const proximityBand = need(m.proximityBand, 'proximityBand')
    for (const d of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(['near', 'mid', 'far']).toContain(proximityBand(d))
    }
  })

  it('drives the REAL flight model — a near enemy SLOWS the yoke vs a far one (DISCHK)', () => {
    // The whole point of the wiring: proximityBand(enemy.depth) → FlightInput.proximity
    // → DISCHK scales the world pan. Prove it end-to-end through the real flight.step.
    // rb4-5 AC3: the ROM bands are close ×0.375 / far ×1.0, so a point-blank enemy makes
    // the same turn command pan LESS than a far one (control goes sluggish under his nose).
    const proximityBand = need(m.proximityBand, 'proximityBand')
    const farBand = proximityBand(spawnAt(1).depth) // 'far'
    const nearBand = proximityBand(1) // 'near'
    expect(DISCHK[farBand]).toBeGreaterThan(DISCHK[nearBand]) // sanity: far is full control, near is slow

    const pan = (proximity: ProximityBand): number => {
      let s = INITIAL_FLIGHT
      for (let i = 0; i < 20; i++) s = flightStep(s, { turn: 1, pitch: 0, proximity })
      return s.heading
    }
    expect(pan(farBand)).toBeGreaterThan(pan(nearBand)) // control feel goes sluggish near combat
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-6b — the plane BORES IN: step() closes the depth so DISCHK sharpens over time
// (review-rework: the closing mechanic was previously untested)
// ───────────────────────────────────────────────────────────────────────────
describe('enemy — depth closes on approach (the seam that makes DISCHK bite)', () => {
  it('depth decreases MONOTONICALLY under step(), starting from the spawn depth', () => {
    const { depths } = trace(7, 0, 200)
    expect(depths[0]).toBe(need(m.P_INDP, 'P_INDP')) // starts at the far spawn depth
    for (let i = 1; i < depths.length; i++) {
      expect(depths[i]).toBeLessThanOrEqual(depths[i - 1]) // never retreats
    }
    expect(depths[depths.length - 1]).toBeLessThan(depths[0]) // it actually closed
  })

  it('does NOT hover at a floor — a long approach ends in a FLY-PAST, the plane destroyed (rb4-6)', () => {
    // rb4-6 AC-3 retires the "stable positive floor". The plane closes past P.MNDP and is
    // destroyed as an object (active → false); it does not clamp and hover in your face
    // forever. A long enough run must END in that deactivation — the closest-approach
    // floor is gone. (Was: a longer trace lands on the exact same clamped floor.)
    const step = need(m.step, 'step')
    let e = spawnAt(7, 0)
    let frames = 0
    for (; frames < 4000 && e.active; frames++) e = step(e, 0)
    expect(e.active, 'the plane hovered at a depth floor forever — it never flew past').toBe(false)
    expect(frames).toBeLessThan(4000) // it deactivated (flew past), it did not clamp
  })

  it('closing walks the DISCHK band far → near — the story\'s "sharpens as it closes" is delivered', () => {
    // End-to-end proof that step()'s closing feeds proximityBand: the band the player's
    // yoke sees transitions from the slow 'far' at spawn to the sharp 'near' at approach,
    // monotonically. Had step() forgotten to close depth, this would sit at 'far' forever.
    const proximityBand = need(m.proximityBand, 'proximityBand')
    const rank: Record<ProximityBand, number> = { far: 0, mid: 1, near: 2 }
    const { depths } = trace(7, 0, 1000)
    expect(proximityBand(depths[0])).toBe('far') // spawns in the slow band
    expect(proximityBand(depths[depths.length - 1])).toBe('near') // closes into the sharp band
    for (let i = 1; i < depths.length; i++) {
      expect(rank[proximityBand(depths[i])]).toBeGreaterThanOrEqual(rank[proximityBand(depths[i - 1])])
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-7 — the spawned enemy renders through the rb2-3 biplane substrate
// ───────────────────────────────────────────────────────────────────────────
describe('enemy — renders through biplaneLOD + renderModel (rb2-3 carryforward)', () => {
  it('a spawned enemy is IN FRONT and draws finite NDC segments (depth sign is correct)', () => {
    // Compose the render exactly as the cockpit will: model = translate(x,y,-depth) ∘
    // rotateZ(bank); MVP = projection · model; pick the model by THE ORIENTATION BIT
    // (rb4-13 — never by depth); walk it. This pins that the enemy pose places it in
    // FRONT of the eye (depth > 0 ⇒ world −Z) and produces real geometry — a Dev who
    // stored depth with the wrong sign draws 0.
    const e = spawnAt(1)
    const proj = sceneProjection(1)
    const model: Mat4 = multiply(translation(e.x, e.y, -e.depth), rotationZ(e.bank))
    const mvp: Mat4 = multiply(proj, model)
    const segs = renderModel(biplaneLOD(e.facingAway), mvp)
    expect(segs.length).toBeGreaterThan(0)
    for (const s of segs) {
      for (const v of [s.x1, s.y1, s.x2, s.y2]) expect(Number.isFinite(v)).toBe(true)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// rb4-13 — the PLSTAT+6 D4 orientation bit: the model switch the ROM ships
// ───────────────────────────────────────────────────────────────────────────
//
// DRNPIC (RBARON.MAC:4961-4970, `.RADIX 16` set at :74) picks the plane model on
// `LDA PLSTAT+6 / AND I,10` — bit D4 — not on distance; no depth compare exists
// anywhere in the picture path. The bit's LIFECYCLE (RBARON.MAC:2620-2652): a
// plane ENTERS rotated toward the viewer (D4=1) while the entry rotation ramps
// its Y-rotation to zero; when the ramp completes, `AND I,0EF / STA PLSTAT+6
// ;D4=0 (PLANE FACING AWAY)` — and the weave never sets it back (re-rotation
// belongs to the returning-ace pass, a different story). Without the lifecycle
// pin, one model is dead code — the drone LOD had literally NEVER RENDERED in
// the shipped clone until rb4-1 (see depth-scale.test.ts REGISTRY 6/7 history).
describe('enemy — the PLSTAT+6 D4 orientation bit (rb4-13: the model answers to it, not depth)', () => {
  it('spawns ROTATED-IN (facingAway = false): the entry turn is still running (D4=1)', () => {
    // Strict booleans, deliberately: a spawn that omits the field (undefined) fails
    // here — the bit must exist and carry the ROM's entry state, not merely be falsy.
    expect(spawnAt(1).facingAway).toBe(false)
    expect(spawnAt(77).facingAway).toBe(false)
    expect(spawnAt(2024, 3).facingAway).toBe(false)
  })

  it('settles FACING AWAY within the entry flourish, and the weave never rotates it back', () => {
    // ROM: D4 clears ONLY when the entry rotation completes. The clone's analog is
    // the ±90° entry flourish rolling out into the weave — Dev gets up to 8 calc
    // frames of flourish; after the flip the bit must hold for the whole flight.
    const stepFn = need(m.step, 'step')
    let e = spawnAt(3)
    let settled = -1
    for (let i = 1; i <= 300; i++) {
      e = stepFn(e)
      if (settled < 0 && e.facingAway === true) settled = i
      if (settled > 0) expect(e.facingAway, `step ${i}: once facing away, stays facing away`).toBe(true)
    }
    expect(settled, 'the plane must actually settle facing away — else the drone model is dead code').toBeGreaterThan(0)
    expect(settled).toBeLessThanOrEqual(8)
  })

  it('the model follows the BIT at ANY depth — same depth two models, swept depth one model (AC-3)', () => {
    // The rb4-1 trap, closed at the seam: stage the SAME depth with both orientations
    // (models must differ), then sweep the depth across the whole band with each
    // orientation held (model must not change). HONEST SCOPE (rb4-13 review): the bits
    // here are HAND-SET via withEnemy — this test pins the seam MAPPING (bit → drawn
    // model), not the bit's derivation; a depth-derived bit inside enemy.ts is killed
    // by the two lifecycle tests above (spawn=false at the DEEPEST depth is what buries
    // deep-means-away), and a depth rule inside biplaneLOD by biplane.test.ts's matrix.
    const proj = sceneProjection(1)
    const segsFor = (e: Enemy): number => {
      const model: Mat4 = multiply(translation(e.x, e.y, -e.depth), rotationZ(e.bank))
      return renderModel(biplaneLOD(e.facingAway), multiply(proj, model)).length
    }
    const floor = need(m.P_MNDP, 'P_MNDP') // 0x140 = 320
    const spawnDepth = need(m.P_INDP, 'P_INDP') // 0x1080 = 4224
    for (const depth of [floor, 1732, spawnDepth]) {
      const away = withEnemy({ depth, facingAway: true, x: 0, y: 0, bank: 0 })
      const toward = withEnemy({ depth, facingAway: false, x: 0, y: 0, bank: 0 })
      expect(segsFor(away), `facing away at depth ${depth} → the 30-segment drone`).toBe(30)
      expect(segsFor(toward), `rotated toward at depth ${depth} → the 54-segment full plane`).toBe(54)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-8 — purity: no DOM / time / ambient randomness (module contract)
// ───────────────────────────────────────────────────────────────────────────
describe('enemy — pure & deterministic (the only randomness is the injected Rng)', () => {
  it('the full spawn→weave sequence is reproducible from the seed alone', () => {
    const runOnce = (): number[] => trace(2024, 2, 50).xs
    expect(runOnce()).toEqual(runOnce()) // identical every time — no Date/Math.random leak
  })

  it('two independently-seeded planes with the SAME seed weave identically', () => {
    const a = trace(11, 1, 60)
    const b = trace(11, 1, 60)
    expect(a.xs).toEqual(b.xs)
    expect(a.deltas).toEqual(b.deltas)
  })
})

// tests/core/blimp.test.ts
//
// Story rb2-10 (RED, Han Solo / TEA) — RE-SEATED by rb4-15 (Imperator Furiosa / TEA).
// The Blimp / Zeppelin: the ONE enemy the sky owes the player that ISN'T a weaving
// biplane. rb2-10 built it as a constant-depth lateral drifter from findings §3;
// rb4-15's coverage review CONFIRMED that model FALSE (CD-005 — it borrowed the
// plane's div-by-2 fire and invented the cruise). The machine is an APPROACHING
// airship: Z-closing, N.PLNZ-gated, ÷4 fire, GMLEVL >= 2. Still worth a flat 200 pts,
// still the authentic BLIMP/DBLIMP picture-ROM geometry — there is no separate
// barrage balloon; the airship is the blimp.
//
// CONTRACT (re-seated by rb4-15 RED — THE BLIMP IS THE WRONG MACHINE): `src/core/blimp.ts`
// models an APPROACHING airship, not a constant-depth lateral drifter. Exports:
//
//   // --- ROM-exact data (RBARON.MAC, the citable ~/Projects/red-baron-source-text copy) ---
//   export const BLIMP_Z_START = 0x1000     // entry Z (INITBP :1425-1426)
//   export const BLIMP_CLOSE_SPEED = 0x80   // Z closed per calc-frame (BLMOTN :4259-4265)
//   export const BLIMP_PLANE_GATE = 4       // the N.PLNZ spawn gate (:2325-2327)
//   export const BLIMP_SPAWN_CHANCE = 0.25  // SURVIVES — the AND 0C roll (:2328-2330).
//                                            // Still a SEPARATE roll from enemy.ts's 25 %
//                                            // LONE_PLANE_CHANCE (lone-vs-formation).
//
//   export interface Blimp {
//     readonly x: number        // screen-window X
//     readonly y: number        // vertical offset — random at spawn
//     readonly depth: number    // Z in front of the eye — ENTERS at 0x1000 and CLOSES
//     readonly deltaX: number   // lateral velocity (the ROM's BLOBJ+0C — unpinned here)
//     readonly bank: number     // roll (radians): a Zeppelin flies LEVEL — 0 (inferred; see deviations)
//     readonly side: -1 | 1     // the screen side it entered from
//     readonly active: boolean  // D7 "active" status bit
//   }
//
//   export function shouldSpawnBlimp(planeCount: number, roll: number): boolean
//                       // TWO gates: planeCount >= BLIMP_PLANE_GATE, then roll < 0.25
//   export function blimpFires(frame: number, level: number): boolean
//                       // SHLAUN: FRAME & 3 === 0 (:4027-4030) AND GMLEVL >= 2 (:4038-4041)
//   export function spawn(rng: Rng, aspect: number): Blimp    // depth = BLIMP_Z_START
//   export function step(blimp: Blimp): Blimp                 // depth -= BLIMP_CLOSE_SPEED
//   export function reapBlimp(blimp: Blimp): Blimp | null     // null once depth < 0x100 (:4266-4270)
//
// The full ROM derivation + the machine's boundary matrix live in
// tests/core/blimp-approach.test.ts. This file keeps the ENTITY's integration seams
// (geometry, scoring, collision, explosion, purity) and re-seats what the drifter
// premise poisoned.
//
// WHY THIS SHAPE (re-derived firsthand from RBARON.MAC this session):
//   * TWO-GATE SPAWN (:2325-2331): LDA N.PLNZ / CMP I,4 / BCC skip — no blimp until four
//     planes have appeared in the game — THEN RANDOM / AND I,0C / BNE skip, the 1-in-4
//     roll. The shipped single-roll reading dropped the first gate entirely.
//   * APPROACHES, NOT A DRIFTER (INITBP + BLMOTN): enters at Z = 0x1000 = 4096 and closes
//     0x80 = 128 per calc-frame; below Z = 0x100 the ROM CLEARS BLOBJ — it flew past you.
//     The "steady constant-depth crossing" we shipped is CD-005's false certification.
//   * FIRES THROUGH THE SHARED SHLAUN (BLMOTN :4229 calls it): 1 frame in 4 (AND I,3),
//     and ONLY at GMLEVL >= 2 ("NO GROUND SHELLS @ LOWER LEVELS") — the shipped ÷2
//     no-level-gate blimp is the plane's fire model wearing an envelope.
//   * 200 PTS, FLAT: the kill scores the flat BLIMP_SCORE=200 at ANY depth (findings §4). The
//     score half already shipped in scoring.ts (rb2-6 stub); this suite drives the blimp ENTITY
//     through the REAL scoreKill('blimp', …) so the kill payoff is wired, not just the constant.
//   * AUTHENTIC GEOMETRY: topology.ts's BLIMP_PICTURE (36 verts, the DBLIMP connect-list, the
//     gondola gun barrel at verts 34/35 — all byte-pinned in topology.test.ts, rb2-2) is drawn
//     through the REAL biplane.renderModel from the blimp's pose — proving the entity draws the
//     authentic airship, not a stand-in. The geometry CONSTANTS are already covered by
//     topology.test.ts; this file tests the ENTITY's INTEGRATION with them, not the bytes again.
//
// Loaded defensively (await import in beforeAll, the enemy.test.ts house pattern): during
// RED `src/core/blimp.ts` does not exist, so each test reports a clean assertion failure
// instead of a suite-collection crash. topology/scoring/guns/explosion/biplane/scene/enemy
// and @arcade/shared DO exist — imported statically so the integration tests drive the REAL
// render substrate, collision windows, explosion sequence, scoring, and seeded PRNG.

import { describe, it, expect, beforeAll } from 'vitest'
import { multiply, translation, rotationZ, type Mat4 } from '@arcade/shared/math3d'
import { createRng, type Rng } from '@arcade/shared/rng'
import { renderModel } from '../../src/core/biplane'
import { sceneProjection } from '../../src/core/scene'
import { BLIMP_PICTURE, BLIMP_POINTS, DBLIMP } from '../../src/core/topology'
import { scoreKill, BLIMP_SCORE } from '../../src/core/scoring'
import { planeFires } from '../../src/core/enemy'
import { collides, type Shell } from '../../src/core/guns'
import { explode, stepWreck, type Wreck } from '../../src/core/explosion'
import type { Enemy } from '../../src/core/enemy'

// --- local mirror of the RED contract (kept out of the static import graph so the
//     file loads while src/core/blimp.ts does not yet exist) ---

interface Blimp {
  readonly x: number
  readonly y: number
  readonly depth: number
  readonly deltaX: number
  readonly bank: number
  readonly side: -1 | 1
  readonly active: boolean
}

interface BlimpModule {
  BLIMP_SPAWN_CHANCE?: number
  BLIMP_PLANE_GATE?: number
  shouldSpawnBlimp?: (planeCount: number, roll: number) => boolean
  spawn?: (rng: Rng, aspect: number) => Blimp
  step?: (blimp: Blimp) => Blimp
  blimpFires?: (frame: number, level: number) => boolean
}

let m: BlimpModule = {}

/**
 * rb4-1: `spawn` now takes the FRAME'S ASPECT as well as the Rng, and every call site in this
 * file passes it. That is a signature change, not a weakened test — the assertions below are
 * untouched, and they all still hold.
 *
 * Why it had to change: the blimp's entry position is a claim about the SCREEN ("enters near a
 * screen edge, drifts across"), and where a world x lands on screen depends on the depth it is
 * seen at AND on how wide the window is. Written as a bare world number it was correct only at
 * the cruise depth it happened to be fitted to — and when rb4-1 moved that depth, the airship
 * started entering near the middle of the screen and being deleted in plain view. The entry is
 * now denominated in the projected frame, so it needs the frame. See src/core/screen.ts and
 * tests/core/screen-scale.test.ts, which pins the behaviour this arity buys.
 *
 * A 16:9 reference frame, so the seeded expectations here are stable.
 */
const ASPECT = 16 / 9

beforeAll(async () => {
  try {
    // as unknown as: the source is mid-migration from the drifter's one-argument
    // shouldSpawnBlimp/blimpFires — a function-typed member is contravariant in its
    // parameters, so the old and TARGET signatures reconcile in neither direction
    // (TS2352, the rb4-7 lesson). The mirror still types every member; the runtime
    // need() + assertions do the real RED verification.
    m = (await import('../../src/core/blimp')) as unknown as BlimpModule
  } catch {
    m = {}
  }
})

/** Fail loud-and-clear when a contract export is missing (RED-friendly). */
function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`src/core/blimp.ts must export ${name} (rb2-10 RED contract)`)
  }
  return value
}

/** A fresh seeded blimp in the reference frame; a fixed seed keeps each test deterministic. */
const spawnAt = (seed = 1): Blimp => need(m.spawn, 'spawn')(createRng(seed), ASPECT)

/** Override Blimp fields while carrying whatever extra fields Dev adds (robust hand-build). */
const withBlimp = (overrides: Partial<Blimp>, seed = 1): Blimp => ({ ...spawnAt(seed), ...overrides })

/** Advance a blimp `n` calc frames, returning the per-frame trace of its motion. */
function trace(seed: number, n: number): { xs: number[]; deltas: number[]; depths: number[]; banks: number[] } {
  const step = need(m.step, 'step')
  let b = spawnAt(seed)
  const xs = [b.x]
  const deltas = [b.deltaX]
  const depths = [b.depth]
  const banks = [b.bank]
  for (let i = 0; i < n; i++) {
    b = step(b)
    xs.push(b.x)
    deltas.push(b.deltaX)
    depths.push(b.depth)
    banks.push(b.bank)
  }
  return { xs, deltas, depths, banks }
}

/**
 * Adapt a blimp's pose to the shared Enemy-shaped target that guns.collides / explosion.explode
 * consume (main.ts drives the blimp through the same kill pipeline). Only geometric fields matter
 * to those functions; the values under test (depth sign, x/y space, bank) all come from the blimp.
 */
const asTarget = (b: Blimp): Enemy => ({
  kind: 'lead',
  x: b.x,
  y: b.y,
  depth: b.depth,
  deltaX: b.deltaX,
  bank: b.bank,
  side: b.side,
  active: b.active,
  facingAway: true, // rb4-13 D4 mirror — matches blimpTarget: a cruising airship is settled
})

// ───────────────────────────────────────────────────────────────────────────
// AC-1 — the two-gate spawn: N.PLNZ >= 4, THEN the ~25 % roll (rb4-15, :2325-2331)
// (The full gate matrix — below-gate, at-gate, arg-order discriminators — lives in
// blimp-approach.test.ts; here the 25 % roll's SURVIVING contract is re-seated to
// the two-argument call with the plane gate held open.)
// ───────────────────────────────────────────────────────────────────────────
describe('blimp — the surviving ~25 % roll, behind the N.PLNZ gate (rb4-15)', () => {
  it('BLIMP_SPAWN_CHANCE is the 25 % ROM roll', () => {
    expect(need(m.BLIMP_SPAWN_CHANCE, 'BLIMP_SPAWN_CHANCE')).toBeCloseTo(0.25, 12)
  })

  it('is its OWN constant — the blimp roll is not silently aliased to the plane roll', () => {
    // enemy.LONE_PLANE_CHANCE is ALSO 0.25 but means "lone plane vs formation"; the blimp's
    // 25 % means "a blimp appears at all". They happen to share a value but are distinct rolls —
    // the blimp module must own its constant, not import the plane one. Pin that it exists here.
    expect(typeof need(m.BLIMP_SPAWN_CHANCE, 'BLIMP_SPAWN_CHANCE')).toBe('number')
    expect(need(m.BLIMP_SPAWN_CHANCE, 'BLIMP_SPAWN_CHANCE')).toBeGreaterThan(0)
    expect(need(m.BLIMP_SPAWN_CHANCE, 'BLIMP_SPAWN_CHANCE')).toBeLessThan(1)
  })

  it('with the plane gate OPEN, the roll fires strictly BELOW the chance — < 0.25, not ≤', () => {
    const gate = need(m.shouldSpawnBlimp, 'shouldSpawnBlimp')
    const chance = need(m.BLIMP_SPAWN_CHANCE, 'BLIMP_SPAWN_CHANCE')
    const OPEN = need(m.BLIMP_PLANE_GATE, 'BLIMP_PLANE_GATE') // four planes have appeared
    expect(gate(OPEN, 0)).toBe(true) // a roll of 0 spawns, once the sky has earned it
    expect(gate(OPEN, chance - 0.01)).toBe(true) // just inside the 25 % band
    expect(gate(OPEN, chance)).toBe(false) // strict boundary — exactly at the chance does NOT spawn
    expect(gate(OPEN, chance + 0.01)).toBe(false) // just outside
    expect(gate(OPEN, 0.99)).toBe(false) // the common case: no blimp
  })

  it('is TOTAL on a degenerate roll — NaN / negative / ≥1 never crash, and fail SAFE (no phantom spawn)', () => {
    const gate = need(m.shouldSpawnBlimp, 'shouldSpawnBlimp')
    const OPEN = need(m.BLIMP_PLANE_GATE, 'BLIMP_PLANE_GATE')
    expect(gate(OPEN, Number.NaN)).toBe(false) // a NaN roll must not conjure a blimp
    expect(gate(OPEN, Number.POSITIVE_INFINITY)).toBe(false)
    expect([true, false]).toContain(gate(OPEN, -1)) // a negative roll returns a real boolean, no throw
    expect([true, false]).toContain(gate(OPEN, 2))
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-2 — authentic BLIMP/DBLIMP geometry, drawn from the blimp's pose
// ───────────────────────────────────────────────────────────────────────────
describe('blimp — draws the authentic BLIMP/DBLIMP picture (findings §7, topology rb2-2)', () => {
  it('renders the real airship to finite NDC segments from a spawned blimp pose', () => {
    // Compose the render exactly as the cockpit will: model = translate(x,y,-depth) ∘ rotateZ(bank);
    // MVP = projection · model; walk the authentic DBLIMP list. This pins that the blimp's pose
    // places it IN FRONT of the eye (depth > 0 ⇒ world −Z) and produces real geometry from the
    // 36-vertex picture — a Dev who stored depth with the wrong sign, or wired a stand-in shape,
    // draws nothing. (The picture BYTES are byte-pinned in topology.test.ts; here we integrate.)
    const b = spawnAt(1)
    const proj = sceneProjection(1)
    const model: Mat4 = multiply(translation(b.x, b.y, -b.depth), rotationZ(b.bank))
    const mvp: Mat4 = multiply(proj, model)
    const segs = renderModel(BLIMP_PICTURE, mvp)
    expect(segs.length).toBeGreaterThan(0)
    for (const s of segs) {
      for (const v of [s.x1, s.y1, s.x2, s.y2]) expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('the picture the entity draws IS the authentic 36-vertex BLIMP with the DBLIMP connect-list', () => {
    // The entity must draw topology.ts's canonical airship, not a fabricated one. (Vertex/opcode
    // COUNTS and the gun-barrel bytes are asserted in topology.test.ts — this guards the wiring:
    // BLIMP_PICTURE is exactly the BLIMP_POINTS + DBLIMP pair the blimp renders.)
    expect(BLIMP_PICTURE.points).toBe(BLIMP_POINTS)
    expect(BLIMP_PICTURE.connect).toBe(DBLIMP)
    // every connect op indexes a REAL vertex — a blimp render can never dereference off the point-set
    for (const op of DBLIMP) {
      expect(op.point).toBeGreaterThanOrEqual(0)
      expect(op.point).toBeLessThan(BLIMP_POINTS.length)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-3 — APPROACHES (rb4-15): the depth CLOSES every calc-frame, it does not cruise
// (Re-seated from the drifter model. The full machine — entry 0x1000, close 0x80,
// cleared below 0x100, the 31-frame life — is pinned in blimp-approach.test.ts;
// this block keeps the entity-level facts the rest of this file leans on. The
// ROM's lateral BLOBJ+0C velocity is deliberately UNPINNED — see Design Deviations.)
// ───────────────────────────────────────────────────────────────────────────
describe('blimp — approaches (BLMOTN :4259-4265), NOT the constant-depth drifter', () => {
  it('the depth strictly DECREASES every calc-frame — an approach, never a cruise', () => {
    // THE load-bearing contrast with the machine this story deletes: the shipped blimp
    // held ONE depth for its whole life. The ROM's closes, every single frame.
    const { depths } = trace(7, 30) // 30 steps — the span the ROM keeps it alive
    for (let i = 1; i < depths.length; i++) {
      expect(depths[i], `calc-frame ${i}`).toBeLessThan(depths[i - 1])
    }
  })

  it('closes at ONE constant rate — the same Z delta every frame, no easing, no reversal', () => {
    const { depths } = trace(11, 30)
    const delta = depths[0] - depths[1]
    expect(delta).toBeGreaterThan(0)
    for (let i = 1; i < depths.length; i++) {
      expect(depths[i - 1] - depths[i], `calc-frame ${i}`).toBe(delta)
    }
  })

  it('stays at a positive, finite depth in front of the eye for its whole ROM life', () => {
    // 30 steps take 0x1000 down to exactly 0x100 — the last alive state. Everything the
    // reap will keep must be drawable: finite, in front of the eye.
    const { depths } = trace(7, 30)
    for (const d of depths) {
      expect(Number.isFinite(d)).toBe(true)
      expect(d).toBeGreaterThan(0)
    }
  })

  it('flies LEVEL — a Zeppelin does not bank into a turn (bank stays 0 through the approach)', () => {
    // Inferred (BLMOTN attitude not byte-transcribed): the airship has no roll. A genuine 0,
    // held across the run — 0 is a real bank, not an unset/falsy default (rule #4).
    const { banks } = trace(7, 30)
    for (const bk of banks) expect(bk).toBe(0)
  })

  it('is a pure, deterministic step — same blimp gives the same next frame, input untouched', () => {
    const step = need(m.step, 'step')
    const b = spawnAt(3)
    const snapshot = JSON.stringify(b)
    expect(step(b)).toEqual(step(b)) // deterministic
    expect(JSON.stringify(b)).toBe(snapshot) // no mutation of the input (readonly contract)
  })

  it('a blimp exactly AT the boresight (x = 0) still closes — 0 is a position, not a stop (rule #4)', () => {
    // The classic numeric-zero-is-falsy trap: x = 0 is a VALID coordinate dead ahead, not an
    // "unplaced" sentinel. Stepping it must still close the depth like any other state.
    const step = need(m.step, 'step')
    const b = withBlimp({ x: 0 })
    const next = step(b)
    expect(next.depth).toBeLessThan(b.depth) // the approach does not stall at centre
    expect(Number.isFinite(next.x)).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-4 — fires through the SHARED SHLAUN: ÷4 cadence, GMLEVL >= 2 (rb4-15)
// ───────────────────────────────────────────────────────────────────────────
describe('blimp — fires via SHLAUN (:4027-4041): 1 frame in 4, and only at GMLEVL >= 2', () => {
  /** Which of frames 0..n-1 the blimp fires on, at `level`. */
  const fireFrames = (n: number, level: number): number[] => {
    const fires = need(m.blimpFires, 'blimpFires')
    const out: number[] = []
    for (let f = 0; f < n; f++) if (fires(f, level)) out.push(f)
    return out
  }

  it('DOES fire at a firing level — it is a real threat, not an inert target', () => {
    expect(fireFrames(12, 2).length).toBeGreaterThan(0)
  })

  it('fires on the ÷4 cadence — LDA FRAME / AND I,3 ;1 OUT OF 4 FRAMES (:4027-4030)', () => {
    // A quarter of consecutive frames, never closer than 4 apart. The drifter's ÷2 —
    // borrowed from the plane's PLNSHL — fired twice as often as the machine.
    const elig = fireFrames(16, 2)
    expect(elig.length).toBe(4) // a quarter of 16 frames
    for (let i = 1; i < elig.length; i++) expect(elig[i] - elig[i - 1]).toBe(4)
  })

  it('the EARLY sky is quiet on both counts — below GMLEVL 2 the blimp holds fire, like the low-level plane', () => {
    // INVERTS the drifter's "threat at every level" (that reading is CONFIRMED FALSE — the
    // blimp's shells launch through SHLAUN, and :4038-4041 skips them below GMLEVL 2).
    // At level 2 the CONTRAST with the plane appears: planeFires is still level-gated shut
    // (level < 4 → never), while the blimp opens up — it menaces the MID sky first.
    const fires = need(m.blimpFires, 'blimpFires')
    for (let f = 0; f < 8; f++) {
      expect(fires(f, 0), `frame ${f}, level 0`).toBe(false)
      expect(fires(f, 1), `frame ${f}, level 1`).toBe(false)
      for (const rollValue of [0, 0.4, 0.9]) expect(planeFires(2, f, rollValue)).toBe(false)
    }
    expect(fireFrames(8, 2).length).toBeGreaterThan(0) // …but the blimp fires at level 2
  })

  it('is deterministic and TOTAL — frame 0 is a real frame, degenerate inputs never crash (rule #4)', () => {
    const fires = need(m.blimpFires, 'blimpFires')
    expect(fires(0, 2)).toBe(fires(0, 2)) // deterministic
    expect(typeof fires(0, 2)).toBe('boolean') // frame 0 is a genuine decision, not a falsy skip
    for (const f of [-1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(typeof fires(f, 2)).toBe('boolean') // total — a boolean for any frame, no throw
    }
    expect(fires(0, Number.NaN)).toBe(false) // a NaN level is not >= 2 — fails safe
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-5 — worth a flat 200 pts on kill (findings §4), through the REAL scoreKill
// ───────────────────────────────────────────────────────────────────────────
describe('blimp — the kill scores a flat 200 (findings §4), wired through scoring.ts', () => {
  it('scoreKill("blimp", depth) is BLIMP_SCORE = 200 at the blimp’s actual drift depth', () => {
    // The score half shipped in rb2-6; this drives the ENTITY's kill through it — wherever the
    // blimp has drifted to, the kill is worth exactly 200. (Flat: depth-independent.)
    expect(BLIMP_SCORE).toBe(200)
    for (const seed of [1, 7, 42]) {
      const b = spawnAt(seed)
      expect(scoreKill('blimp', b.depth)).toBe(200)
    }
  })

  it('is depth-INDEPENDENT — a blimp downed near or far is still exactly 200', () => {
    // The counterpoint to the depth-scaled lead: closing on the blimp earns no bonus.
    for (const depth of [1, 140, 500, 1080, 5000]) {
      expect(scoreKill('blimp', depth)).toBe(BLIMP_SCORE)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-6 — spawn integration: one motion object, deterministic, consumes the Rng
// ───────────────────────────────────────────────────────────────────────────
describe('blimp — spawn: a single motion object entering from a side (borrows a slot, §3)', () => {
  it('spawns ACTIVE, in front of the eye, entering from a random side', () => {
    for (const seed of [1, 2, 7, 42, 100]) {
      const b = spawnAt(seed)
      expect(b.active).toBe(true)
      expect(b.depth).toBeGreaterThan(0) // in front of the eye
      expect(b.side === -1 || b.side === 1).toBe(true)
      expect(Number.isFinite(b.x)).toBe(true)
      expect(Number.isFinite(b.y)).toBe(true)
    }
  })

  it('is deterministic per seed and varies placement across seeds (consumes the Rng)', () => {
    expect(spawnAt(5)).toEqual(spawnAt(5)) // same seed → identical blimp (pure, seeded)
    const many = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => spawnAt(s))
    // placement is randomized — across seeds, the entry X takes more than one value
    expect(new Set(many.map((b) => b.x)).size).toBeGreaterThan(1)
    // and both sides are reachable from the seed pool (not hard-wired to one edge)
    expect(new Set(many.map((b) => b.side)).size).toBe(2)
  })

  it('advances the Rng seed — spawn is not a no-op on the generator', () => {
    const rng = createRng(1234)
    const before = rng.seed
    need(m.spawn, 'spawn')(rng, ASPECT)
    expect(rng.seed).not.toBe(before)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-7 — collision / hit response: the blimp is a hittable target (rb2-5 seam)
// ───────────────────────────────────────────────────────────────────────────
describe('blimp — is a hittable target through the REAL CDSSET/SHCDCK window (guns.ts)', () => {
  it('a player shell placed on the blimp’s aim line registers a hit', () => {
    // guns.collides is the rotated min–max window rb2-5 built. Drive the blimp's pose through
    // it: some shell along the blimp's (x, y) at a range in [0, S.MAXZ] must fall inside the
    // window — the airship (a BIG target) is hittable when the player aims at it. Sweeping the
    // shell range avoids depending on the private depth→z projection while still using the REAL
    // collision function.
    const b = withBlimp({ x: 0, y: 0, depth: 200 }, 7) // parked near boresight, within gun reach
    const target = asTarget(b)
    let hit = false
    for (let z = 0; z <= 19; z += 0.25) {
      const shell: Shell = { x: b.x, y: b.y, z, gun: 'left', active: true }
      if (collides(shell, target)) hit = true
    }
    expect(hit).toBe(true)
  })

  it('a shell far off to the side never hits — the player must actually aim at it', () => {
    const b = withBlimp({ x: 0, y: 0, depth: 200 }, 7)
    const target = asTarget(b)
    let hit = false
    for (let z = 0; z <= 19; z += 0.25) {
      const shell: Shell = { x: b.x + 400, y: b.y, z, gun: 'right', active: true } // way off in X
      if (collides(shell, target)) hit = true
    }
    expect(hit).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-8 — explosion on kill matches the existing UPPLEX sequence (rb2-6 seam)
// ───────────────────────────────────────────────────────────────────────────
describe('blimp — a downed blimp runs the shared explosion sequence (explosion.ts)', () => {
  it('explode() spawns a falling wreck at the blimp’s exact pose', () => {
    const b = spawnAt(7)
    const wreck: Wreck = explode(asTarget(b))
    expect(wreck.x).toBe(b.x)
    expect(wreck.y).toBe(b.y)
    expect(wreck.depth).toBe(b.depth)
    expect(wreck.phase).toBe('falling') // enters the same UPPLEX sequence as a plane
  })

  it('the wreck runs falling → exploding → done, then goes quiet (idempotent)', () => {
    let wreck = explode(asTarget(spawnAt(7)))
    const phases = new Set<string>([wreck.phase])
    for (let i = 0; i < 40; i++) {
      wreck = stepWreck(wreck)
      phases.add(wreck.phase)
    }
    expect(phases.has('exploding')).toBe(true) // it burst into the PIECE0-3 debris window
    expect(wreck.phase).toBe('done') // …and finished the sequence
    expect(stepWreck(wreck)).toEqual(wreck) // 'done' is quiet — stepping it is idempotent
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Purity — no DOM / time / ambient randomness (module contract)
// ───────────────────────────────────────────────────────────────────────────
describe('blimp — pure & deterministic (the only randomness is the injected Rng)', () => {
  it('the full spawn → drift sequence is reproducible from the seed alone', () => {
    const runOnce = (): number[] => trace(2024, 60).xs
    expect(runOnce()).toEqual(runOnce()) // identical every time — no Date/Math.random leak
  })

  it('two independently-seeded blimps with the SAME seed drift identically', () => {
    const a = trace(11, 80)
    const b = trace(11, 80)
    expect(a.xs).toEqual(b.xs)
    expect(a.deltas).toEqual(b.deltas)
  })
})

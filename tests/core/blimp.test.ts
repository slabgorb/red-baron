// tests/core/blimp.test.ts
//
// Story rb2-10 — RED phase (Han Solo / TEA). The Blimp / Zeppelin: the ONE enemy
// the sky owes the player that ISN'T a weaving biplane. It rolls in on a ~25 %
// chance, DRIFTS steadily across the screen (it does NOT weave/reverse like the
// biplane window-follower), fires at the player, and is worth a flat 200 pts when
// gunned down — drawn with the authentic BLIMP/DBLIMP picture-ROM geometry.
// Grounded in findings §3 ("Blimp/Zeppelin — BLMOTN, R2BRON.MAC:4165+: ~25 % random
// spawn, drifts across, also fires at the player, worth 200 pts. There is no
// separate barrage balloon — the airship is the blimp. [ROM-verified]") and §4
// (blimp = 200 pts, flat).
//
// CONTRACT for the GREEN phase (Yoda / DEV): create `src/core/blimp.ts`, the pure
// blimp sim, exporting:
//
//   // --- ROM-exact data (findings §3, BLMOTN) ---
//   export const BLIMP_SPAWN_CHANCE: number   // ~25 % random spawn = 0.25 (findings §3).
//                                              // A SEPARATE roll from enemy.ts's 25 %
//                                              // LONE_PLANE_CHANCE (lone-vs-formation) —
//                                              // this one decides "a blimp appears at all".
//
//   export interface Blimp {
//     readonly x: number        // screen-window X — DRIFTS across centre (0), one direction
//     readonly y: number        // vertical offset — random at spawn
//     readonly depth: number    // Z in front of the eye (> 0); the airship cruises, drifts sideways
//     readonly deltaX: number   // drift velocity — CONSTANT SIGN (never reverses; not a weave)
//     readonly bank: number     // roll (radians): a Zeppelin flies LEVEL — 0 (inferred; see deviations)
//     readonly side: -1 | 1     // the screen side it entered from; it drifts toward the OTHER side
//     readonly active: boolean  // D7 "active" status bit
//   }
//
//   export function shouldSpawnBlimp(roll: number): boolean  // the ~25 % roll: roll < BLIMP_SPAWN_CHANCE
//   export function spawn(rng: Rng): Blimp                    // side entry, drifting across; consumes the Rng
//   export function step(blimp: Blimp): Blimp                 // one calc-frame of steady drift
//   export function blimpFires(frame: number): boolean        // ÷2 FRAME cadence; ALWAYS a threat (no level gate)
//
// WHY THIS SHAPE (cited — findings §3/§4, R2BRON.MAC):
//   * SPAWN ~25 % (BLMOTN): the blimp appears on a random roll, distinct from the score-
//     scaled plane waves. This is a SEPARATE 25 % from enemy.LONE_PLANE_CHANCE — the test
//     pins BLIMP_SPAWN_CHANCE in the blimp module and the strict `< 0.25` boundary.
//   * DRIFTS ACROSS, NOT A WEAVE: the biplane (enemy.ts) accelerates ΔX toward the window
//     limits and REVERSES at the bounds (ΔX takes both signs). The blimp does the OPPOSITE —
//     one steady drift with a CONSTANT-SIGN velocity, carrying it from its entry side across
//     centre to the far side. This is the load-bearing behavioural contrast, tested directly.
//   * ALSO FIRES AT THE PLAYER: unlike the early-game sky where a plane's "@ PLAYER" bit is
//     level-gated (planeFires level < 4 → never), the blimp is a threat whenever it is present.
//     `blimpFires(frame)` takes NO level and fires on the established ÷2 FRAME cadence (findings
//     §3, PLNSHL). The ÷2 phase and the no-level-gate reading are inferred (BLMOTN's fire detail
//     is not byte-transcribed) — tested behaviourally + logged as deviations/findings.
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
  shouldSpawnBlimp?: (roll: number) => boolean
  spawn?: (rng: Rng) => Blimp
  step?: (blimp: Blimp) => Blimp
  blimpFires?: (frame: number) => boolean
}

let m: BlimpModule = {}

beforeAll(async () => {
  try {
    m = (await import('../../src/core/blimp')) as BlimpModule
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

/** A fresh seeded blimp; a fixed seed keeps each test deterministic. */
const spawnAt = (seed = 1): Blimp => need(m.spawn, 'spawn')(createRng(seed))

/** Override Blimp fields while carrying whatever extra fields Dev adds (robust hand-build). */
const withBlimp = (overrides: Partial<Blimp>, seed = 1): Blimp => ({ ...spawnAt(seed), ...overrides })

/** Advance a blimp `n` calc frames, returning the per-frame trace of the drift. */
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
})

// ───────────────────────────────────────────────────────────────────────────
// AC-1 — the ~25 % random spawn roll (findings §3, BLMOTN)
// ───────────────────────────────────────────────────────────────────────────
describe('blimp — ~25 % random spawn roll (findings §3, BLMOTN)', () => {
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

  it('shouldSpawnBlimp fires strictly BELOW the chance — the boundary is < 0.25, not ≤', () => {
    const roll = need(m.shouldSpawnBlimp, 'shouldSpawnBlimp')
    const chance = need(m.BLIMP_SPAWN_CHANCE, 'BLIMP_SPAWN_CHANCE')
    expect(roll(0)).toBe(true) // a roll of 0 always spawns
    expect(roll(chance - 0.01)).toBe(true) // just inside the 25 % band
    expect(roll(chance)).toBe(false) // strict boundary — exactly at the chance does NOT spawn
    expect(roll(chance + 0.01)).toBe(false) // just outside
    expect(roll(0.99)).toBe(false) // the common case: no blimp
  })

  it('is TOTAL on a degenerate roll — NaN / negative / ≥1 never crash, and fail SAFE (no phantom spawn)', () => {
    const roll = need(m.shouldSpawnBlimp, 'shouldSpawnBlimp')
    expect(roll(Number.NaN)).toBe(false) // a NaN roll must not conjure a blimp
    expect(roll(Number.POSITIVE_INFINITY)).toBe(false)
    expect([true, false]).toContain(roll(-1)) // a negative roll returns a real boolean, no throw
    expect([true, false]).toContain(roll(2))
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
// AC-3 — DRIFTS across the screen: steady one-way motion, NOT a weave
// ───────────────────────────────────────────────────────────────────────────
describe('blimp — drifts across (BLMOTN), NOT the biplane weave', () => {
  it('drifts with a CONSTANT-SIGN velocity — it never reverses like the window-follower', () => {
    // THE load-bearing contrast with enemy.step (whose ΔX takes BOTH signs as it weaves): the
    // blimp holds ONE drift direction the whole time. Collect the ΔX over a long run — every
    // sample must share the spawn's sign, and none may be zero (a stalled blimp isn't drifting).
    const { deltas } = trace(7, 400)
    const s = Math.sign(deltas[0])
    expect(s).not.toBe(0) // it is actually moving at spawn
    for (const d of deltas) {
      expect(Math.sign(d)).toBe(s) // same direction forever — no reversal
    }
  })

  it('drifts AWAY from its entry side — inward across centre, not off the edge it came from', () => {
    // Entering from the right (side +1) it must drift LEFT (ΔX < 0) toward and past centre;
    // entering from the left, the mirror. A blimp that drifted back off its own edge would
    // never cross the player's view.
    for (const seed of [1, 2, 7, 42, 100]) {
      const b = spawnAt(seed)
      expect(b.side === -1 || b.side === 1).toBe(true)
      expect(Math.sign(b.x)).toBe(b.side) // enters on its side
      expect(Math.sign(b.deltaX)).toBe(-b.side) // …and drifts toward the OTHER side
    }
  })

  it('actually crosses the screen — from its entry side, through centre, to the FAR side', () => {
    // Run long enough for the observed drift to carry it across (adaptive to Dev's tuning:
    // frames ≈ 2·|x0| / |ΔX|, plus margin — robust whether the drift is fast or slow).
    const step = need(m.step, 'step')
    for (const seed of [1, 7, 42]) {
      const b0 = spawnAt(seed)
      const framesToCross = Math.ceil((2 * Math.abs(b0.x)) / Math.max(1e-9, Math.abs(b0.deltaX))) + 10
      let b = b0
      let crossedCentre = false
      for (let i = 0; i < framesToCross * 2; i++) {
        b = step(b)
        if (Math.sign(b.x) === -b0.side) crossedCentre = true
      }
      expect(crossedCentre).toBe(true) // reached the far side — a genuine drift ACROSS
    }
  })

  it('x moves MONOTONICALLY in the drift direction — no back-and-forth', () => {
    // Constant-sign velocity ⇒ x is monotone. A weave would fail this immediately.
    const { xs } = trace(7, 200)
    const dir = Math.sign(xs[1] - xs[0])
    expect(dir).not.toBe(0)
    for (let i = 1; i < xs.length; i++) {
      expect(Math.sign(xs[i] - xs[i - 1]) === dir || xs[i] === xs[i - 1]).toBe(true)
    }
  })

  it('cruises at a positive, finite depth in front of the eye for the whole drift', () => {
    // The airship drifts SIDEWAYS; whatever the depth model, it must never go NaN or behind the
    // eye (depth ≤ 0), which would invert the render and break collision projection.
    const { depths } = trace(7, 400)
    for (const d of depths) {
      expect(Number.isFinite(d)).toBe(true)
      expect(d).toBeGreaterThan(0)
    }
  })

  it('flies LEVEL — a Zeppelin does not bank into a turn (bank stays 0 through the drift)', () => {
    // Inferred (BLMOTN attitude not byte-transcribed): the airship has no roll. A genuine 0,
    // held across the run — 0 is a real bank, not an unset/falsy default (rule #4).
    const { banks } = trace(7, 200)
    for (const bk of banks) expect(bk).toBe(0)
  })

  it('is a pure, deterministic step — same blimp gives the same next frame, input untouched', () => {
    const step = need(m.step, 'step')
    const b = spawnAt(3)
    const snapshot = JSON.stringify(b)
    expect(step(b)).toEqual(step(b)) // deterministic
    expect(JSON.stringify(b)).toBe(snapshot) // no mutation of the input (readonly contract)
  })

  it('a blimp exactly AT centre (x = 0) keeps drifting through — 0 is a position, not a stop (rule #4)', () => {
    // The classic numeric-zero-is-falsy trap: x = 0 is a VALID coordinate mid-crossing, not an
    // "unplaced" sentinel. Stepping a blimp sitting at centre must carry it off centre by ΔX.
    const step = need(m.step, 'step')
    const b = withBlimp({ x: 0 })
    const next = step(b)
    expect(next.x).not.toBe(0) // it moved through centre
    expect(Math.sign(next.x)).toBe(Math.sign(b.deltaX)) // …in the drift direction
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-4 — fires at the player (findings §3: "also fires at the player")
// ───────────────────────────────────────────────────────────────────────────
describe('blimp — fires at the player (BLMOTN), on the ÷2 cadence, always a threat', () => {
  /** Which of frames 0..n-1 the blimp fires on. */
  const fireFrames = (n: number): number[] => {
    const fires = need(m.blimpFires, 'blimpFires')
    const out: number[] = []
    for (let f = 0; f < n; f++) if (fires(f)) out.push(f)
    return out
  }

  it('DOES fire — it is a real threat, not an inert drifter', () => {
    // The whole point of the blimp over a barrage balloon: it shoots. At least some frame fires.
    expect(fireFrames(12).length).toBeGreaterThan(0)
  })

  it('fires on the ÷2 cadence — half of consecutive frames, never two in a row (findings §3, PLNSHL)', () => {
    const elig = fireFrames(10)
    expect(elig.length).toBe(5) // half of 10 frames
    for (let i = 1; i < elig.length; i++) expect(elig[i] - elig[i - 1]).toBeGreaterThanOrEqual(2)
  })

  it('is a threat REGARDLESS of level — unlike a low-level plane, which never shoots back', () => {
    // findings §3: a plane's "@ PLAYER" bit is level-gated (level < 4 → planeFires never true).
    // The blimp is "also fires at the player" with NO such gate — it menaces the early sky the
    // planes leave quiet. Contrast the REAL planeFires against the blimp on the same frames.
    const fires = need(m.blimpFires, 'blimpFires')
    let blimpEverFires = false
    for (let f = 0; f < 8; f++) {
      // a level-0 plane never fires on any frame or roll…
      for (const rollValue of [0, 0.4, 0.9]) expect(planeFires(0, f, rollValue)).toBe(false)
      if (fires(f)) blimpEverFires = true
    }
    expect(blimpEverFires).toBe(true) // …but the blimp does, at level 0
  })

  it('is deterministic and TOTAL — frame 0 is a real frame, degenerate frames never crash (rule #4)', () => {
    const fires = need(m.blimpFires, 'blimpFires')
    expect(fires(0)).toBe(fires(0)) // deterministic
    expect(typeof fires(0)).toBe('boolean') // frame 0 is a genuine decision, not a falsy skip
    for (const f of [-1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(typeof fires(f)).toBe('boolean') // total — a boolean for any frame, no throw
    }
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
    need(m.spawn, 'spawn')(rng)
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

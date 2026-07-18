// tests/core/landscape.test.ts
//
// Story rb3-3 — RED phase (Furiosa / TEA). The SIM + RENDER half of the scrolling
// landscape: up to 4 PFOBJ mountain slots that scroll toward the player and "fall"
// from the horizon (PFOBMN, RBARON.MAC:3264-3430), stroked as glowing vectors
// THROUGH the existing rb1 scene substrate (scene.ts / camera.ts) — NO new renderer.
//
// CONTRACT for the GREEN phase (The Word Burgers / DEV): create
// `src/core/landscape.ts`, the pure mountain-slot sim + render, exporting:
//
//   // --- ROM-anchored constants (RBARON.MAC:441-455, .RADIX 16 / HEX) ---
//   export const MAX_MOUNTAINS: number   // = 4. N.PFOB = 3*L.PFOB → 4 PF-object slots.
//   export const SPAWN_DEPTH: number     // horizon spawn/recycle depth. On or beyond the
//                                        //   horizon: SPAWN_DEPTH >= HORZ ($1000). NOT HORIZN.
//   export const MIN_DEPTH: number       // near-plane recycle threshold: 0 < MIN_DEPTH < HORZ.
//
//   export interface Mountain {
//     readonly scape: number     // which SCAPE silhouette (0-3), indexes topology.SCAPES
//     readonly depth: number     // Z distance in front of the eye; SPAWN_DEPTH on the
//                                //   horizon, DECREASES each calc-frame toward the player
//     readonly x: number         // lateral world offset (PFOBJ+0/+1 X scroll)
//     readonly active: boolean   // occupies a slot / is drawn
//   }
//
//   export function spawnMountain(scape: number): Mountain          // one mountain, on the horizon
//   export function initialMountains(): readonly Mountain[]         // the ≤4-slot opening fill
//   export function stepMountain(m: Mountain, playerDX: number): Mountain  // one calc-frame
//
// rb4-8 RE-SEAT: stepMountain now takes the per-frame player delta (PLYRDL); calls below
// pass 0 where lateral scroll is not under test. The old `onHorizon(m)` DEPTH predicate is
// SUPERSEDED by a latched status bit — its contract (and the lateral scroll + wrap) now
// live in tests/core/mountain-scroll.test.ts; the depth/slot/recycle/render guards stay here.
//   export function mountainSegments(                               // project via the rb1 substrate
//     mountains: readonly Mountain[], attitude: Attitude, eye: Vec3, aspect: number,
//   ): readonly SceneSegment[]
//
// WHY THIS SHAPE (cited — findings §4/§8, RBARON.MAC:3264-3430 PFOBMN):
//   * 4 SLOTS. N.PFOB=3*L.PFOB names four PF-object records (RBARON.MAC:245/441).
//   * DEPTH DECREASES toward the eye. On the horizon branch subtracts P.OBDZ each
//     frame (RBARON.MAC:3378-3391); the fallen branch subtracts a delta too
//     (:3336-3348). Depth counts DOWN — the mountain approaches.
//   * "FALL FROM THE HORIZON" = depth crossing the horizon threshold. While
//     depth >= P.MAXZ ($1001 = HORZ+1) it is "on the horizon" (a far silhouette);
//     when depth drops below it, PFOBMN "START[s] PF OBJECT 'FALL'" (:3394-3397).
//     This is a DEPTH event — NOTHING to do with HORIZN=$40, which RBARON.MAC:455
//     calls the "HORIZON OFFSET (Y AXIS)", a post-divide SCREEN offset.
//   * RECYCLE. Near the eye (depth < $0C0 minimum, :3349) the object resets to the
//     initial horizon depth (P.OBZI/PF.XZ, :3356-3364) — the pass is continuous, so
//     the four slots wrap back to the horizon rather than vanishing.
//   * DIVIDE-BY-DEPTH. Mountains are 2-D playfield objects given depth by the SAME
//     perspective divide as the biplanes (findings §8) — a nearer mountain projects
//     WIDER. The render reuses scene.projectSegment; it does not re-implement it.
//
// NOTE (deviation logged): the exact per-frame scroll delta is a display-tuning
// parameter, not a clean ported constant (ROM P.OBDZ/$180 and #$20 are in raw ROM
// Z-counter units; the port's Z is in scene world units like enemy P_INDP=1080).
// These tests pin the DIRECTION and the divide-by-depth RELATIONSHIP, not a magnitude.

import { describe, it, expect } from 'vitest'
import { LEVEL } from '../../src/core/camera'
import type { SceneSegment } from '../../src/core/scene'
import { HORZ, HORIZN } from '../../src/core/topology'
import type { Vec3 } from '@arcade/shared/math3d'
import {
  MAX_MOUNTAINS,
  SPAWN_DEPTH,
  MIN_DEPTH,
  type Mountain,
  spawnMountain,
  initialMountains,
  stepMountain,
  mountainSegments,
} from '../../src/core/landscape'

const EYE: Vec3 = [0, 0, 0]

// Step a mountain n calc-frames.
const steps = (m: Mountain, n: number): Mountain => {
  let out = m
  for (let i = 0; i < n; i++) out = stepMountain(out, 0)
  return out
}

// Horizontal NDC extent (max x − min x) across every endpoint of a segment list.
const ndcWidth = (segs: readonly SceneSegment[]): number => {
  const xs = segs.flatMap((s) => [s.x1, s.x2])
  return xs.length ? Math.max(...xs) - Math.min(...xs) : 0
}

describe('rb3-3 mountain slots — up to 4 PFOBJ objects (N.PFOB)', () => {
  it('MAX_MOUNTAINS is exactly 4 (N.PFOB = 3*L.PFOB → four slots)', () => {
    expect(MAX_MOUNTAINS).toBe(4)
  })

  it('initialMountains never exceeds the 4-slot budget and every slot is active', () => {
    const fleet = initialMountains()
    expect(fleet.length).toBeGreaterThan(0)
    expect(fleet.length).toBeLessThanOrEqual(MAX_MOUNTAINS)
    for (const m of fleet) expect(m.active).toBe(true)
  })

  it('the slot count is invariant under a full calc-frame step (no growth past 4)', () => {
    const fleet = initialMountains()
    const stepped = fleet.map((m) => stepMountain(m, 0))
    expect(stepped.length).toBe(fleet.length)
    expect(stepped.length).toBeLessThanOrEqual(MAX_MOUNTAINS)
  })
})

describe('rb3-3 spawn depth — on the horizon, keyed to HORZ not HORIZN', () => {
  it('SPAWN_DEPTH sits on or beyond the horizon depth (>= HORZ = $1000)', () => {
    expect(SPAWN_DEPTH).toBeGreaterThanOrEqual(HORZ)
  })

  it('SPAWN_DEPTH is NOT the HORIZN screen offset ($40) — the classic conflation', () => {
    expect(SPAWN_DEPTH).not.toBe(HORIZN)
    expect(SPAWN_DEPTH).not.toBe(64)
  })

  it('MIN_DEPTH is a positive near-plane threshold below the horizon (0 < MIN_DEPTH < HORZ)', () => {
    expect(MIN_DEPTH).toBeGreaterThan(0)
    expect(MIN_DEPTH).toBeLessThan(HORZ)
  })

  it('a freshly spawned mountain starts at SPAWN_DEPTH, active, and on the horizon (by depth)', () => {
    const m = spawnMountain(2)
    expect(m.scape).toBe(2)
    expect(m.depth).toBe(SPAWN_DEPTH)
    expect(m.active).toBe(true)
    expect(m.depth).toBeGreaterThanOrEqual(HORZ) // spawns on the horizon; the latched bit is pinned in mountain-scroll.test.ts
  })
})

describe('rb3-3 scroll + fall — depth decreases toward the player (PFOBMN)', () => {
  it('stepMountain strictly DECREASES depth (the mountain approaches the eye)', () => {
    const m = spawnMountain(0)
    const next = stepMountain(m, 0)
    expect(next.depth).toBeLessThan(m.depth)
  })

  it('never yields a NaN / undefined depth (totality — no divide/subtract leak)', () => {
    const m = steps(spawnMountain(1), 50)
    expect(Number.isFinite(m.depth)).toBe(true)
  })

  // rb4-8 SUPERSEDES rb3-3's "on the horizon is a live `depth >= HORZ` predicate" test:
  // the on-horizon state is now a LATCHED status bit with hysteresis, and its transitions
  // (fall at P.MAXZ, re-latch at recycle) are pinned in tests/core/mountain-scroll.test.ts.

  it('a stepped mountain eventually leaves the horizon (depth falls below HORZ)', () => {
    let m = spawnMountain(0)
    let left = false
    let prev = m.depth
    for (let i = 0; i < 10000; i++) {
      m = stepMountain(m, 0)
      if (m.depth > prev) break // recycled back before we could observe the fall
      if (m.depth < HORZ) {
        left = true
        break
      }
      prev = m.depth
    }
    expect(left).toBe(true)
  })

  it('RECYCLES back to the horizon instead of vanishing — a slot reaching the near plane wraps', () => {
    // Drive a mountain all the way in; it must never drop to/through zero and disappear —
    // it resets to SPAWN_DEPTH (RBARON.MAC:3356-3364) and stays active for a continuous pass.
    let m = spawnMountain(3)
    let recycled = false
    let prev = m.depth
    for (let i = 0; i < 10000; i++) {
      m = stepMountain(m, 0)
      if (m.depth > prev) {
        recycled = true // depth jumped UP → wrapped back to the horizon
        expect(m.depth).toBe(SPAWN_DEPTH)
        break
      }
      prev = m.depth
    }
    expect(recycled).toBe(true)
    expect(m.active).toBe(true)
  })
})

describe('rb3-3 render — through the rb1 scene substrate, divide-by-depth (findings §8)', () => {
  it('renders nothing when there are no active mountains', () => {
    expect(mountainSegments([], LEVEL, EYE, 1)).toEqual([])
    const dormant: Mountain = { ...spawnMountain(0), active: false }
    expect(mountainSegments([dormant], LEVEL, EYE, 1)).toEqual([])
  })

  it('projects an active mountain to a non-empty set of finite NDC segments', () => {
    // Place it in front of the eye, already fallen off the horizon so it is on-screen.
    const m: Mountain = { scape: 0, depth: 400, x: 0, active: true, onHorizon: false }
    const segs = mountainSegments([m], LEVEL, EYE, 1)
    expect(segs.length).toBeGreaterThan(0)
    for (const s of segs) {
      // Totality: projectSegment's behind-eye nulls must be FILTERED, never leaked.
      expect(s).not.toBeNull()
      expect(Number.isFinite(s.x1) && Number.isFinite(s.y1)).toBe(true)
      expect(Number.isFinite(s.x2) && Number.isFinite(s.y2)).toBe(true)
    }
  })

  it('divide-by-depth: a NEARER mountain projects WIDER than the same silhouette farther away', () => {
    const near: Mountain = { scape: 0, depth: 300, x: 0, active: true, onHorizon: false }
    const far: Mountain = { scape: 0, depth: 1200, x: 0, active: true, onHorizon: false }
    const wNear = ndcWidth(mountainSegments([near], LEVEL, EYE, 1))
    const wFar = ndcWidth(mountainSegments([far], LEVEL, EYE, 1))
    expect(wNear).toBeGreaterThan(wFar)
  })
})

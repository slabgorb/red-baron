// tests/core/scene.test.ts
//
// Story rb1-3 — RED phase (Furiosa / TEA). The pure world → NDC vector substrate.
//
// CONTRACT for GREEN (DEV): create `src/core/scene.ts` — the render substrate the
// horizon and (later) terrain/enemies are stroked through. Projection stays in
// CORE; the shell only maps NDC → pixels and paints (epic ruling, mirrored from
// battlezone/src/core/scene.ts). Export:
//
//   export interface SceneSegment {          // one projected edge, NDC space
//     readonly x1: number; readonly y1: number
//     readonly x2: number; readonly y2: number
//   }
//   export function sceneProjection(aspect: number): Mat4   // the perspective matrix
//   export function projectSegment(a: Vec3, b: Vec3, mvp: Mat4): SceneSegment | null
//
// NDC CONVENTION (math3d header + battlezone): the visible square is [-1,1];
// +x is screen-right, +y is screen-up, the camera looks down −Z. The shell later
// maps NDC → pixels (y-flip) — that pixel step is NOT tested here (it is the only
// thing the DOM-touching shell owns).
//
// BEHIND-EYE CULL (findings §8 "divide-by-depth"; battlezone's ROM cull): a
// perspective divide mirrors points behind the camera back INTO view with a
// flipped sign. A faithful projector drops a segment whose endpoints are behind
// the eye (w ≤ 0) → returns null, rather than stroking a ghost.
//
// SCOPE: rb1-3 ships the SUBSTRATE + the tilting horizon (horizon.test.ts). The
// authentic ground-wave terrain data — the SCAPE0..3 mountain silhouettes
// (findings §4/§7) — is rb2's ground wave, NOT foundation. This suite proves the
// substrate carries arbitrary world geometry to NDC; it ships no mountain data.

import { describe, it, expect, beforeAll } from 'vitest'
import type { Mat4, Vec3 } from '@arcade/shared/math3d'

interface SceneSegment {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

interface SceneModule {
  sceneProjection?: (aspect: number) => Mat4
  projectSegment?: (a: Vec3, b: Vec3, mvp: Mat4) => SceneSegment | null
  projectWorldSegment?: (a: Vec3, b: Vec3, mvp: Mat4) => SceneSegment | null
}

let scene: SceneModule = {}

beforeAll(async () => {
  try {
    scene = (await import('../../src/core/scene')) as SceneModule
  } catch {
    scene = {}
  }
})

function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`src/core/scene.ts must export ${name} (rb1-3 RED contract)`)
  }
  return value
}

const ASPECT = 16 / 9

describe('scene — sceneProjection (the one perspective matrix)', () => {
  it('returns a valid length-16, all-finite Mat4', () => {
    const p = need(scene.sceneProjection, 'sceneProjection')(ASPECT)
    expect(p.length).toBe(16)
    for (const v of p) expect(Number.isFinite(v)).toBe(true)
  })
})

describe('scene — projectSegment (world → NDC substrate)', () => {
  it('the bare projectSegment is the PURE divide — an on-axis point lands on raw centre, NO HORIZN lift (rb4-5)', () => {
    // rb4-5 rework: HORIZN is NOT on the universal substrate — the ROM adds it only in POSITH
    // (the playfield path), never in the PLANE PROJECT path (RBGRND.MAC:359). So the bare
    // projectSegment that motion objects use is the pure divide, matching the frustum screen.ts
    // measures (rb4-1). An on-axis (world Y=0) point straight ahead projects to raw centre 0.
    const proj = need(scene.sceneProjection, 'sceneProjection')(ASPECT)
    const seg = need(scene.projectSegment, 'projectSegment')([0, 0, -400], [0, 0, -800], proj)
    expect(seg).not.toBeNull()
    if (seg) {
      expect(seg.x1).toBeCloseTo(0, 5)
      expect(seg.x2).toBeCloseTo(0, 5)
      expect(seg.y1).toBeCloseTo(0, 5) // pure divide — no offset
      expect(seg.y2).toBeCloseTo(0, 5)
    }
  })

  it('projectWorldSegment lifts an on-axis PLAYFIELD segment by the constant HORIZN offset (rb4-5 AC5, POSITH path)', () => {
    const proj = need(scene.sceneProjection, 'sceneProjection')(ASPECT)
    const near = need(scene.projectWorldSegment, 'projectWorldSegment')([0, 0, -400], [0, 0, -800], proj)
    const far = need(scene.projectWorldSegment, 'projectWorldSegment')([0, 0, -3000], [0, 0, -6000], proj)
    expect(near).not.toBeNull()
    expect(far).not.toBeNull()
    if (near && far) {
      expect(near.x1).toBeCloseTo(0, 5) // still on the horizontal centre line
      expect(near.x2).toBeCloseTo(0, 5)
      // rb4-5 AC5: HORIZN is added to every PLAYFIELD-object Y — a constant, depth-INDEPENDENT
      // lift, so both endpoints share one Y, the two depths share it too, and it is NOT the raw
      // centre 0. (POSITH's `ADC I,HORIZN` after the divide, RBGRND.MAC:303.)
      expect(near.y1).toBeCloseTo(near.y2, 5)
      expect(near.y1).toBeCloseTo(far.y1, 5) // depth-independent — an offset, not a ÷depth
      expect(Math.abs(near.y1)).toBeGreaterThan(1e-3)
    }
  })

  it('a ground segment below the eye lands in the LOWER half of the view (NDC y < 0)', () => {
    const proj = need(scene.sceneProjection, 'sceneProjection')(ASPECT)
    const seg = need(scene.projectSegment, 'projectSegment')([-20, -60, -400], [20, -60, -400], proj)
    expect(seg).not.toBeNull()
    if (seg) {
      expect(seg.y1).toBeLessThan(0) // below the horizon — you are flying OVER it
      expect(seg.y2).toBeLessThan(0)
      expect(seg.x1).toBeLessThan(seg.x2) // world −x…+x spans NDC left…right
      expect(Number.isFinite(seg.x1)).toBe(true)
      expect(Number.isFinite(seg.y2)).toBe(true)
    }
  })

  it('a segment above the eye lands in the UPPER half (NDC y > 0) — sky vs ground split', () => {
    const proj = need(scene.sceneProjection, 'sceneProjection')(ASPECT)
    const seg = need(scene.projectSegment, 'projectSegment')([-20, 60, -400], [20, 60, -400], proj)
    expect(seg).not.toBeNull()
    if (seg) {
      expect(seg.y1).toBeGreaterThan(0)
      expect(seg.y2).toBeGreaterThan(0)
    }
  })

  it('drops a segment entirely BEHIND the eye (returns null — no perspective-mirror ghost)', () => {
    const proj = need(scene.sceneProjection, 'sceneProjection')(ASPECT)
    // Camera looks down −Z, so +z is behind it. A naive divide would mirror these
    // into the forward view with flipped signs; the substrate must return null.
    const seg = need(scene.projectSegment, 'projectSegment')([0, 0, 20], [0, 0, 80], proj)
    expect(seg).toBeNull()
  })
})

// tests/core/intensity.test.ts
//
// Story rb4-9 — RED phase (Furiosa / TEA). AC-3: the depth-cued INTENSITY channel.
//
// TODAY the whole world is stroked in one flat green (main.ts:163 `ctx.strokeStyle`,
// a single colour for every vector). The AVG hardware carries a per-vector intensity
// and the ROM drives it from DEPTH, and draws the plane in TWO tiers.
//
// CONTRACT for GREEN (DEV):
//
//   1. SceneSegment carries an intensity channel:
//        export interface SceneSegment { …; readonly intensity: number }
//
//   2. The projector STAMPS it — a fourth, optional argument, so the one projector
//      every producer already funnels through can carry a per-object brightness:
//        projectSegment(a, b, mvp, intensity?): SceneSegment | null
//        projectWorldSegment(a, b, mvp, intensity?): SceneSegment | null
//      (default = full bright, so existing callers keep drawing.)
//
//   3. A depth → intensity map, mirroring `;INTENSITY SET TO DEPTH`:
//        export function depthIntensity(depth: number): number
//
//   4. renderModel draws the plane in two tiers — the airframe at the object's
//      brightness, the wing struts 0x60 DIMMER (`;ADD LIGHTER LINES`):
//        renderModel(model, mvp, brightness): readonly SceneSegment[]
//
// ROM GROUNDING (RBARON.MAC, `.RADIX 16`):
//   • V.BRIT is the vector intensity (:121 `;VCTR INTENSITY (IN DECMAP)`).
//   • It is SET FROM DEPTH: :4550-4557 masks the depth-derived value `AND I,0F0`
//     (top nibble → steps of 0x10) and computes `.PFOBJ − V.BRIT`, so a NEARER
//     object is BRIGHTER. Range is a byte masked to 0x00..0xF0.
//   • PLDECD (:5020-5034): decode the airframe (DB.MAP→DB.MAR) at `V.BRIT`, then
//     `LDA V.BRIT / SEC / SBC I,60 / BCS 10$ / LDA I,0` — the struts (DB.LNS) at
//     `max(0, V.BRIT − 0x60)`. The 0x60 gap is exact.

import { describe, it, expect, beforeAll } from 'vitest'
import { sceneProjection, projectSegment, type SceneSegment } from '../../src/core/scene'
import * as biplane from '../../src/core/biplane'
import { DB_LNS, type ConnectOp } from '../../src/core/topology'
import { multiply, translation, type Mat4, type Vec3 } from '@arcade/shared/math3d'

// Loosely-typed views of the seams DEV is about to widen, so this file typechecks against
// TODAY's narrower signatures while asserting TOMORROW's behaviour at runtime.
const project = projectSegment as (a: Vec3, b: Vec3, mvp: Mat4, intensity?: number) => SceneSegment | null
const renderModel = biplane.renderModel as (
  m: biplane.BiplaneModel, mvp: Mat4, brightness?: number,
) => readonly SceneSegment[]
const intensityOf = (seg: SceneSegment): number | undefined => (seg as { intensity?: number }).intensity

interface SceneExtra { depthIntensity?: (depth: number) => number }
let depthIntensity: ((depth: number) => number) | undefined
beforeAll(async () => {
  depthIntensity = ((await import('../../src/core/scene')) as SceneExtra).depthIntensity
})
function needFn<T>(v: T | undefined, name: string): T {
  if (v === undefined) throw new Error(`src/core/scene.ts must export ${name} (rb4-9 RED contract)`)
  return v
}

const PROJ = sceneProjection(1)
const mvpAt = (tz: number): Mat4 => multiply(PROJ, translation(0, 0, tz))
const FRONT: Vec3 = [0, 0, -600]
const BACK: Vec3 = [40, 0, -600]
/** DB.LNS "lighter lines" drawn-segment count — computed from the transcription, not hard-coded. */
const strutSegments = (connect: readonly ConnectOp[]): number => {
  let n = 0, prev = false
  for (const op of connect) { if (op.draw && prev) n += 1; prev = true }
  return n
}

describe('rb4-9 AC-3 — SceneSegment carries an intensity the projector stamps', () => {
  it('a projected segment has a numeric intensity channel', () => {
    const seg = project(FRONT, BACK, mvpAt(0))
    expect(seg, 'a segment in front of the eye must project').not.toBeNull()
    expect(typeof intensityOf(seg!), 'SceneSegment.intensity is missing — the world is still flat green').toBe('number')
  })

  it('stamps the intensity it is handed (per-object brightness threads through the one projector)', () => {
    const dim = project(FRONT, BACK, mvpAt(0), 0x40)
    const bright = project(FRONT, BACK, mvpAt(0), 0xf0)
    expect(intensityOf(dim!)).toBe(0x40)
    expect(intensityOf(bright!)).toBe(0xf0)
  })
})

describe('rb4-9 AC-3 — depthIntensity: nearer is brighter (INTENSITY SET TO DEPTH)', () => {
  it('is monotonic — a nearer object is at least as bright, and strictly brighter across range', () => {
    const f = needFn(depthIntensity, 'depthIntensity')
    const near = f(0x200)
    const mid = f(0x1000)
    const far = f(0x4000)
    expect(near).toBeGreaterThanOrEqual(mid)
    expect(mid).toBeGreaterThanOrEqual(far)
    expect(near, 'the map must actually vary with depth, not return a constant').toBeGreaterThan(far)
  })

  it('is quantized to the AVG steps and clamped to the byte window [0, 0xF0]', () => {
    const f = needFn(depthIntensity, 'depthIntensity')
    for (const d of [0, 0x100, 0x800, 0x2000, 0x7f00, 0x100000]) {
      const v = f(d)
      expect(v, `depthIntensity(${d})`).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(0xf0)
      expect(v % 0x10, `depthIntensity(${d})=${v} must be a multiple of 0x10 (AND 0F0)`).toBe(0)
    }
  })

  it('a degenerate depth folds to the floor, never NaN', () => {
    const f = needFn(depthIntensity, 'depthIntensity')
    expect(Number.isFinite(f(Number.NaN)) ? f(Number.NaN) : 0).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(f(-1))).toBe(true)
  })
})

describe('rb4-9 AC-3 — the plane draws in two tiers: airframe bright, struts 0x60 dimmer', () => {
  it('the full plane emits exactly two intensity tiers, the dim one 0x60 below the bright', () => {
    const BRIGHT = 0xf0
    const segs = renderModel(biplane.biplaneLOD(false), mvpAt(-1000), BRIGHT) // D4=1: airframe + DB.LNS struts
    expect(segs.length, 'the full plane must draw').toBeGreaterThan(0)
    const tiers = new Set(segs.map((s) => intensityOf(s)))
    expect([...tiers].sort((a, b) => (a ?? 0) - (b ?? 0)), 'the plane must draw at two intensities').toEqual([
      Math.max(0, BRIGHT - 0x60),
      BRIGHT,
    ])
  })

  it('exactly the DB.LNS struts are the dimmer tier — one dim segment per lighter line', () => {
    const BRIGHT = 0xf0
    const DIM = Math.max(0, BRIGHT - 0x60)
    const segs = renderModel(biplane.biplaneLOD(false), mvpAt(-1000), BRIGHT)
    const dim = segs.filter((s) => intensityOf(s) === DIM).length
    expect(dim, 'the number of dim segments must equal the DB.LNS "lighter lines"').toBe(strutSegments(DB_LNS))
    expect(segs.filter((s) => intensityOf(s) === BRIGHT).length, 'the airframe must be the brighter tier').toBeGreaterThan(0)
  })

  it('the strut tier floors at 0, never negative (SBC I,60 / BCS / LDA I,0)', () => {
    const segs = renderModel(biplane.biplaneLOD(false), mvpAt(-1000), 0x40) // 0x40 − 0x60 would underflow
    expect(segs.every((s) => (intensityOf(s) ?? 0) >= 0), 'strut intensity underflowed below 0').toBe(true)
    expect(new Set(segs.map((s) => intensityOf(s))).has(0), 'the dim tier must clamp to 0, not wrap').toBe(true)
  })

  it('the drone (front faces only, no struts) draws a SINGLE tier', () => {
    const BRIGHT = 0xf0
    const segs = renderModel(biplane.biplaneLOD(true), mvpAt(-1000), BRIGHT) // D4=0: DB.MAR only, no DB.LNS
    expect(segs.length).toBeGreaterThan(0)
    expect([...new Set(segs.map((s) => intensityOf(s)))], 'the drone has no struts, so one intensity').toEqual([BRIGHT])
  })
})

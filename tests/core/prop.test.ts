// tests/core/prop.test.ts
//
// Story rb4-9 — RED phase (Furiosa / TEA). Cluster C8, AC-1 (the PURE half) + AC-2.
//
// THE STORY'S HEADLINE: the player's own propeller — the most prominent foreground
// element on the ROM screen — IS NOT DRAWN, and neither is the enemy plane's. The
// prop topology is already transcribed (topology.ts: DBPROP_POINTS + the PROPS
// table of three blade-pair pictures PPROPA/B/C); nothing renders it.
//
// CONTRACT for GREEN (DEV): create `src/core/prop.ts` — the pure prop-picture
// substrate (a sibling of biplane.ts's renderModel / guns.ts's shellSegments;
// geometry lives in CORE, never in the shell — main.ts:63-101). Export:
//
//   export const PROP_PICTURES = 3
//   export function propFrame(displayCount: number): number
//   export function propSegments(picture: number, mvp: Mat4): readonly SceneSegment[]
//
// ROM GROUNDING (RBARON.MAC, `.RADIX 16`):
//   • PLPROP (:880-895) is the prop switch. `PROP.F` steps +2 (`INY / INY`) and
//     wraps at 6 (`CPY I,6 / BCC 5$ / LDY I,0`), indexing the six-entry `.PROPS`
//     JMPL table (3 pictures × 2 VG double-buffers). So the PICTURE index —
//     PROP.F/2 — cycles 0 → 1 → 2 → 0, ONE picture per switch.
//   • PLPROP is called from the DISPLAY loop, right after `JSR INTWAIT ;WAIT FOR
//     EOF` (:851-855) — once per VG frame (62.5 Hz). That is AC-1's "on the
//     DISPLAY clock, not the calc clock"; the WIRING half is proven by booting the
//     cockpit in tests/prop-clock-wiring.test.ts. THIS file pins the pure math.
//   • The three pictures are DISTINCT blade orientations: PPROPA (vertical),
//     PPROPB (60°), PPROPC (120°) — topology.ts:154-158.
//
// PURE. No DOM, no time, no randomness — every assertion is a property of the code.

import { describe, it, expect, beforeAll } from 'vitest'
import { sceneProjection } from '../../src/core/scene'
import { DBPROP_POINTS, PROPS } from '../../src/core/topology'
import { multiply, translation, type Mat4, type Vec3 } from '@arcade/shared/math3d'

interface Seg {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

interface PropModule {
  PROP_PICTURES?: number
  propFrame?: (displayCount: number) => number
  propSegments?: (picture: number, mvp: Mat4) => readonly Seg[]
}

// A variable specifier so tsc does not resolve (and reject) the module before DEV creates it;
// at runtime the missing module rejects and we fall back to an empty record → clean contract RED.
const loadMaybe = (p: string): Promise<unknown> => import(/* @vite-ignore */ p)

let prop: PropModule = {}
beforeAll(async () => {
  try {
    prop = (await loadMaybe('../../src/core/prop')) as PropModule
  } catch {
    prop = {}
  }
})

function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`src/core/prop.ts must export ${name} (rb4-9 RED contract)`)
  return value
}

const PROJ = sceneProjection(1)
/** MVP placing a model `tz` down eye −Z (negative = in FRONT); DBPROP is within ±44 units. */
const mvpAt = (tz: number): Mat4 => multiply(PROJ, translation(0, 0, tz))
const flat = (segs: readonly Seg[]): number[] => segs.flatMap((s) => [s.x1, s.y1, s.x2, s.y2])

// The pen-turtle segment count for a fully-visible connect-list: one drawn segment per
// VSBLEV op that has a prior vertex. Every PPROP list opens with a draw op whose pen is
// still up (no prior point), so it yields (drawOps − 1) segments. Computed from the
// transcription, not hand-copied, so it tracks any future re-transcription.
const visibleSegmentCount = (connect: readonly { draw: boolean }[]): number => {
  let count = 0
  let hasPrev = false
  for (const op of connect) {
    if (op.draw && hasPrev) count += 1
    hasPrev = true
  }
  return count
}

describe('rb4-9 AC-1 (pure) — propFrame cycles the three blade pictures on the display counter', () => {
  it('exports the three-picture count (PROP.F/2 ∈ {0,1,2})', () => {
    expect(need(prop.PROP_PICTURES, 'PROP_PICTURES')).toBe(3)
  })

  it('advances ONE picture per display step and wraps 2 → 0 (PLPROP PROP.F += 2, wrap at 6)', () => {
    const f = need(prop.propFrame, 'propFrame')
    // Six consecutive display frames sweep the three pictures TWICE — one advance each.
    expect([0, 1, 2, 3, 4, 5].map(f)).toEqual([0, 1, 2, 0, 1, 2])
  })

  it('reaches every one of the three pictures (no picture is skipped or stuck)', () => {
    const f = need(prop.propFrame, 'propFrame')
    const seen = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8].map(f))
    expect([...seen].sort()).toEqual([0, 1, 2])
  })

  it('is a PURE function of the counter — same count, same picture', () => {
    const f = need(prop.propFrame, 'propFrame')
    for (const n of [0, 1, 2, 7, 12, 99]) expect(f(n)).toBe(f(n))
  })

  it('never selects outside the three-picture table (an out-of-range index would crash propSegments)', () => {
    const f = need(prop.propFrame, 'propFrame')
    for (let n = 0; n < 40; n++) {
      const i = f(n)
      expect(i, `propFrame(${n}) = ${i}`).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(3)
    }
  })
})

describe('rb4-9 AC-1/AC-2 — propSegments strokes the transcribed DBPROP blade pictures', () => {
  it('draws each of the three pictures as its blade connect-list decrees', () => {
    const seg = need(prop.propSegments, 'propSegments')
    for (let picture = 0; picture < 3; picture++) {
      const got = seg(picture, mvpAt(-512))
      expect(got.length, `picture ${picture} segment count`).toBe(visibleSegmentCount(PROPS[picture]))
      expect(got.length, 'a blade picture must actually draw lines').toBeGreaterThan(0)
    }
  })

  it('the three pictures are DISTINCT geometry — not one stub returning the same blades', () => {
    const seg = need(prop.propSegments, 'propSegments')
    const a = flat(seg(0, mvpAt(-512)))
    const b = flat(seg(1, mvpAt(-512)))
    const c = flat(seg(2, mvpAt(-512)))
    // PPROPA/B/C are the vertical / 60° / 120° blades — no two are the same picture.
    expect(a).not.toEqual(b)
    expect(b).not.toEqual(c)
    expect(a).not.toEqual(c)
  })

  it('culls behind the eye, exactly like renderModel (no perspective-mirrored ghost prop)', () => {
    const seg = need(prop.propSegments, 'propSegments')
    expect(seg(0, mvpAt(+512))).toHaveLength(0)
  })

  it('emits only finite NDC and is pure (same picture + mvp → same segments)', () => {
    const seg = need(prop.propSegments, 'propSegments')
    for (const v of flat(seg(1, mvpAt(-512)))) expect(Number.isFinite(v)).toBe(true)
    expect(flat(seg(1, mvpAt(-512)))).toEqual(flat(seg(1, mvpAt(-512))))
  })

  it('decodes against the real DBPROP point-set — every referenced vertex is in range', () => {
    // Anti-stub: the contract is that propSegments reads DBPROP_POINTS through PROPS, so
    // the transcribed data must actually be indexable (a guard on the topology it depends on).
    const maxIdx = Math.max(...PROPS.flat().map((op) => op.point))
    expect(maxIdx).toBeLessThan(DBPROP_POINTS.length)
    // and every DBPROP vertex is a finite 3-tuple the projector can consume.
    for (const p of DBPROP_POINTS) {
      const v: Vec3 = p as unknown as Vec3
      expect(v).toHaveLength(3)
      for (const c of v) expect(Number.isFinite(c)).toBe(true)
    }
  })
})

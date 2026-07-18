// tests/core/hud.test.ts
//
// Story rb4-9 — RED phase (Furiosa / TEA). AC-4: the missing HUD.
//
// Three foreground readouts the ROM draws and the clone does not:
//   • LIVES — tracked in lives.ts, never drawn (DSPLIF, RBARON.MAC:1501-1526).
//   • the WINDSCREEN BULLET HOLES that accumulate as the ace shoots you
//     (WNDSHD / B.HOLE, RBARON.MAC:1099-1103, 1482-1496).
//   • the PLVALU readout — the live worth of the plane in your sights
//     (RBARON.MAC:5285-5300; the value counts DOWN as the plane closes).
//
// Geometry lives in CORE (main.ts:63-101), so each readout is a pure producer the
// shell strokes. This suite pins the DATA + SHAPE contracts, not glyph pixels.
//
// CONTRACT for GREEN (DEV):
//   src/core/lives.ts:      livesGlyphs(count): readonly (readonly SceneSegment[])[]   // one plane per life
//   src/core/windscreen.ts: initialWindscreen(), addBulletHole(ws, side), windscreenSegments(ws),
//                           MAX_BULLET_HOLES
//   src/core/scoring.ts:    planeValue(depth): number                                  // the PLVALU readout

import { describe, it, expect, beforeAll } from 'vitest'
import type { SceneSegment } from '../../src/core/scene'
import { scoreKill } from '../../src/core/scoring'

// ─── graceful imports of the seams DEV is about to add ──────────────────────────
interface LivesExtra { livesGlyphs?: (count: number) => readonly (readonly SceneSegment[])[] }
interface ScoringExtra { planeValue?: (depth: number) => number }
interface Windscreen { readonly holes: number; readonly side: -1 | 1 }
interface WindscreenModule {
  MAX_BULLET_HOLES?: number
  initialWindscreen?: () => Windscreen
  addBulletHole?: (ws: Windscreen, side: -1 | 1) => Windscreen
  windscreenSegments?: (ws: Windscreen) => readonly SceneSegment[]
}

// Variable specifier for the module DEV has yet to create, so tsc does not reject it at RED.
const loadMaybe = (p: string): Promise<unknown> => import(/* @vite-ignore */ p)

let livesGlyphs: LivesExtra['livesGlyphs']
let planeValue: ScoringExtra['planeValue']
let ws: WindscreenModule = {}
beforeAll(async () => {
  livesGlyphs = ((await import('../../src/core/lives')) as LivesExtra).livesGlyphs
  planeValue = ((await import('../../src/core/scoring')) as ScoringExtra).planeValue
  try { ws = (await loadMaybe('../../src/core/windscreen')) as WindscreenModule } catch { ws = {} }
})
function need<T>(v: T | undefined, name: string): T {
  if (v === undefined) throw new Error(`rb4-9 RED contract: missing export ${name}`)
  return v
}

describe('rb4-9 AC-4 — LIVES are DRAWN (DSPLIF): one plane glyph per remaining life', () => {
  it('produces exactly `count` life glyphs', () => {
    const f = need(livesGlyphs, 'lives.ts livesGlyphs')
    for (const n of [1, 2, 3, 5]) expect(f(n).length, `${n} lives`).toBe(n)
  })

  it('draws nothing at zero lives, and every glyph is real geometry', () => {
    const f = need(livesGlyphs, 'lives.ts livesGlyphs')
    expect(f(0)).toHaveLength(0)
    for (const glyph of f(3)) {
      expect(glyph.length, 'a life glyph must stroke lines').toBeGreaterThan(0)
      for (const s of glyph) for (const v of [s.x1, s.y1, s.x2, s.y2]) expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('folds a negative or fractional count to a whole, non-negative number of glyphs', () => {
    const f = need(livesGlyphs, 'lives.ts livesGlyphs')
    expect(f(-1), 'negative lives draws nothing, never a negative-length array').toHaveLength(0)
    expect(f(2.7), 'a fractional count truncates to whole glyphs').toHaveLength(2)
  })
})

describe('rb4-9 AC-4 — the windscreen BULLET HOLES accumulate as the ace shoots you', () => {
  it('starts clean', () => {
    const init = need(ws.initialWindscreen, 'windscreen initialWindscreen')
    expect(init().holes).toBe(0)
    expect(need(ws.windscreenSegments, 'windscreenSegments')(init())).toHaveLength(0)
  })

  it('each hit adds a hole (INC B.HOLE) — holes accumulate, they do not reset', () => {
    const init = need(ws.initialWindscreen, 'windscreen initialWindscreen')
    const add = need(ws.addBulletHole, 'windscreen addBulletHole')
    let w = init()
    for (let i = 1; i <= 3; i++) {
      w = add(w, 1)
      expect(w.holes, `after ${i} hits`).toBe(i)
    }
  })

  it('caps at B.HOLE = 0x0C (further hits add no more — CMP I,0C / BCS 30$)', () => {
    const init = need(ws.initialWindscreen, 'windscreen initialWindscreen')
    const add = need(ws.addBulletHole, 'windscreen addBulletHole')
    const cap = need(ws.MAX_BULLET_HOLES, 'windscreen MAX_BULLET_HOLES')
    expect(cap).toBe(6) // 0x0C stepped by 2 → six holes
    let w = init()
    for (let i = 0; i < cap + 5; i++) w = add(w, 1)
    expect(w.holes, 'holes must saturate at the cap, not grow forever').toBe(cap)
  })

  it('more holes → more glass shattered (segment count grows with hits)', () => {
    const init = need(ws.initialWindscreen, 'windscreen initialWindscreen')
    const add = need(ws.addBulletHole, 'windscreen addBulletHole')
    const seg = need(ws.windscreenSegments, 'windscreenSegments')
    const one = seg(add(init(), 1))
    const three = seg(add(add(add(init(), 1), 1), 1))
    expect(one.length).toBeGreaterThan(0)
    expect(three.length, 'three holes must draw more than one').toBeGreaterThan(one.length)
  })

  it('holes appear on the side the enemy attacks from (ENSIDE → SEQUNA right / SEQUNB left)', () => {
    const init = need(ws.initialWindscreen, 'windscreen initialWindscreen')
    const add = need(ws.addBulletHole, 'windscreen addBulletHole')
    const seg = need(ws.windscreenSegments, 'windscreenSegments')
    const meanX = (s: readonly SceneSegment[]): number =>
      s.reduce((a, g) => a + (g.x1 + g.x2) / 2, 0) / Math.max(1, s.length)
    const right = seg(add(add(init(), 1), 1)) // ENSIDE +X → SEQUNA (right)
    const left = seg(add(add(init(), -1), -1)) // ENSIDE −X → SEQUNB (left)
    expect(meanX(right), 'right-side holes must sit on the +X half').toBeGreaterThan(0)
    expect(meanX(left), 'left-side holes must sit on the −X half').toBeLessThan(0)
  })
})

describe('rb4-9 AC-4 — the PLVALU readout: the live worth of the plane in your sights', () => {
  it('is exposed as a pure function of depth (the value the readout shows)', () => {
    const f = need(planeValue, 'scoring.ts planeValue')
    // It IS the lead-kill value — the readout shows what the plane is currently worth.
    for (const depth of [0x200, 0x800, 0x2000]) expect(f(depth)).toBe(scoreKill('lead', depth))
  })

  it('counts DOWN as the plane closes (shrinks with depth), floored, never NaN', () => {
    const f = need(planeValue, 'scoring.ts planeValue')
    const far = f(0x1500)
    const mid = f(0x800)
    const near = f(0x120)
    expect(far).toBeGreaterThanOrEqual(mid)
    expect(mid).toBeGreaterThanOrEqual(near)
    expect(far, 'the value must actually vary with depth').toBeGreaterThan(near)
    expect(Number.isFinite(f(Number.NaN)), 'planeValue(NaN) must be finite, never NaN').toBe(true)
    expect(f(Number.NaN)).toBeGreaterThanOrEqual(0)
  })
})

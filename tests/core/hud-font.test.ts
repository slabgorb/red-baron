// tests/core/hud-font.test.ts
//
// Story rb4-19 — RED rework (Reviewer F1). The routing suite (hud-font-adoption)
// proved the HUD text REACHES @arcade/shared/font, but nothing pinned the GEOMETRY
// hudTextSegments produces: the Reviewer mutation-tested an inverted y-flip and a
// doubled centre offset (HUD upside-down / off-centre) and the whole 1248-test suite
// stayed GREEN. This file pins the actual NDC output — orientation (the y-flip sign),
// scale (linear in size), left/centre alignment, the empty/space case, and the
// degenerate zero-size canvas — the way every sibling core renderer (livesGlyphs,
// windscreenSegments, horizonSegments…) is pinned.
import { describe, it, expect } from 'vitest'
import { hudTextSegments } from '../../src/core/hud-font'
import { V_BRIT_MAX, type SceneSegment } from '../../src/core/scene'

const W = 1600
const H = 900

// Inverse of main.ts's toPixel (main.ts:119): NDC (x∈[-1,1] L→R, y∈[-1,1] y-up) → device px.
const px = (ndcX: number): number => ((ndcX + 1) / 2) * W
const py = (ndcY: number): number => ((1 - ndcY) / 2) * H

interface Box { minX: number; maxX: number; minY: number; maxY: number }
function pixelBBox(segs: readonly SceneSegment[]): Box {
  const xs = segs.flatMap((s) => [px(s.x1), px(s.x2)])
  const ys = segs.flatMap((s) => [py(s.y1), py(s.y2)])
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

describe('rb4-19 hudTextSegments — geometry (orientation / scale / alignment)', () => {
  it('a left-aligned readout sits at its pixel anchor, upright, in the top band', () => {
    // SCORE readout: left edge x=16, baseline y=32, cap height 20px → top ≈ 12px.
    const segs = hudTextSegments('SCORE 1234', { x: 16, y: 32, size: 20, align: 'left', width: W, height: H })
    expect(segs.length, 'a non-empty readout must produce strokes').toBeGreaterThan(0)
    const b = pixelBBox(segs)
    // LEFT edge honoured (small tolerance for glyph side-bearing).
    expect(b.minX, 'left edge sits at the anchor').toBeGreaterThanOrEqual(15)
    expect(b.minX).toBeLessThan(48)
    // UPRIGHT & TOP-ANCHORED: the whole readout lives in the top band (well above mid-screen).
    // An INVERTED y-flip (the Reviewer's mutation) maps it to ~868..888px — deep in the bottom half.
    expect(b.maxY, 'baseline stays in the top half — catches an inverted y-flip').toBeLessThan(H / 2)
    expect(b.minY, 'top of the text ≈ 12px').toBeGreaterThanOrEqual(8)
    expect(b.maxY, 'baseline ≈ 32px').toBeLessThanOrEqual(36)
    // full V.BRIT, like the other HUD glyphs.
    expect(segs.every((s) => s.intensity === V_BRIT_MAX), 'HUD draws at the bright tier').toBe(true)
  })

  it('the drawn height scales linearly with `size` (catches a broken scale factor)', () => {
    const at = (size: number): Box =>
      pixelBBox(hudTextSegments('SCORE 1234', { x: 16, y: 400, size, align: 'left', width: W, height: H }))
    const h20 = at(20).maxY - at(20).minY
    const h40 = at(40).maxY - at(40).minY
    expect(h20, 'a size-20 readout has real vertical extent').toBeGreaterThan(4)
    expect(Math.abs(h40 / h20 - 2), 'doubling size doubles the drawn height').toBeLessThan(0.1)
  })

  it('a centre-aligned card is horizontally centred on its anchor (doubled-offset guard)', () => {
    // GAME OVER card: centred at x=800. A DOUBLED centre offset shifts it a half-text-width off.
    const x = 800
    const segs = hudTextSegments('GAME OVER', { x, y: H * 0.4 + 24, size: 48, align: 'center', width: W, height: H })
    expect(segs.length).toBeGreaterThan(0)
    const b = pixelBBox(segs)
    const centre = (b.minX + b.maxX) / 2
    // Tolerance ≈ one glyph's trailing side-bearing (advance-based centring shifts the INK bbox
    // slightly left); far under the ~144px a doubled-offset mutation would shove it.
    expect(Math.abs(centre - x), `centre ${centre} must sit near the anchor ${x}`).toBeLessThan(20)
    // and it straddles the anchor — not shoved entirely to one side.
    expect(b.minX, 'left of the card is left of the anchor').toBeLessThan(x)
    expect(b.maxX, 'right of the card is right of the anchor').toBeGreaterThan(x)
  })

  it('left vs centre alignment actually differ for the same text', () => {
    const base = { x: 800, y: 100, size: 20, width: W, height: H } as const
    const left = pixelBBox(hudTextSegments('PLANE 300', { ...base, align: 'left' }))
    const centre = pixelBBox(hudTextSegments('PLANE 300', { ...base, align: 'center' }))
    expect(left.minX, 'left-aligned starts AT the anchor').toBeGreaterThanOrEqual(795)
    expect(centre.minX, 'centre-aligned starts LEFT of the anchor').toBeLessThan(left.minX - 10)
  })

  it('produces nothing for empty or all-space text (no glyph, no silent junk strokes)', () => {
    expect(hudTextSegments('', { x: 16, y: 32, size: 20, align: 'left', width: W, height: H })).toHaveLength(0)
    expect(hudTextSegments('   ', { x: 16, y: 32, size: 20, align: 'left', width: W, height: H })).toHaveLength(0)
  })

  it('emits only finite coordinates on a degenerate zero-size canvas (no NaN to the glass)', () => {
    // Pre-layout / degenerate canvas: main.ts's viewAspect() already guards height==0; the HUD
    // renderer must be equally robust rather than dividing by zero into NaN/Infinity segments.
    const segs = hudTextSegments('SCORE 0', { x: 16, y: 32, size: 20, align: 'left', width: 0, height: 0 })
    for (const s of segs) {
      for (const v of [s.x1, s.y1, s.x2, s.y2]) {
        expect(Number.isFinite(v), 'a zero-size canvas must not produce NaN/Infinity coordinates').toBe(true)
      }
    }
  })
})

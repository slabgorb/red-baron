// src/core/hud-font.ts
//
// Story rb4-19 — the HUD readout FONT. red-baron's on-screen text (SCORE, PLANE,
// GUNS HOT, GAME OVER) used to be drawn in the browser's system face via
// ctx.fillText — the wrong hand for a vector cabinet. This lays it out in the shared
// ROM glyph font (@arcade/shared/font) and returns it as HUD SceneSegments — the same
// non-projected NDC geometry livesGlyphs (DSPLIF) and windscreenSegments (WNDSHD)
// produce — so main.ts strokes it through the SAME green glowing-vector path
// (strokeSegments). No canvas font, no ctx transforms: the readout is drawn in the
// cabinet's own stroked glyphs. A pure core renderer (like its HUD-overlay peers),
// so it sits in MEASURED_SOURCES (tests/core/screen-scale.test.ts) and is accounted
// for by the INVARIANT-4 tail (tests/shell/cockpit-draw-path.test.ts).
//
// The font's strokes are cell-local (CELL_W×CELL_H, y-up, baseline y=0). We scale to
// a pixel size, anchor at a pixel origin, flip y (screen y-down), and convert to the
// NDC that strokeSegments' toPixel expects: x∈[-1,1] left→right, y∈[-1,1] y-up.
import { layoutText, CELL_H } from '@arcade/shared/font'
import { V_BRIT_MAX, type SceneSegment } from './scene'

export interface HudTextOptions {
  /** Pixel anchor x: the text's LEFT edge (align 'left') or its CENTRE (align 'center'). */
  readonly x: number
  /** Pixel BASELINE y — the glyphs rise above it (cell-local y-up; the HUD charset — caps, digits,
   *  space — has no descenders, so ink stays above the baseline; the font's `,` glyph does descend
   *  but is never in a HUD string). */
  readonly y: number
  /** Pixel cell height — CELL_H maps to this (≈ the old fillText px size). */
  readonly size: number
  readonly align: 'left' | 'center'
  /** Canvas dimensions — the NDC frame the returned segments are authored against. */
  readonly width: number
  readonly height: number
}

/**
 * Lay `text` out in the shared glyph font and return it as HUD SceneSegments in NDC,
 * ready for strokeSegments. Full V.BRIT — the HUD draws at the cabinet's bright tier.
 */
export function hudTextSegments(text: string, opts: HudTextOptions): readonly SceneSegment[] {
  const { x, y, size, align, width, height } = opts
  // Degenerate/pre-layout canvas: nothing to draw yet — and dividing by a 0 width/height below
  // would emit NaN/Infinity coordinates. Guard it the way viewAspect() guards `height === 0`.
  if (!(width > 0) || !(height > 0)) return []
  const scale = size / CELL_H // pixels per glyph cell-unit
  const layout = layoutText(text) // strokes already positioned left-to-right
  const leftPx = align === 'center' ? x - (layout.width * scale) / 2 : x
  const toNdcX = (px: number): number => (px / width) * 2 - 1
  const toNdcY = (py: number): number => 1 - (py / height) * 2
  const segs: SceneSegment[] = []
  for (const stroke of layout.strokes) {
    const pts = stroke.points
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      segs.push({
        x1: toNdcX(leftPx + a.x * scale),
        y1: toNdcY(y - a.y * scale), // cell y-up baseline → screen y-down
        x2: toNdcX(leftPx + b.x * scale),
        y2: toNdcY(y - b.y * scale),
        intensity: V_BRIT_MAX,
      })
    }
  }
  return segs
}

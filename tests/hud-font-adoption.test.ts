// tests/hud-font-adoption.test.ts
//
// Story rb4-19 — RED phase (Furiosa / TEA). The BEHAVIOURAL half: boot the REAL
// cockpit (the hud-wiring harness pattern) under a pinned clock and prove the LIVE
// HUD readout routes through @arcade/shared/font, not the browser system font.
//
// THE TRAP (SM handoff / context §Test-Seam): routing the HUD through the shared
// subpath RELOCATES the observed text INTO @arcade/shared/font. A spy on
// ctx.fillText — or a mock of a LOCAL font module — sees NOTHING, and the test
// passes vacuously. So we mock the EXACT subpath main.ts imports and capture the
// strings handed to it. The mock DELEGATES to the real module (real glyph strokes)
// so Dev's stroking path still runs; we only tap what was routed.
//
// Only SCORE + PLANE are reachable by a passive boot-and-drive run (GUNS HOT needs
// `overheated`, GAME OVER needs `gameOver`). Those two are pinned STATICALLY in
// hud-font-source.test.ts; here we pin that the shared font is ACTUALLY wired into
// the live draw path — the check a source grep cannot make.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { GLYPH_CHARS } from '@arcade/shared/font'

// The recorder must exist before the hoisted vi.mock factory runs — vi.hoisted is
// the sanctioned way to share state into a mock factory.
const fontRec = vi.hoisted(() => ({
  layoutTexts: [] as string[], // every string handed to layoutText()
  glyphChars: [] as string[], // every char handed to charGlyph()
}))

vi.mock('@arcade/shared/font', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arcade/shared/font')>()
  return {
    ...actual, // real GLYPH_CHARS / CELL_W / CELL_H / hasGlyph
    layoutText: (text: string, opts?: unknown) => {
      fontRec.layoutTexts.push(String(text))
      return actual.layoutText(text, opts as never)
    },
    charGlyph: (ch: string) => {
      fontRec.glyphChars.push(String(ch))
      return actual.charGlyph(ch)
    },
  }
})

// main.ts builds an AudioContext-backed engine at import; stub it (no browser audio
// under vitest). Same six-method shape as the live AudioEngine interface.
vi.mock('../src/shell/audio', () => ({
  createAudioEngine: () => ({
    resume: () => {}, play: () => {}, playTone: () => {},
    setEngine: () => {}, setGun: () => {}, setApproach: () => {},
  }),
}))

const WIDTH = 1600
const HEIGHT = 900

// Every string that flowed through the CANVAS font path (the one AC-1 forbids for
// the HUD) — captured so we can prove no HUD text still uses it after the migration.
const rec = { texts: [] as string[] }

let curAlpha = 1
const ctxStub: Record<string, unknown> = {
  strokeStyle: '', fillStyle: '', lineWidth: 0, shadowColor: '', shadowBlur: 0,
  font: '', textAlign: '', textBaseline: '', lineCap: '', lineJoin: '', miterLimit: 0,
  // Permissive vector-path surface: glyph strokes come back through the real font
  // mock and are drawn here. We assert on WHAT was routed, not stroke geometry, so
  // these are no-ops — but they must EXIST so a glyph-stroking Dev impl can't throw.
  beginPath: () => {}, closePath: () => {}, moveTo: () => {}, lineTo: () => {},
  stroke: () => {}, fill: () => {}, fillRect: () => {}, strokeRect: () => {},
  rect: () => {}, arc: () => {}, clip: () => {}, setLineDash: () => {},
  save: () => {}, restore: () => {},
  translate: () => {}, scale: () => {}, rotate: () => {},
  setTransform: () => {}, transform: () => {}, resetTransform: () => {},
  measureText: () => ({ width: 0 }),
  // The canvas-font text path — captured. After the migration this must carry NO
  // HUD string.
  fillText: (t: string) => { rec.texts.push(String(t)) },
  strokeText: (t: string) => { rec.texts.push(String(t)) },
}
Object.defineProperty(ctxStub, 'globalAlpha', { get: () => curAlpha, set: (v: number) => { curAlpha = v } })

const canvasStub = { width: 0, height: 0, clientWidth: WIDTH, clientHeight: HEIGHT, getContext: (): unknown => ctxStub }
let rafCb: ((t: number) => void) | null = null
const windowStub = {
  innerWidth: WIDTH, innerHeight: HEIGHT,
  addEventListener: () => {},
  requestAnimationFrame: (cb: (t: number) => void): number => { rafCb = cb; return 1 },
}
const g = globalThis as unknown as Record<string, unknown>
g.document = { getElementById: (): unknown => canvasStub }
g.window = windowStub

const FIXED_NOW = 1_700_000_000_000
const realNow = Date.now
Date.now = (): number => FIXED_NOW

const FRAME_MS = 200
const FRAMES = 24 // same fixed-seed run as hud-wiring — brings a wave up (PLANE readout)

beforeAll(async () => {
  await import('../src/main')
  let t = 0
  for (let i = 0; i < FRAMES; i++) {
    const cb = rafCb
    expect(cb).not.toBeNull()
    rafCb = null
    t += FRAME_MS
    cb!(t) // fontRec / rec.texts accumulate across the whole run
  }
})

afterAll(() => { Date.now = realNow })

/** Everything handed to the shared glyph font this run: whole strings + single chars. */
function routedContent(): string {
  // ␟ (unit separator) keeps distinct layoutText strings from fusing into
  // false substring matches; charGlyph chars join contiguously so a per-char
  // rendering ("G","U","N","S"," ","H"…) still reads as its whole word.
  return fontRec.layoutTexts.join('␟') + '␟' + fontRec.glyphChars.join('')
}

describe('rb4-19 AC-1 — the live HUD readout routes through @arcade/shared/font', () => {
  it('routes the SCORE line through the shared glyph font (not the canvas font)', () => {
    expect(
      routedContent().includes('SCORE'),
      'the SCORE readout never reached @arcade/shared/font — the HUD is not routed through the shared glyphs',
    ).toBe(true)
  })

  it('routes the PLANE readout through the shared glyph font while a wave is up', () => {
    expect(
      routedContent().includes('PLANE'),
      'the PLANE readout never reached @arcade/shared/font — AC-4 (relocated from rb4-9) unproven at the new seam',
    ).toBe(true)
  })

  it('routes the readout NUMBERS too — a real score/plane value, not just the labels', () => {
    // rb4-9 AC-4 intent, relocated to the shared-font seam: the readout carries a
    // live numeric value, now observed as digits handed to the glyph font.
    expect(
      /[0-9]/.test(routedContent()),
      'no digit reached the shared glyph font — the score/plane VALUE is not being drawn through it',
    ).toBe(true)
  })

  it('draws NO HUD readout text through the canvas font (fillText/strokeText)', () => {
    const hudViaCanvas = rec.texts.filter((s) => /SCORE|PLANE|GUNS HOT|GAME OVER/.test(s))
    expect(
      hudViaCanvas,
      `HUD text still drawn with the canvas font: ${JSON.stringify(hudViaCanvas)} — AC-1 requires the shared glyph font`,
    ).toHaveLength(0)
  })
})

describe('rb4-19 AC-3 — every routed HUD string lies within the font GLYPH_CHARS', () => {
  it('routed something, and every routed character is a glyph the font can draw', () => {
    const routed = [...fontRec.layoutTexts, ...fontRec.glyphChars]
    expect(
      routed.length,
      'nothing was routed to @arcade/shared/font — cannot prove glyph coverage (HUD still on the canvas font)',
    ).toBeGreaterThan(0)
    const allChars = fontRec.layoutTexts.join('') + fontRec.glyphChars.join('')
    const unsupported = [...allChars].filter((c) => !GLYPH_CHARS.includes(c))
    expect(
      unsupported,
      `HUD routed characters the font cannot draw (would silently blank): ${JSON.stringify(unsupported)}`,
    ).toHaveLength(0)
  })
})

describe('rb4-19 AC-3 — the fixed HUD labels are all drawable (no silent-drop guard)', () => {
  it('GUNS HOT / SCORE / PLANE / GAME OVER contain only GLYPH_CHARS characters', () => {
    for (const label of ['GUNS HOT', 'SCORE', 'PLANE', 'GAME OVER']) {
      const bad = [...label].filter((c) => !GLYPH_CHARS.includes(c))
      expect(bad, `HUD label "${label}" has characters outside GLYPH_CHARS: ${JSON.stringify(bad)}`).toHaveLength(0)
    }
  })
})

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
}))

// main.ts's hud-font renderer calls layoutText for whole HUD lines; it never imports
// charGlyph. (A charGlyph tap here would be inert anyway: @arcade/shared/font's
// layoutText calls its OWN module-internal charGlyph, which vi.mock's export rewrite
// does not intercept — Reviewer F6.) So we tap only layoutText — the seam the HUD uses.
vi.mock('@arcade/shared/font', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arcade/shared/font')>()
  return {
    ...actual, // real GLYPH_CHARS / CELL_W / CELL_H / hasGlyph
    layoutText: (text: string, opts?: Parameters<typeof actual.layoutText>[1]) => {
      fontRec.layoutTexts.push(String(text))
      return actual.layoutText(text, opts)
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
  // ␟ (unit separator) keeps distinct layoutText strings from fusing into false
  // substring matches across the run.
  return fontRec.layoutTexts.join('␟')
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

  it('routes the readout with a real, non-negative numeric VALUE (not just the labels)', () => {
    // rb4-9 AC-4 rigor, RESTORED (Reviewer F2): parse the actual routed value and assert
    // it is finite and >= 0. The prior `/[0-9]/` scan let a garbage `PLANE -301` sail through.
    const readouts = fontRec.layoutTexts.filter((s) => /^(SCORE|PLANE) /.test(s))
    expect(readouts.length, 'a SCORE/PLANE readout must have routed through the shared font').toBeGreaterThan(0)
    for (const s of readouts) {
      const n = Number(s.replace(/^(SCORE|PLANE) /, ''))
      expect(Number.isFinite(n), `readout "${s}" must carry a finite numeric value`).toBe(true)
      expect(n, `readout "${s}" must be non-negative`).toBeGreaterThanOrEqual(0)
    }
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
    expect(
      fontRec.layoutTexts.length,
      'nothing was routed to @arcade/shared/font — cannot prove glyph coverage (HUD still on the canvas font)',
    ).toBeGreaterThan(0)
    const unsupported = [...fontRec.layoutTexts.join('')].filter((c) => !GLYPH_CHARS.includes(c))
    expect(
      unsupported,
      `HUD routed characters the font cannot draw (would silently blank): ${JSON.stringify(unsupported)}`,
    ).toHaveLength(0)
  })
})

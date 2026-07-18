// tests/hud-wiring.test.ts
//
// Story rb4-9 — GREEN rework (Reviewer findings). Two pieces of wiring the RED suite
// pinned in CORE but left unproven at the GLASS:
//   • AC-4 PLVALU — the `PLANE ###` readout must actually be drawn beside the score
//     (main.ts's `ctx.fillText`), gated on a wave being up.
//   • AC-3 depth-cue — `strokeSegments` must actually RENDER intensity (per-run
//     `ctx.globalAlpha`), so the airframe and its 0x60-dimmer struts reach the glass
//     at DIFFERENT brightnesses. A bug that ignored intensity (all full-bright) would
//     pass every core test and INVARIANT 4 (which checks only x/y) — it dies here.
//
// Boots the REAL cockpit (the cockpit-draw-path harness pattern) under a pinned clock,
// captures fillText strings + the globalAlpha in force at each stroke().
//
// rb4-19 UPDATE (Furiosa / TEA): the AC-4 "readout is DRAWN" assertions used to
// observe the SCORE/PLANE line at `ctx.fillText`. rb4-19 routes that readout through
// @arcade/shared/font (vector glyphs, stroked — NOT the canvas font), so the fillText
// observation no longer holds. Those assertions are RELOCATED to
// hud-font-adoption.test.ts, where the readout is observed at the shared-font seam
// (and the numeric value is pinned there too). What stays here is the AC-3 intensity
// check — it reads globalAlpha at each stroke() and is font-independent. The ctx stub
// gains no-op transform ops so the migrated glyph-stroking path can't throw here.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('../src/shell/audio', () => ({
  createAudioEngine: () => ({
    resume: () => {}, play: () => {}, playTone: () => {},
    setEngine: () => {}, setGun: () => {}, setApproach: () => {},
  }),
}))

const WIDTH = 1600
const HEIGHT = 900

const rec = {
  texts: [] as string[], // every fillText string drawn, across the run
  strokeAlphas: [] as number[], // globalAlpha in force at each stroke(), across the run
}
let curAlpha = 1

const ctxStub: Record<string, unknown> = {
  strokeStyle: '', fillStyle: '', lineWidth: 0, shadowColor: '', shadowBlur: 0,
  font: '', textAlign: '', textBaseline: '',
  beginPath: () => {}, closePath: () => {}, moveTo: () => {}, lineTo: () => {},
  stroke: () => { rec.strokeAlphas.push(curAlpha) },
  fillRect: () => {}, fill: () => {},
  fillText: (t: string) => { rec.texts.push(String(t)) },
  save: () => {}, restore: () => {},
  // rb4-19: the HUD readout now strokes @arcade/shared/font glyphs — tolerate a
  // transform-based glyph path so booting main here can't throw.
  translate: () => {}, scale: () => {}, rotate: () => {},
  setTransform: () => {}, transform: () => {}, resetTransform: () => {},
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
const FRAMES = 24

beforeAll(async () => {
  await import('../src/main')
  let t = 0
  for (let i = 0; i < FRAMES; i++) {
    const cb = rafCb
    expect(cb).not.toBeNull()
    rafCb = null
    t += FRAME_MS
    cb!(t) // rec.texts / rec.strokeAlphas accumulate across the whole run
  }
})

afterAll(() => { Date.now = realNow })

// rb4-9 AC-4 ("the PLVALU readout is DRAWN beside the score, with a real numeric
// value") RELOCATED to hud-font-adoption.test.ts by rb4-19 — the readout now routes
// through @arcade/shared/font (stroked glyphs), not ctx.fillText, so it is observed
// at that seam. `rec.texts` is still captured below as a canvas-font-usage tap.

describe('rb4-9 AC-3 — intensity is RENDERED (globalAlpha), not just carried on the data', () => {
  it('strokes at more than one brightness — the depth-cue and two-tier reach the glass', () => {
    expect(rec.strokeAlphas.length, 'the cockpit must have stroked something').toBeGreaterThan(0)
    const distinct = new Set(rec.strokeAlphas.map((a) => Math.round(a * 1000) / 1000))
    expect(
      distinct.size,
      'every stroke used the SAME globalAlpha — intensity is computed but not rendered ' +
        '(a flat-green world; the airframe and its 0x60-dimmer struts must differ)',
    ).toBeGreaterThan(1)
  })

  it('renders dimmer-than-full strokes (a struts/far tier below the bright airframe)', () => {
    expect(
      rec.strokeAlphas.some((a) => a < 0.999),
      'nothing was drawn dimmer than full brightness — the depth-cue/strut tier is not applied',
    ).toBe(true)
  })
})

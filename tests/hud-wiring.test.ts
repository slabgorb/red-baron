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
  beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
  stroke: () => { rec.strokeAlphas.push(curAlpha) },
  fillRect: () => {},
  fillText: (t: string) => { rec.texts.push(String(t)) },
  save: () => {}, restore: () => {},
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

describe('rb4-9 AC-4 — the PLVALU readout is DRAWN beside the score', () => {
  it('draws a `PLANE ###` readout while a wave is up (and the SCORE line every frame)', () => {
    expect(rec.texts.some((s) => s.startsWith('SCORE ')), 'the score HUD must draw').toBe(true)
    const plane = rec.texts.filter((s) => s.startsWith('PLANE '))
    expect(plane.length, 'the PLVALU readout never reached the glass — AC-4 unwired').toBeGreaterThan(0)
  })

  it('the readout carries a real, non-negative numeric value', () => {
    for (const s of rec.texts.filter((x) => x.startsWith('PLANE '))) {
      const n = Number(s.slice('PLANE '.length))
      expect(Number.isFinite(n), `PLVALU readout "${s}" must be a finite number`).toBe(true)
      expect(n).toBeGreaterThanOrEqual(0)
    }
  })
})

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

// tests/shell-overheat-monochrome.test.ts
//
// Story rb4-9 — RED phase (Furiosa / TEA). AC-5 (the message half).
//
// The gun-overheat warning is drawn in an INVENTED SECOND COLOUR — `ctx.fillStyle =
// '#ff5533'`, a red 'GUNS HOT' banner (main.ts:239-244). The whole game is otherwise
// monochrome cabinet green; the ROM's overheat warning is a monochrome vector message
// (findings §5). AC-5: replace the second-colour banner with the ROM's monochrome message.
//
// The bug is a COLOUR set on the canvas, so — as rb4-1 taught — the only honest test
// boots the cockpit and watches what colour it actually paints. We FORCE the guns
// overheated at the sim seam (so the warning branch runs every frame regardless of the
// seeded sky, which otherwise shoots the pilot down and cools the gun before it locks
// out) and assert the invented red is NEVER painted. The colour is main.ts's own.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { Enemy } from '../src/core/enemy'
import type { Vec3 } from '@arcade/shared/math3d'
import type { Guns } from '../src/core/guns'

const rec = vi.hoisted(() => ({
  colours: [] as string[], // every fillStyle/strokeStyle/shadowColor the cockpit assigned
  overheated: false, // was the warning branch ever live?
  drewWhileHot: false, // was anything painted on an overheated frame?
}))
let hotThisFrame = false

vi.mock('../src/shell/audio', () => ({
  createAudioEngine: () => ({
    resume: () => {}, play: () => {}, playTone: () => {},
    setEngine: () => {}, setGun: () => {}, setApproach: () => {},
  }),
}))

// Force the gun locked-out at the seam the cockpit reads (`guns.overheated`), so draw()'s
// warning branch runs deterministically. Only the FLAG is forced; the colour it then paints
// is entirely main.ts's own code — which is what this test measures.
vi.mock('../src/core/guns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/guns')>()
  const hot = (g: Guns): Guns => ({ ...g, overheated: true })
  return {
    ...actual,
    fire: (guns: Guns, held: boolean): Guns => {
      rec.overheated = true; hotThisFrame = true
      return hot(actual.fire(guns, held))
    },
    step: (guns: Guns, targets: readonly Enemy[], eye: Vec3) => {
      const out = actual.step(guns, targets, eye)
      rec.overheated = true; hotThisFrame = true
      return { ...out, guns: hot(out.guns) }
    },
  }
})

const WIDTH = 1600
const HEIGHT = 900
const record = (v: string): void => { rec.colours.push(v); if (hotThisFrame && v) rec.drewWhileHot = true }
const ctxStub: Record<string, unknown> = {
  lineWidth: 0, shadowBlur: 0, font: '', textAlign: '', textBaseline: '',
  beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
  fillRect: () => {}, fillText: () => { if (hotThisFrame) rec.drewWhileHot = true }, save: () => {}, restore: () => {},
}
let _fill = '', _stroke = '', _shadow = ''
Object.defineProperty(ctxStub, 'fillStyle', { get: () => _fill, set: (v: string) => { _fill = v; record(v) } })
Object.defineProperty(ctxStub, 'strokeStyle', { get: () => _stroke, set: (v: string) => { _stroke = v; record(v) } })
Object.defineProperty(ctxStub, 'shadowColor', { get: () => _shadow, set: (v: string) => { _shadow = v; record(v) } })

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
    hotThisFrame = false
    const cb = rafCb
    expect(cb).not.toBeNull()
    rafCb = null
    t += FRAME_MS
    cb!(t)
  }
})

afterAll(() => { Date.now = realNow })

describe('rb4-9 AC-5 — the overheat warning is monochrome (no invented second colour)', () => {
  it('the warning branch ran and PAINTED something (this suite is not vacuous)', () => {
    expect(rec.overheated, 'the gun-overheat branch must have been exercised').toBe(true)
    expect(rec.drewWhileHot, 'the cockpit must still PAINT a warning while overheated, not go silent').toBe(true)
  })

  it("never paints the invented red '#ff5533' — the second colour is gone", () => {
    const reds = rec.colours.filter((c) => c.toLowerCase() === '#ff5533')
    expect(
      reds.length,
      `the cockpit set the invented red '#ff5533' ${reds.length}× — the overheat banner must be ` +
        `the ROM's MONOCHROME message (cabinet green), not a second colour`,
    ).toBe(0)
  })
})

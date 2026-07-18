// tests/prop-clock-wiring.test.ts
//
// Story rb4-9 — RED phase (Furiosa / TEA). AC-1 (the WIRING half) + AC-2.
//
// ─── THE MAP-INDEX TRAP, STATED FOR THE PROP ────────────────────────────────────
//
// AC-1: "the propeller is drawn and animated, cycling PROP.F over the three
// blade-pair pictures — on the DISPLAY clock (62.5 Hz), NOT the calc clock."
//
// tests/core/prop.test.ts already pins the pure math (propFrame cycles 0→1→2→0,
// one picture per step). But a pure test CANNOT tell whether main.ts advances that
// counter on the DISPLAY frame (every rAF, ROM's PLPROP after `INTWAIT ;WAIT FOR
// EOF`, RBARON.MAC:851-855) or on the CALC frame (once per SIM_TIMESTEP_S, ~10.4 Hz).
// A prop driven off `simFrame` would run ~6× TOO SLOW — a barely-turning blade —
// and every pure prop test would still pass. This is the Red Baron ÷N trap
// (timing.ts) pointed at the foreground, and the ONLY way to catch it is to BOOT
// the cockpit and watch the two clocks diverge.
//
// So this file drives the REAL loop at a DISPLAY cadence (16 ms per rAF, well under
// the 96 ms SIM_TIMESTEP_S) and asserts the player prop's picture advances on the
// rAF frame — INCLUDING on rAF frames where no calc-frame ran at all.
//
// ─── CONTRACT for GREEN (DEV) ───────────────────────────────────────────────────
//
// src/core/prop.ts additionally exports the player's own cockpit prop, so the shell
// can draw it (geometry stays in CORE — main.ts:63-101):
//
//   export function playerPropSegments(picture: number, aspect: number): readonly SceneSegment[]
//
// main.ts, in draw(): advance a DISPLAY counter once per frame() (the rAF), select
// the picture with propFrame(displayCounter), draw the player prop with
// playerPropSegments(...), and draw each enemy's prop with propSegments(picture,
// <the plane's own MVP>) — AC-2, the enemy prop from the transcribed topology.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { Mat4 } from '@arcade/shared/math3d'
import type { SceneSegment } from '../src/core/scene'

/** The prop-substrate exports DEV will add — declared locally so this file typechecks at RED. */
type PropExports = {
  playerPropSegments?: (picture: number, aspect: number) => readonly SceneSegment[]
  propSegments?: (picture: number, mvp: Mat4) => readonly SceneSegment[]
}

// ─── record every prop call the cockpit makes, tagged player vs enemy ───────────
const rec = vi.hoisted(() => ({
  playerPics: [] as number[], // picture index handed to playerPropSegments, in call order
  enemyCalls: [] as { picture: number; mvp: readonly number[] }[],
  calcFrames: 0, // total calc-frames the sim ran (tickCountUp fires once per calc-frame)
  enemyDraws: 0, // total enemy PLANE draws (renderModel) — AC-2 anti-vacuity witness
}))

vi.mock('../src/shell/audio', () => ({
  createAudioEngine: () => ({
    resume: () => {}, play: () => {}, playTone: () => {},
    setEngine: () => {}, setGun: () => {}, setApproach: () => {},
  }),
}))

// The prop substrate — record the picture on every call, keep the real geometry so the
// draw path stays honest. propFrame passes through to the real selector, so the picture
// we record IS the value main.ts's display counter produced.
vi.mock('../src/core/prop', async (importOriginal) => {
  // Resilient: src/core/prop.ts does not exist until DEV creates it. Tolerate its absence so
  // this file collects and drives its assertions to a clean RED (an empty prop record), rather
  // than dying on module resolution. Once prop.ts exists the real geometry flows through.
  let actual: PropExports = {}
  try { actual = (await importOriginal()) as PropExports } catch { actual = {} }
  return {
    ...actual,
    playerPropSegments: (picture: number, aspect: number): readonly SceneSegment[] => {
      rec.playerPics.push(picture)
      return actual.playerPropSegments ? actual.playerPropSegments(picture, aspect) : []
    },
    propSegments: (picture: number, mvp: Mat4): readonly SceneSegment[] => {
      rec.enemyCalls.push({ picture, mvp: [...mvp] })
      return actual.propSegments ? actual.propSegments(picture, mvp) : []
    },
  }
})

// tickCountUp runs exactly ONCE per calc-frame (main.ts preMotionFrame, unconditionally) —
// the cleanest per-calc-frame heartbeat. Count them so we can prove the prop out-runs them.
vi.mock('../src/core/score-countup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/score-countup')>()
  return {
    ...actual,
    tickCountUp: (score: Parameters<typeof actual.tickCountUp>[0]) => {
      rec.calcFrames += 1
      return actual.tickCountUp(score)
    },
  }
})

// Count enemy plane draws so AC-2's "a wave was on screen to grow a prop" is not vacuous.
vi.mock('../src/core/biplane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/biplane')>()
  return {
    ...actual,
    renderModel: (model: Parameters<typeof actual.renderModel>[0], mvp: Mat4): readonly SceneSegment[] => {
      rec.enemyDraws += 1
      return actual.renderModel(model, mvp)
    },
  }
})

// ─── the synthetic cockpit (mirrors cockpit-draw-path.test.ts) ──────────────────
const WIDTH = 1600
const HEIGHT = 900
const ctxStub = {
  fillStyle: '', strokeStyle: '', lineWidth: 0, shadowColor: '', shadowBlur: 0,
  font: '', textAlign: '', textBaseline: '',
  beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
  fillRect: () => {}, fillText: () => {}, save: () => {}, restore: () => {},
}
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

// Pin the clock: main.ts seeds its RNGs off Date.now(), so this fixes the whole sky —
// the same wave spawns every run, so AC-2's enemy prop is a FACT about the code.
const FIXED_NOW = 1_700_000_000_000
const realNow = Date.now
Date.now = (): number => FIXED_NOW

// 16 ms per rAF ≈ the 62.5 Hz display refresh, and well under the 96 ms calc step, so
// roughly SIX rAF frames pass per calc-frame — the gap the ÷N trap hides in. 30 frames
// spans several calc-frames yet dozens of display frames.
const FRAME_MS = 16
const FRAMES = 30

/** The player-prop picture drawn on each rAF frame (one player prop per frame). */
const framePics: number[] = []

beforeAll(async () => {
  await import('../src/main')
  let t = 0
  for (let i = 0; i < FRAMES; i++) {
    const cb = rafCb
    expect(cb, 'the cockpit must schedule the next frame').not.toBeNull()
    rafCb = null
    rec.playerPics.length = 0
    rec.enemyCalls.length = 0
    t += FRAME_MS
    cb!(t)
    // Exactly one player prop is drawn per rendered frame; record its picture.
    framePics.push(rec.playerPics.length > 0 ? rec.playerPics[rec.playerPics.length - 1] : -1)
  }
})

afterAll(() => { Date.now = realNow })

describe('rb4-9 AC-1 — the player prop is DRAWN every display frame (it exists at all)', () => {
  it('draws exactly one player prop on every rendered rAF frame', () => {
    expect(framePics).toHaveLength(FRAMES)
    expect(framePics.every((p) => p >= 0), 'a frame drew NO player prop — the blade is missing').toBe(true)
  })

  it('cycles through all three blade pictures over the run', () => {
    expect([...new Set(framePics)].sort()).toEqual([0, 1, 2])
  })
})

describe('rb4-9 AC-1 — the prop turns on the DISPLAY clock, not the calc clock (the ÷N trap)', () => {
  it('advances the picture on rAF frames where NO calc-frame ran', () => {
    // THE ASSERTION THE AC IS ABOUT. At 16 ms/frame most rAF frames run zero calc-frames
    // (the accumulator only crosses 96 ms every ~6th frame). A prop bound to the DISPLAY
    // clock still advances on those frames; a prop bound to `simFrame` stands still. So we
    // count how often the picture changes and prove it changes far more often than the sim ticks.
    let changes = 0
    for (let i = 1; i < framePics.length; i++) if (framePics[i] !== framePics[i - 1]) changes += 1

    // The sim ticked this many times over the whole run — the calc clock's budget of advances.
    const calcFrames = rec.calcFrames
    expect(calcFrames, 'the sim must have ticked (else nothing to contrast against)').toBeGreaterThan(2)

    // A DISPLAY-clock prop changes on (almost) every rAF frame: 0→1→2→0 differs each step.
    expect(
      changes,
      `the player prop changed picture only ${changes}× across ${FRAMES} display frames — ` +
        `a prop cycling 0→1→2→0 on the DISPLAY clock changes nearly every frame`,
    ).toBeGreaterThanOrEqual(FRAMES - 3)

    // AND it out-runs the calc clock by a wide margin — the ÷N discriminator. A prop wrongly
    // ticked off `simFrame` would change at most `calcFrames` times (~6× fewer).
    expect(
      changes,
      `the prop advanced ${changes}× but the sim only ticked ${calcFrames}× — a prop on the ` +
        `calc clock cannot change more often than the sim. This prop is NOT on the display clock.`,
    ).toBeGreaterThan(calcFrames * 2)
  })
})

describe('rb4-9 AC-2 — the enemy plane grows its transcribed propeller too', () => {
  it('draws an enemy prop (propSegments at a plane MVP) once a wave is on screen', () => {
    // Anti-vacuity: a wave must actually have spawned and been drawn, or there was no plane
    // to grow a prop on and this proves nothing.
    expect(rec.enemyDraws, 'no enemy plane was ever drawn — AC-2 would be vacuous').toBeGreaterThan(0)
    expect(
      rec.enemyCalls.length,
      'planes flew with a bare nose — the enemy propeller (topology already transcribed) is not rendered',
    ).toBeGreaterThan(0)
  })
})

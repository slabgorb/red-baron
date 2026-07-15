// tests/ground-collision-wiring.test.ts
//
// Story rb4-4 — RED phase (TEA). AC-3, the WIRING half: the GREND check is DRIVEN
// from the booted loop. The ROM consults the ground-collision state EVERY calc
// frame, BEFORE the playfield moves (`BIT GREND / BVS 20$ ;PLAYER RAN INTO
// GROUND` ahead of `JSR PFMOTN`, RBARON.MAC:783-785); the point test itself
// (PLYCOL, :3946-3991) runs while mountains are up and close (:4634-4641).
//
// The predicate's CONTRACT (gate, lane, altitude, totality) is pinned in
// tests/core/ground-collision.test.ts. THIS file boots the real cockpit, holds
// fire so the opening lone plane dies early (seed 12345, probe-calibrated kill at
// ~calc frame 7), lets the MODECT schedule enter its ground slot (the probe saw
// the ground interval between the frame-7 kill and the frame-31 second wave), and
// asserts the sim actually CONSULTS core/ground-collision while the mountains
// are up. A predicate nobody calls is returning-ace.ts all over again.
//
// (The full fly-into-a-mountain death cannot be staged hands-off today: the
// SCAPE silhouette units and the I4YPOS eye only meet through the projection
// that rb4-5 is rewriting — see the Delivery Finding. The kill-chain semantics
// are unit-pinned in eol-sequence + ground-collision; the DRIVE is pinned here.)

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { bootCockpit } from './helpers/boot-cockpit'
import type { Mountain } from '../src/core/landscape'

const rec = vi.hoisted(() => ({
  frame: 0,
  calls: [] as Array<{ frame: number; mountains: number }>,
  groundFrames: new Set<number>(),
  reset(): void {
    this.frame = 0
    this.calls = []
    this.groundFrames = new Set()
  },
}))

vi.mock('../src/core/ground-collision', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/core/ground-collision')>()
  return {
    ...real,
    groundCollision(eyeHeight: number, mountains: readonly Mountain[]): boolean {
      rec.calls.push({ frame: rec.frame, mountains: mountains.length })
      return real.groundCollision(eyeHeight, mountains)
    },
  }
})

// Watch the landscape to know WHEN the ground wave is actually up (delegating tap).
vi.mock('../src/core/landscape', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/core/landscape')>()
  return {
    ...real,
    stepMountain(m: Mountain): Mountain {
      rec.groundFrames.add(rec.frame)
      return real.stepMountain(m)
    },
  }
})

vi.mock('../src/shell/audio', () => ({
  createAudioEngine: () => ({
    resume: () => {},
    play: () => {},
    playTone: () => {},
    setEngine: () => {},
    setGun: () => {},
    setApproach: () => {},
  }),
}))

const SEED_MS = 12345

beforeAll(async () => {
  rec.reset()
  const cockpit = await bootCockpit(1600, 900, SEED_MS)
  cockpit.pressKey(' ') // the early kill clears the sky and lets the MODECT ground slot arrive
  for (let f = 1; f <= 150; f++) {
    rec.frame = f
    cockpit.tick()
  }
}, 30000)

afterAll(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AC-3 wiring: the booted sim consults the ground-collision check', () => {
  it('the staging holds: a ground wave actually ran (mountains stepped — this suite is not vacuous)', () => {
    expect(
      rec.groundFrames.size,
      'no mountain ever stepped — the MODECT ground slot never arrived; the staging broke',
    ).toBeGreaterThan(0)
  })

  it('groundCollision is CALLED from the loop — a predicate nobody calls is dead code', () => {
    expect(
      rec.calls.length,
      'core/ground-collision was never consulted by the booted cockpit — GREND is unwired',
    ).toBeGreaterThan(0)
  })

  it('…on every ground-wave calc frame (the ROM checks before every PFMOTN, :783-785)', () => {
    const consulted = new Set(rec.calls.map((c) => c.frame))
    const missed = [...rec.groundFrames].filter((f) => !consulted.has(f))
    expect(
      missed,
      `mountains were up on ${rec.groundFrames.size} calc frames but the collision check ` +
        `skipped ${missed.length} of them — a mountain you only sometimes test is a mountain ` +
        'you can sometimes fly through',
    ).toHaveLength(0)
  })

  it('…and with the LIVE mountains in hand, not an empty list', () => {
    const groundCalls = rec.calls.filter((c) => rec.groundFrames.has(c.frame))
    expect(groundCalls.some((c) => c.mountains > 0)).toBe(true)
  })
})

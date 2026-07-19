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
// fire to shoot down the opening plane RUN, and lets the MODECT/NEWCT schedule
// enter its first ground slot — then asserts the sim actually CONSULTS
// core/ground-collision while the mountains are up. A predicate nobody calls is
// returning-ace.ts all over again.
//
// rb4-7 RE-STAGE: the wave clock now counts WAVES, not calc frames, so the game
// opens with a RUN of MCOUNT[0] = 4 plane waves (MODECT 0) before the first GROUND
// slot (MODECT 1) — not the old 1:1 plane/ground alternation that put a ground wave
// right after the first kill. So this suite must clear the whole opening run before
// the ground slot arrives. Seed 444 (probe-selected) fields a run the held trigger
// clears, entering the ground slot at ~calc frame 107 where the mountains rise; the
// window is 220 calc frames to hold it. (Seed 12345's run stalls under fixed-forward
// fire — a multi-plane wave the un-aimed trigger cannot finish — so it never reaches
// a ground slot now; 444 is the replacement that does.)
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
    stepMountain(m: Mountain, playerDX: number): Mountain {
      rec.groundFrames.add(rec.frame)
      return real.stepMountain(m, playerDX)
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

const SEED_MS = 3 // rb4-15 re-stage: seed whose opening RUN the FEATHERED trigger clears (~f95 ground)

beforeAll(async () => {
  rec.reset()
  const cockpit = await bootCockpit(1600, 900, SEED_MS)
  for (let f = 1; f <= 220; f++) {
    rec.frame = f
    // rb4-15 re-stage: FEATHER the trigger (6 on / 6 off). The old held trigger (seed 444)
    // relied on the drifter-era airship shooting the pilot — the death sequence cools
    // GUN.ST — to un-jam a gun that locks out permanently at ~f31 under a constant hold;
    // the approaching airship spawns behind the N.PLNZ gate, so the opening run is
    // blimp-free and the pilot must manage the heat instead.
    if (f % 12 === 1) cockpit.pressKey(' ')
    if (f % 12 === 7) cockpit.releaseKey(' ')
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

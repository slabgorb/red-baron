// tests/mountain-scroll-wiring.test.ts
//
// Story rb4-8 — RED phase (Furiosa / TEA). The "keep the sneaky dev honest" half of
// AC-3. tests/core/mountain-scroll.test.ts proves stepMountain(m, playerDX) pans a
// fallen mountain's X when it is HANDED a delta — but that is worthless if main.ts
// never HANDS it one. The headline symptom the story exists to kill — "the world
// feels static" — is exactly this wiring gap: main.ts:566 is `mountains.map(stepMountain)`,
// which under the new REQUIRED-arg signature would pass the map INDEX, not the pilot's
// PLYRDL. A `stepMountain(m, 0)` would pass the pure suite and leave the world frozen.
//
// So this file proves the delta is REAL end-to-end. Two guards:
//   1. STRUCTURAL (source text): the bare static `.map(stepMountain)` is gone and the
//      call takes a real second argument (not the literal 0).
//   2. BEHAVIOURAL (booted loop): boot the real cockpit and clear the opening plane RUN
//      to reach a GROUND wave (seed 444 staging, shared with ground-collision-wiring and
//      re-validated by rb4-7). On a ground frame the loop steps all four mountain slots,
//      and every slot must receive the SAME per-frame delta — the one global PLYRDL. The
//      bare `mountains.map(stepMountain)` instead hands each slot the map INDEX (0,1,2,3),
//      so the deltas differ: that split is the static-world wiring bug, caught here without
//      depending on a turn (the ground wave is only ~3 frames — RBARON's brief ground slot).

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { bootCockpit } from './helpers/boot-cockpit'
import type { Mountain } from '../src/core/landscape'

// ─── 1. STRUCTURAL: the delta is wired into the loop, the static bare-map is gone ────

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mainText = ((): string => {
  try {
    return readFileSync(join(root, 'src', 'main.ts'), 'utf8')
  } catch {
    return ''
  }
})()

describe('rb4-8 wiring (structural) — main.ts hands stepMountain a real per-frame delta', () => {
  it('main.ts is non-empty', () => {
    expect(mainText.length).toBeGreaterThan(0)
  })

  it('the STATIC bare `mountains.map(stepMountain)` is gone — that call froze the world', () => {
    expect(/\.map\(\s*stepMountain\s*\)/.test(mainText)).toBe(false)
  })

  it('stepMountain is invoked with a SECOND argument (the player delta), and it is not the literal 0', () => {
    // The call must carry a delta expression. `stepMountain(m, 0)` is still a static world.
    expect(/stepMountain\s*\(\s*[^,()]+,\s*[^)]+\)/.test(mainText)).toBe(true)
    expect(/stepMountain\s*\(\s*[^,()]+,\s*0\s*\)/.test(mainText)).toBe(false)
  })
})

// ─── 2. BEHAVIOURAL: a booted, banking cockpit actually scrolls a live mountain ───────

const rec = vi.hoisted(() => ({
  frame: 0,
  // every stepMountain call: the calc frame it ran on and the delta it was handed
  calls: [] as Array<{ frame: number; delta: number }>,
  reset(): void {
    this.frame = 0
    this.calls = []
  },
}))

// Tap stepMountain: record the calc frame and the delta the loop hands each mountain.
// Delegates to the real implementation unchanged.
vi.mock('../src/core/landscape', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/core/landscape')>()
  return {
    ...real,
    stepMountain(m: Mountain, playerDX: number): Mountain {
      rec.calls.push({ frame: rec.frame, delta: playerDX })
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

const SEED_MS = 444 // rb4-7: the opening plane RUN this held trigger clears, reaching a ground slot

beforeAll(async () => {
  rec.reset()
  const cockpit = await bootCockpit(1600, 900, SEED_MS)
  cockpit.pressKey(' ') // hold fire through the opening run; neutral yoke keeps the seed-444 clear
  for (let f = 1; f <= 140; f++) {
    rec.frame = f
    cockpit.tick()
  }
}, 30000)

afterAll(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('rb4-8 wiring (behavioural) — one global PLYRDL reaches every mountain', () => {
  // Group the recorded calls by calc frame. A frame that steps ≥2 mountains is the probe:
  // the loop must hand them all the SAME delta.
  const framesWithMulti = (): Array<{ frame: number; deltas: number[] }> => {
    const byFrame = new Map<number, number[]>()
    for (const c of rec.calls) byFrame.set(c.frame, [...(byFrame.get(c.frame) ?? []), c.delta])
    return [...byFrame.entries()].map(([frame, deltas]) => ({ frame, deltas })).filter((g) => g.deltas.length >= 2)
  }

  it('the staging holds: a ground wave stepped ≥2 mountains in some frame (not vacuous)', () => {
    expect(
      framesWithMulti().length,
      'no calc frame stepped two mountains — the ground slot never seeded the 4-slot fleet; staging broke',
    ).toBeGreaterThan(0)
  })

  it('every mountain in a frame gets ONE global delta — not the map index (0,1,2,3)', () => {
    // Bare `mountains.map(stepMountain)` hands slot k its index k, so a 4-slot frame shows
    // deltas [0,1,2,3] — four different values. Correct wiring passes the single per-frame
    // PLYRDL to all four. Assert every multi-mountain frame handed out exactly one distinct delta.
    const split = framesWithMulti().filter((g) => new Set(g.deltas).size !== 1)
    expect(
      split,
      'a ground frame handed its mountains different deltas — main.ts is passing the map index, ' +
        'not the player pan; the world stays static',
    ).toEqual([])
  })
})

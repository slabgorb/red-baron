// tests/ground-target-wiring.test.ts
//
// Story rb4-11 — RED phase (Imperator Furiosa / TEA). The "keep the sneaky dev honest"
// integration guard: the pure deploy machine (tests/core/ground-targets.test.ts) is
// worthless if main.ts never wires it into the cockpit loop. rb4-7 left the ground wave
// as an EMPTY placeholder — `grndct = Math.max(0, grndct - 1)` burned one target-group
// per calc frame with no object ever deployed, and `groundModeEnds(grndct, 0)` hardcoded
// the visible-object count to 0 (main.ts said so itself: "Ground OBJECTS and the GTIMER
// that paces GRNDCT land in rb4-11").
//
// This suite pins that rb4-11 actually landed:
//   • structurally — the placeholder decrement and the literal-0 visible count are GONE,
//     and main.ts imports the ground-targets module;
//   • behaviourally — a booted cockpit driven to a REAL ground wave (the shared seed-444
//     staging, as mountain-scroll-wiring/ground-collision-wiring) deploys exactly
//     GRNDCT_INITIAL = 2 target-groups (AC-3, INITGR RBARON.MAC:1403-1404) and DRAWS a
//     full 3-target group (AC-2 — "ground targets appear in ground waves").

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { bootCockpit } from './helpers/boot-cockpit'

// ─── 1. STRUCTURAL: the placeholder is gone, the machine is imported ─────────────────

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mainText = ((): string => {
  try {
    return readFileSync(join(root, 'src', 'main.ts'), 'utf8')
  } catch {
    return ''
  }
})()

describe('rb4-11 wiring (structural) — main.ts runs the deploy machine, not the placeholder', () => {
  it('main.ts is non-empty', () => {
    expect(mainText.length).toBeGreaterThan(0)
  })

  it('imports the ground-targets machine', () => {
    expect(/from\s+['"]\.\/core\/ground-targets['"]/.test(mainText)).toBe(true)
  })

  it('the rb4-7 placeholder — one group burned per frame — is gone', () => {
    // `grndct = Math.max(0, grndct - 1)` decremented GRNDCT on a frame CADENCE. The ROM
    // spends a group only when a DEPLOY happens (DEC GRNDCT, RBARON.MAC:3432).
    expect(/grndct\s*=\s*Math\.max\(\s*0\s*,\s*grndct\s*-\s*1\s*\)/.test(mainText)).toBe(false)
  })

  it('groundModeEnds no longer hardcodes ZERO visible objects', () => {
    // The end condition is `GRNDCT spent AND no ground object visible` (PFOBMN,
    // RBARON.MAC:3269-3293). With objects real, the literal 0 is a lie that ends the
    // wave while targets are still on screen.
    expect(/groundModeEnds\s*\(/.test(mainText)).toBe(true)
    expect(/groundModeEnds\s*\(\s*grndct\s*,\s*0\s*\)/.test(mainText)).toBe(false)
  })
})

// ─── 2. BEHAVIOURAL: a booted cockpit deploys and draws ground targets ───────────────

const rec = vi.hoisted(() => ({
  frame: 0,
  gates: [] as Array<{ frame: number }>,
  deploys: [] as Array<{ frame: number; group: unknown }>,
  draws: [] as Array<{ frame: number; count: number }>,
  reset(): void {
    this.frame = 0
    this.gates = []
    this.deploys = []
    this.draws = []
  },
}))

// Tap the deploy machine, delegating to the real implementation unchanged. The module is
// CREATED by this story, so the factory stays untyped (`typeof import(...)` of a module
// that does not exist yet would fail tsc): pre-GREEN main.ts never imports it, the factory
// never runs, and every recorder below stays empty — that emptiness IS the RED.
vi.mock('../src/core/ground-targets', async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>
  return {
    ...real,
    deployGate(...args: unknown[]) {
      rec.gates.push({ frame: rec.frame })
      return (real.deployGate as (...a: unknown[]) => unknown)(...args)
    },
    deployGroup(...args: unknown[]) {
      rec.deploys.push({ frame: rec.frame, group: args[0] })
      return (real.deployGroup as (...a: unknown[]) => unknown)(...args)
    },
    groundTargetSegments(...args: unknown[]) {
      const targets = args[0]
      rec.draws.push({ frame: rec.frame, count: Array.isArray(targets) ? targets.length : -1 })
      return (real.groundTargetSegments as (...a: unknown[]) => unknown)(...args)
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

const SEED_MS = 3 // rb4-15 re-stage: the shared staging seed — the FEATHERED trigger clears the RUN
const FRAMES = 280 //  ... reaches the ground slot ~f95 (shared with mountain-scroll-wiring);
//                     280 leaves the deploy machine dozens of calc-frames of mountain
//                     events (4 mountains step every calc frame) — but is far too short
//                     for the NEXT ground slot (a full plane RUN + wrecks must clear first),
//                     so every recorded deploy below belongs to ONE ground wave
//                     (verified in the rb4-15 re-stage hunt: deploys stay exactly 2 at 280).

beforeAll(async () => {
  rec.reset()
  const cockpit = await bootCockpit(1600, 900, SEED_MS)
  for (let f = 1; f <= FRAMES; f++) {
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

describe('rb4-11 wiring (behavioural) — the ground wave deploys and draws its targets', () => {
  it('the deploy gate runs during the ground wave — the machine is in the loop', () => {
    expect(
      rec.gates.length,
      'deployGate was never called: main.ts does not drive core/ground-targets',
    ).toBeGreaterThan(0)
  })

  it('AC-3: exactly TWO target-groups deploy — GRNDCT_INITIAL spent, and never a third', () => {
    // INITGR arms GRNDCT=2 (RBARON.MAC:1403-1404); each deploy is DEC GRNDCT (:3432); the
    // spent gate (LDA GRNDCT / BEQ, :3430-3431) forbids a third. The budget comment above
    // is why a second ground wave cannot pollute this count.
    expect(rec.deploys).toHaveLength(2)
  })

  it('every deployed group index is one of the four RANDOM AND 3 groups', () => {
    for (const d of rec.deploys) {
      expect(typeof d.group).toBe('number')
      expect(d.group).toBeGreaterThanOrEqual(0)
      expect(d.group).toBeLessThanOrEqual(3)
    }
  })

  it('AC-2: a FULL 3-target group is drawn — ground targets appear in ground waves', () => {
    const fullGroupDraws = rec.draws.filter((d) => d.count >= 3)
    expect(
      fullGroupDraws.length,
      'groundTargetSegments never drew a 3-target group: targets deploy but never appear',
    ).toBeGreaterThan(0)
  })

  it('no target is drawn BEFORE the first deploy — targets do not pre-exist their wave', () => {
    const firstDeployFrame = rec.deploys[0]?.frame ?? Infinity
    const early = rec.draws.filter((d) => d.count > 0 && d.frame < firstDeployFrame)
    expect(early).toHaveLength(0)
  })
})

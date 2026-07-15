// tests/determinism.test.ts
//
// Story rb4-3 — RED phase (Han Solo / TEA). AC-2 and AC-3, the behavioural proof.
//
//   AC-2  "One seeded Rng is threaded through the sim; the SHELL owns the seed and
//          passes it in. The same seed + the same inputs reproduce the same game,
//          pinned by a determinism test."
//   AC-3  "The determinism test fingerprints a full multi-wave run (enemy spawn
//          sides, blimp rolls, wave composition) and asserts two same-seed runs are
//          identical."
//
// ─── WHY A GREP (sim-clock-free.test.ts) IS NOT ENOUGH ───────────────────────────
// The @arcade/shared/rng generator is ALREADY seeded and ALREADY threaded through
// every core module (enemy/waves/blimp/returning-ace). Nothing here is about adding
// an Rng. The bug is that the SHELL (main.ts) seeds THREE separate streams from the
// wall clock — blimpRng, aceRng, and a fresh createRng((Date.now()+kills)) on EVERY
// wave — so no two games agree and same-seed regression tests (which the rest of
// epic rb4 needs) are impossible. A grep can be walked around; only the EFFECT ON
// WHAT THE PLAYER SEES cannot (cockpit-loop.test.ts, the same lesson, three times).
//
// ─── THE TRAP THIS FILE STEPS AROUND ─────────────────────────────────────────────
// "Two same-seed runs are identical" is VACUOUS if you make them identical by
// mocking Date.now() to a constant — which is exactly what tests/helpers/boot-
// cockpit.ts does (vi.spyOn(Date,'now')). Under that mock the CURRENT, broken code
// is already "deterministic". So this file must NOT pin the seed by freezing the
// clock. It pins TWO properties that no constant-clock run can fake:
//
//   1. DETERMINISM / clock-independence: same shell seed, DIFFERENT wall clock on
//      each run  →  byte-identical painted run.  (RED today: the sim reads the
//      clock, so a different clock is a different game.)
//   2. SEED SENSITIVITY (anti-vacuity): DIFFERENT shell seed, same wall clock  →  a
//      DIFFERENT run.  (RED today: the shell ignores the seed and reads the clock,
//      so both runs are identical.)  A frozen or empty run could never pass this —
//      it is the guard that the fingerprint has real RNG-driven content in it.
//
// ─── THE SHELL SEED SEAM (a proposal to Dev, see the Delivery Finding) ───────────
// AC-2 says the shell OWNS the seed and PASSES IT IN. For a no-backend browser game
// the replayable, shareable way to inject a seed is a URL param — asteroids already
// reads location.search for `?tune`, so this is an established fleet shell pattern,
// not an invention. This file injects `?seed=<n>`. Dev may relocate the seam
// (a global, an exported boot(seed), …) as long as it stays (a) shell-owned, (b)
// independent of the wall clock, and (c) test-injectable — updating ONLY `bootRun`'s
// injection line. The two ASSERTIONS below are the contract; the seam is negotiable.
import { describe, it, expect, vi, afterAll } from 'vitest'

// createAudioEngine() must not reach for a real AudioContext under vitest's node env
// (the fleet's standard boot mock — see dead-mechanics-wiring.test.ts).
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

afterAll(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

interface Stroke {
  readonly op: 'moveTo' | 'lineTo'
  readonly x: number
  readonly y: number
}

/** One display frame → a compact, comparable string of everything it painted. */
function fingerprintFrame(batches: Stroke[][], texts: string[]): string {
  const strokes = batches
    .map((b) => b.map((s) => `${s.op[0]}${Math.round(s.x)},${Math.round(s.y)}`).join(';'))
    .join('|')
  return `${texts.join('~')}#${strokes}`
}

/** The first index where two runs' painted frames diverge, or -1 if identical. */
function firstDivergence(a: readonly string[], b: readonly string[]): number {
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i
  return -1
}

/**
 * Boot src/main.ts against a fake DOM with a caller-chosen SHELL SEED (`?seed=`) and
 * a caller-chosen wall clock (`nowMs`), hold FIRE, drive `frames` calc frames, and
 * return the per-frame painted fingerprint. Seed and clock are set INDEPENDENTLY so
 * a test can vary one while holding the other — the whole point of this file.
 */
async function bootRun(opts: { seed: number; nowMs: number; frames: number }): Promise<string[]> {
  vi.resetModules()

  let batches: Stroke[][] = [[]]
  let texts: string[] = []
  const ctx = {
    beginPath: () => batches.push([]),
    moveTo: (x: number, y: number) => batches[batches.length - 1].push({ op: 'moveTo', x, y }),
    lineTo: (x: number, y: number) => batches[batches.length - 1].push({ op: 'lineTo', x, y }),
    stroke: () => {},
    fillRect: () => {},
    fillText: (t: string) => texts.push(t),
    save: () => {},
    restore: () => {},
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    shadowColor: '',
    shadowBlur: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
    globalAlpha: 1,
  }
  const width = 1600
  const height = 900
  const canvas = { width, height, clientWidth: width, clientHeight: height, getContext: () => ctx }

  // ── THE SHELL SEED SEAM: a URL param the shell reads and passes into the sim ──
  const location = { search: `?seed=${opts.seed}`, href: `http://localhost/?seed=${opts.seed}` }
  const keydownHandlers: Array<(e: unknown) => void> = []
  const keyupHandlers: Array<(e: unknown) => void> = []
  let rafCallback: ((nowMs: number) => void) | null = null
  vi.stubGlobal('document', { getElementById: () => canvas })
  vi.stubGlobal('location', location)
  vi.stubGlobal('window', {
    innerWidth: width,
    innerHeight: height,
    location,
    addEventListener: (event: string, cb: (e: unknown) => void) => {
      if (event === 'keydown') keydownHandlers.push(cb)
      if (event === 'keyup') keyupHandlers.push(cb)
    },
    removeEventListener: () => {},
    requestAnimationFrame: (cb: (nowMs: number) => void) => {
      rafCallback = cb
      return 1
    },
  })
  // The wall clock the shell must NOT let leak into the sim.
  vi.spyOn(Date, 'now').mockReturnValue(opts.nowMs)

  await import('../src/main')
  if (rafCallback === null) throw new Error('main.ts never scheduled a frame — the cockpit did not boot')
  const frame = rafCallback as (nowMs: number) => void

  // Hold FIRE for the whole run so waves are cleared and re-spawned — a MULTI-WAVE
  // run (spawn sides, blimp rolls, wave composition), not one hovering wave.
  for (const h of keydownHandlers) h({ key: ' ', repeat: false, preventDefault: () => {} })

  const out: string[] = []
  let nowMs = 0
  for (let f = 0; f < opts.frames; f++) {
    batches = [[]]
    texts = []
    nowMs += 96 // one calc frame (SIM_TIMESTEP_S), below main.ts's 250 ms catch-up cap
    frame(nowMs)
    out.push(fingerprintFrame(batches, texts))
  }
  return out
}

// ~57 s of game time at the 96 ms calc frame — long enough for several plane waves
// to clear and re-spawn and for the ~25 % BLMOTN blimp roll to fire more than once.
const FRAMES = 600

describe('rb4-3 AC-2/AC-3 — the sim is deterministic from a shell-owned seed', () => {
  // ═══ DETERMINISM: same seed, DIFFERENT wall clock → identical run ═════════════
  // RED today: the sim seeds three Rng streams from Date.now(), so changing the
  // clock changes the game. GREEN once the shell owns the seed and the sim stops
  // reading the clock.
  it('the same seed reproduces the same game even when the wall clock differs', async () => {
    const seed = 0xc0ffee
    const runEarly = await bootRun({ seed, nowMs: 1_000_000, frames: FRAMES })
    const runLater = await bootRun({ seed, nowMs: 9_999_999, frames: FRAMES })

    expect(runEarly.length, 'run produced no frames — the cockpit did not fly').toBe(FRAMES)
    expect(runEarly.some((f) => f.length > 2), 'the run painted nothing — nothing to fingerprint').toBe(true)

    const at = firstDivergence(runEarly, runLater)
    expect(
      at,
      at < 0 ? '' : `same seed, but the two runs diverge at calc frame ${at} — the sim still reads the wall clock`,
    ).toBe(-1)
  }, 30_000)

  // ═══ RULE #4 (lang-review typescript §4): seed 0 is VALID, not "absent" ═══════
  // The trap this story invites: parsing `?seed=` with `Number(param) || Date.now()`.
  // Number("0") is 0 — falsy — so `|| Date.now()` discards a perfectly good seed and
  // silently falls back to the wall clock, un-fixing the bug for exactly one seed.
  // The correct read is nullish (`?? `) or an explicit `param !== null` test. Two
  // `?seed=0` runs under DIFFERENT clocks must still be identical. RED today (the
  // seed is ignored); it also stays RED against a `||` "fix", which is the point.
  it('seed 0 is honoured as a seed, not treated as absent (?? not ||)', async () => {
    const runA = await bootRun({ seed: 0, nowMs: 2_000_000, frames: FRAMES })
    const runB = await bootRun({ seed: 0, nowMs: 8_000_000, frames: FRAMES })
    const at = firstDivergence(runA, runB)
    expect(
      at,
      at < 0 ? '' : `?seed=0 diverges at calc frame ${at} — seed 0 was dropped as falsy (|| instead of ??) and the clock leaked in`,
    ).toBe(-1)
  }, 30_000)

  // ═══ SEED SENSITIVITY (anti-vacuity): different seed, same clock → different ═══
  // RED today: the shell ignores the injected seed and reads the clock, so both
  // runs are identical and this cannot pass. It is the guard that "identical" above
  // means "reproduced a real RNG-driven run", not "produced two empty/frozen runs".
  it('a different seed produces a different game (the fingerprint has real RNG content)', async () => {
    const clock = 5_000_000
    const runA = await bootRun({ seed: 0x1111_1111, nowMs: clock, frames: FRAMES })
    const runB = await bootRun({ seed: 0x2222_2222, nowMs: clock, frames: FRAMES })

    const at = firstDivergence(runA, runB)
    expect(
      at,
      'two different seeds produced the identical run — the shell is not honouring the seed (it is reading the clock)',
    ).toBeGreaterThanOrEqual(0)
  }, 30_000)
})

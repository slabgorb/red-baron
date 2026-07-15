// tests/sim-clock-free.test.ts
//
// Story rb4-3 — RED phase (Han Solo / TEA). AC-1, the grep tripwire.
//
//   "Zero calls to Date.now() / performance.now() / Math.random() remain anywhere
//    in src/core/ or in the sim-step path of src/main.ts. A test greps for them."
//
// THE ROM: RANDOM (RBARON.MAC:6193) is a pure software LFSR — no clock input. Our
// sim seeds its Rng from the wall clock in THREE places (all in main.ts today):
//   :334  blimpRng = createRng((Date.now() ^ 0x5e_ed) >>> 0)   — boot
//   :345  aceRng   = createRng((Date.now() ^ 0xace5) >>> 0)    — boot
//   :605  spawnWave(createRng((Date.now() + kills) >>> 0), …)  — INSIDE the calc-frame loop
// The last one re-reads the clock on EVERY wave, so no two games can ever agree —
// which is why same-seed replay and same-seed regression tests are impossible.
//
// ─── THIS GREP IS A TRIPWIRE, NOT THE PROOF ──────────────────────────────────────
// cockpit-loop.test.ts spent three rejections learning that "a regex can only ask
// what the code SAYS, while the bug is always what the code DOES." So this file is
// the cheap mechanical guard; the REAL proof that the sim no longer depends on the
// wall clock is the behavioural fingerprint in tests/determinism.test.ts (AC-2/3).
//
// WHAT AC-1 DOES vs DOES NOT forbid: the deterministic sim (all of core/) and the
// sim-step PATH of main.ts (the per-calc-frame work — preMotionFrame + frame) may
// never read a wall clock. A single fresh-game seed mint at the shell's BOOT is
// still allowed (battlezone/src/main.ts:110 does exactly one Date.now() at boot);
// the shell owns that entropy and passes the seed in. So the rule is: at most ONE
// wall-clock read in main.ts, and NONE in the step path.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const testsDir = dirname(fileURLToPath(import.meta.url))
const coreDir = join(testsDir, '..', 'src', 'core')
const mainFile = join(testsDir, '..', 'src', 'main.ts')

// The three wall-clock reads AC-1 forbids in the sim. (Match the CALL, `foo.now(`
// / `Math.random(`, so a bare mention like the interface name never trips it.)
const CLOCK_CALLS = ['Date.now(', 'performance.now(', 'Math.random(']

/**
 * Strip // line comments and block comments so a POST-FIX comment that mentions the
 * retired code ("we used to read Date.now() here") does not read as a live call.
 * The line-comment guard keeps `https://`-style `//` inside string literals intact —
 * good enough for this codebase, which puts no wall-clock token inside a string.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function clockCallCount(src: string): number {
  const code = stripComments(src)
  return CLOCK_CALLS.reduce((n, tok) => n + code.split(tok).length - 1, 0)
}

const coreFiles = readdirSync(coreDir).filter((f) => f.endsWith('.ts'))

describe('rb4-3 AC-1 — the deterministic sim reads no wall clock', () => {
  it('scans a non-empty core/ (the sweep must have teeth)', () => {
    expect(coreFiles.length).toBeGreaterThan(0)
  })

  // core/ is the pure deterministic sim — it is already clock-free, and this keeps
  // it that way. (A regression guard: green today, and it must stay green.)
  it.each(coreFiles)('src/core/%s makes no wall-clock call', (file) => {
    const code = stripComments(readFileSync(join(coreDir, file), 'utf8'))
    for (const tok of CLOCK_CALLS) {
      expect(code, `core/${file} must not call ${tok}…) — core is the deterministic sim`).not.toContain(tok)
    }
  })

  // HEADLINE (RED today ×3): the story's own title — "the sim seeds its RNG from
  // Date.now()". No Rng may be seeded from a wall clock; the seed is minted once and
  // threaded in.
  it('main.ts seeds no Rng directly from a wall clock (no createRng(…Date.now()…))', () => {
    const code = stripComments(readFileSync(mainFile, 'utf8'))
    expect(
      code,
      'a createRng() argument still reads the wall clock — the seed must be minted once and passed in',
    ).not.toMatch(/createRng\([^)]*(?:Date\.now|performance\.now|Math\.random)/)
  })

  // TEETH (RED today ×3): the shell may mint ONE fresh-game seed from entropy at
  // boot, no more. Three reads today (two boot + one per-wave) → this fails now.
  it('main.ts reads a wall clock at most once (a single fresh-game seed mint)', () => {
    const count = clockCallCount(readFileSync(mainFile, 'utf8'))
    expect(count, `main.ts makes ${count} wall-clock calls; the shell may mint at most one boot seed`).toBeLessThanOrEqual(1)
  })

  // TEETH (RED today ×1): the calc-frame path — preMotionFrame + frame — must be
  // pure. The :605 per-wave createRng((Date.now()+kills)) lives here today. A boot
  // seed mint belongs ABOVE these functions, in the shell's setup.
  it('the sim-step path (preMotionFrame + frame) makes no wall-clock call', () => {
    const src = readFileSync(mainFile, 'utf8')
    const stepStart = src.indexOf('function preMotionFrame(')
    expect(stepStart, 'could not locate the sim-step path (function preMotionFrame)').toBeGreaterThan(0)
    const stepPath = stripComments(src.slice(stepStart))
    for (const tok of CLOCK_CALLS) {
      expect(stepPath, `the per-calc-frame path must not call ${tok}…) — that is what makes the sim non-deterministic`).not.toContain(tok)
    }
  })
})

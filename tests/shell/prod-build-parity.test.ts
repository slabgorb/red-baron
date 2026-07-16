// tests/shell/prod-build-parity.test.ts
//
// Story rb4-1 — round 5. THE ARTIFACT THAT SHIPS IS NOT THE ONE THE SUITE RAN.
//
// ─── WHY THIS FILE EXISTS: A NEW HOLE, ONE AXIS OVER FROM THE LAST FOUR ──────────
//
// Rounds 1-4 closed the DRIFT class: a tracer arithmetic bug can no longer hide in a rename, a
// shadow, a dead call, a doctored argument, a rival renderer, or a poisoned despawn boolean. Every
// one of those guards runs the SAME code the player runs — because there was only ever one build.
//
// There is not. `npx vitest run` executes the source under Vite's DEV transform. `vite build` (what
// `just deploy` uploads to R2, what the player actually loads) runs a DIFFERENT transform: it
// STATICALLY REPLACES `import.meta.env.PROD` with `true`, `import.meta.env.DEV` with `false`,
// `import.meta.env.MODE` with `"production"`, `process.env.NODE_ENV` with `"production"`, and then
// constant-folds and dead-code-eliminates around them. So a bug can be gated on the build:
//
//     // src/main.ts, inside the tracer draw loop:
//     const s = import.meta.env.PROD ? { ...shell, z: shell.z / 8 } : shell
//     strokeSegments(shellSegments(s, projView), width, height)
//
// Under `vitest`, `import.meta.env.PROD` reads `false`, so `s === shell` (the live object): every
// drift guard sees the honest bullet and passes 860/860. `vite build` folds `PROD -> true`, collapses
// the ternary, and ships `{ ...shell, z: shell.z / 8 }` — every tracer drawn at 1/8 the depth it
// kills at, the EXACT rejected bug (tracer-seam.test.ts / cockpit-draw-path.test.ts), in the bytes
// R2 serves. `grep 'z:e.z/8' dist/assets/main-*.js` finds it. The suite never does, because the
// suite never runs the production transform.
//
// This is not drift. It is a TEST-VS-PRODUCTION DIVERGENCE, and the class is bigger than one flag:
// `import.meta.env.DEV`, `import.meta.env.MODE`, `import.meta.env.SSR`, `process.env.NODE_ENV`, or a
// `define`d global are all compile-time constants Vite folds one way for the suite and another for
// the artifact. Special-casing `PROD` would just move the bug to `DEV`. The class is closed here by
// RUNNING THE COCKPIT UNDER THE BUILD'S OWN SEMANTICS.
//
// ─── HOW: FLIP THE BUILD MODE IN-PROCESS, THEN RE-USE THE ROUND-4 MEASUREMENT ────
//
// Vitest keeps `import.meta.env.*` a LIVE runtime object (unlike `vite build`, which inlines it),
// so `vi.stubEnv('PROD', true)` makes `import.meta.env.PROD` read `true` for the module under test —
// exactly what the shipped bundle sees. We do NOT try to execute the minified `dist/` chunk in node:
// it drags in @arcade/shared's browser bootstrap (createElement / querySelectorAll / MutationObserver)
// and is a fragile thing to run under a fake DOM. Instead we run the SAME source main.ts the other
// guards run, twice — once with the env the suite sees (DEV), once with the env the build ships
// (PROD) — and demand they behave identically. Any `import.meta.env` / `process.env` gate in the
// draw path makes the two runs diverge, and the divergence is measured two independent ways:
//
//   1. ABSOLUTE (INVARIANT 1 + 3 from cockpit-draw-path, re-asked under PROD env): under production
//      build-mode the cockpit must STILL draw every tracer at `shellDepth(z)` — the depth it kills
//      at — and STILL hand the renderer the LIVE shell object, not a doctored copy. The gate above
//      draws the copy at z/8 and dies here.
//   2. RELATIVE (PARITY): the pixels the PROD run strokes are byte-identical to the pixels the DEV
//      run strokes. This needs no interpretation of geometry and covers the WHOLE draw path — the
//      planes, the airship, the wrecks, the horizon — not just the tracer. `{ ...shell, z: z/8 }`,
//      `-enemy.depth / 8` in the model matrix, a mode-gated `wrecks.map(...)` — all diverge here.
//
// The clock is pinned (main.ts seeds its RNGs off Date.now), so both runs fly the SAME sky and the
// parity is a fact about the code, not the weather.
//
// ─── THE LAYERING (read before deciding this is redundant) ──────────────────────
//
// tracer-seam / depth-scale / cockpit-draw-path prove the DEV run is honest, and they are immune to
// build mode (they call pure core directly or boot main.ts under the suite's own env). THIS file
// proves the PROD run equals the DEV run. Honest DEV + PROD==DEV ⇒ the artifact is honest. A bug
// present in BOTH builds (ungated) is not this file's job — it is caught by those three, in DEV,
// where they measure. This file owns exactly the seam they cannot see: the one between the two
// builds.

import { describe, it, expect, vi, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Mat4, Vec3 } from '@arcade/shared/math3d'
import type { SceneSegment } from '../../src/core/scene'
import { shellDepth, type Shell } from '../../src/core/guns'
import { P_INDP, type Enemy } from '../../src/core/enemy'

// ─────────────────────────────────────────────────────────────────────────────────
// THE INSTRUMENTS — the same two independent seams cockpit-draw-path taps, re-used here
// ─────────────────────────────────────────────────────────────────────────────────

interface ProjCall {
  readonly a: readonly number[]
  readonly b: readonly number[]
  readonly seg: SceneSegment | null
}
interface TracerDraw {
  readonly shell: Shell
  readonly from: number
  readonly to: number
}
interface GunStep {
  readonly shells: readonly Shell[]
  readonly targets: readonly Enemy[]
  readonly hits: number
}

const rec = vi.hoisted(() => ({
  proj: [] as ProjCall[],
  tracers: [] as TracerDraw[],
  gunSteps: [] as GunStep[],
}))

// Sound is not geometry — stub the engine so no AudioContext is ever needed (same as
// cockpit-draw-path); the real audio-dispatch still runs, keeping the loop's shape honest.
vi.mock('../../src/shell/audio', () => ({
  createAudioEngine: () => ({
    resume: () => {}, play: () => {}, playTone: () => {},
    setEngine: () => {}, setGun: () => {}, setApproach: () => {},
  }),
}))

// THE ONE GATE every vector passes through, in WORLD space before the perspective divide hides depth.
vi.mock('../../src/core/scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/scene')>()
  return {
    ...actual,
    projectSegment: (a: Vec3, b: Vec3, mvp: Mat4): SceneSegment | null => {
      const seg = actual.projectSegment(a, b, mvp)
      rec.proj.push({ a: [...a], b: [...b], seg })
      return seg
    },
  }
})

// THE COLLISION ARM — its output is the live shell pool the cockpit is about to draw; its input is
// the live target list. The expected depth comes from here, never from the render code.
vi.mock('../../src/core/guns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/guns')>()
  return {
    ...actual,
    // rb4-6: forward the display-space EYE (see cockpit-draw-path.test.ts's note) — a passthrough
    // that re-declares the signature silently drops any argument the real gun later grows.
    step: (guns: Parameters<typeof actual.step>[0], targets: readonly Enemy[], eye: Vec3) => {
      const out = actual.step(guns, targets, eye)
      rec.gunSteps.push({ shells: out.guns.shells, targets, hits: out.hits.length })
      return out
    },
    shellSegments: (shell: Shell, mvp: Mat4): readonly SceneSegment[] => {
      const from = rec.proj.length
      const segs = actual.shellSegments(shell, mvp)
      rec.tracers.push({ shell, from, to: rec.proj.length })
      return segs
    },
  }
})

// ─────────────────────────────────────────────────────────────────────────────────
// THE SYNTHETIC COCKPIT — installed fresh per boot, because main.ts re-runs each time
// ─────────────────────────────────────────────────────────────────────────────────

const WIDTH = 1600
const HEIGHT = 900
const FIXED_NOW = 1_700_000_000_000
const FRAME_MS = 200
const FRAMES = 24
const realNow = Date.now

interface PixelSeg {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

interface FrameRecord {
  readonly proj: readonly ProjCall[]
  readonly tracers: readonly TracerDraw[]
  readonly strokes: readonly PixelSeg[]
  readonly live: GunStep
  readonly stepped: boolean
}

interface BootResult {
  readonly frames: readonly FrameRecord[]
  /** Every pixel stroked over the whole run, in order — the parity fingerprint. */
  readonly strokes: readonly PixelSeg[]
}

let strokes: PixelSeg[] = []
let pen: { x: number; y: number } | null = null
let listeners = new Map<string, ((e: unknown) => void)[]>()
let rafCb: ((t: number) => void) | null = null

function installStubs(): void {
  strokes = []
  pen = null
  listeners = new Map()
  rafCb = null
  const ctxStub = {
    fillStyle: '', strokeStyle: '', lineWidth: 0, shadowColor: '', shadowBlur: 0,
    font: '', textAlign: '', textBaseline: '',
    beginPath(): void {},
    moveTo(x: number, y: number): void { pen = { x, y } },
    lineTo(x: number, y: number): void {
      if (pen !== null) strokes.push({ x1: pen.x, y1: pen.y, x2: x, y2: y })
      pen = { x, y }
    },
    stroke(): void {}, fillRect(): void {}, fillText(): void {}, save(): void {}, restore(): void {},
  }
  const canvasStub = { width: 0, height: 0, clientWidth: WIDTH, clientHeight: HEIGHT, getContext: () => ctxStub }
  const windowStub = {
    innerWidth: WIDTH, innerHeight: HEIGHT,
    addEventListener: (type: string, fn: (e: unknown) => void): void => {
      const list = listeners.get(type) ?? []
      list.push(fn)
      listeners.set(type, list)
    },
    requestAnimationFrame: (cb: (t: number) => void): number => { rafCb = cb; return 1 },
  }
  const g = globalThis as unknown as Record<string, unknown>
  g.document = { getElementById: (): unknown => canvasStub }
  g.window = windowStub
}

const fire = (): void => {
  for (const fn of listeners.get('keydown') ?? []) {
    fn({ key: ' ', repeat: false, preventDefault: () => {} })
  }
}

/**
 * Boot a FRESH main.ts (vi.resetModules re-executes the module body and every @arcade/shared import
 * against the current env), hold the trigger, and record the whole run. Called under DEV env, then
 * under PROD env — the ONLY difference between the two calls is `import.meta.env` / `process.env`.
 */
async function boot(): Promise<BootResult> {
  installStubs()
  vi.resetModules()
  Date.now = () => FIXED_NOW
  try {
    await import('../../src/main') // module body: resize(), listeners, first rAF
    const frames: FrameRecord[] = []
    const allStrokes: PixelSeg[] = []
    let live: GunStep = { shells: [], targets: [], hits: 0 }
    let t = 0
    for (let i = 0; i < FRAMES; i++) {
      fire()
      const cb = rafCb
      expect(cb, 'the cockpit must have scheduled the next frame').not.toBeNull()
      rafCb = null
      rec.proj.length = 0
      rec.tracers.length = 0
      rec.gunSteps.length = 0
      strokes = []
      t += FRAME_MS
      cb!(t)
      const stepped = rec.gunSteps.length > 0
      if (stepped) live = rec.gunSteps[rec.gunSteps.length - 1]
      frames.push({
        proj: [...rec.proj],
        tracers: [...rec.tracers],
        strokes: [...strokes],
        live,
        stepped,
      })
      allStrokes.push(...strokes)
    }
    return { frames, strokes: allStrokes }
  } finally {
    Date.now = realNow
  }
}

// The build ships these values; the suite defaults to the opposite of each. Flipping ALL of them
// makes the run match `vite build`'s semantics regardless of which flag a gate happens to read.
function stubProductionEnv(): void {
  vi.stubEnv('PROD', true) // vitest types PROD/DEV/SSR as boolean, MODE/NODE_ENV as string
  vi.stubEnv('DEV', false)
  vi.stubEnv('MODE', 'production')
  vi.stubEnv('SSR', false)
  vi.stubEnv('NODE_ENV', 'production')
}

// ─────────────────────────────────────────────────────────────────────────────────
// THE RUNS — DEV (what the suite sees) and PROD (what the build ships), one sky each
// ─────────────────────────────────────────────────────────────────────────────────

let dev: BootResult
let prod: BootResult

beforeAll(async () => {
  dev = await boot() // default env — this is the run every OTHER guard is implicitly measuring
  stubProductionEnv()
  try {
    prod = await boot() // the same source, under the build's own compile-time constants
  } finally {
    vi.unstubAllEnvs()
  }
})

// ─────────────────────────────────────────────────────────────────────────────────
// NOT VACUOUS — the PROD run must actually fly, or every assertion below checks nothing
// ─────────────────────────────────────────────────────────────────────────────────

describe('the PROD-mode cockpit booted, flew, and fired (this suite is not vacuous)', () => {
  it('is running under the build\'s own env — PROD true, DEV false, MODE production', () => {
    // Prove the mechanism itself works: if vitest ever statically inlined import.meta.env (as the
    // build does), stubEnv would be a no-op and this whole file would silently test DEV twice.
    stubProductionEnv()
    try {
      expect(import.meta.env.PROD, 'stubEnv must flip PROD, or PROD-mode is never exercised').toBe(true)
      expect(import.meta.env.DEV).toBe(false)
      expect(import.meta.env.MODE).toBe('production')
      expect(import.meta.env.PROD ? 'prod' : 'dev', 'a live ternary must take the prod arm').toBe('prod')
    } finally {
      vi.unstubAllEnvs()
    }
    expect(import.meta.env.PROD, 'and unstub must restore the suite\'s DEV env').toBe(false)
  })

  it('drew every frame, stepped the sim, and put live shells in the air', () => {
    expect(prod.frames).toHaveLength(FRAMES)
    expect(prod.frames.every((f) => f.strokes.length > 0), 'every frame must stroke vectors').toBe(true)
    expect(prod.frames.some((f) => f.stepped), 'the sim must have ticked').toBe(true)
    const armed = prod.frames.filter((f) => f.live.shells.length > 0)
    expect(armed.length, 'the trigger was held — shells must be in flight').toBeGreaterThan(10)
    expect(
      Math.max(...armed.flatMap((f) => f.live.shells.map((s) => shellDepth(s.z)))),
      'a shell must reach past the plane spawn depth, where this story lives',
    ).toBeGreaterThanOrEqual(P_INDP)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────
// ABSOLUTE — under the build's semantics, the tracer is STILL where the kill is
// ─────────────────────────────────────────────────────────────────────────────────

describe('INVARIANT 1 (under PROD) — every tracer is projected at the depth it kills at', () => {
  it('the shipped build draws each live shell at shellDepth(z), not at a mode-gated fraction', () => {
    // Identical measurement to cockpit-draw-path INVARIANT 1, but on the PROD-env run. The
    // `import.meta.env.PROD ? { ...shell, z: shell.z / 8 } : shell` gate projects the nose at
    // shellDepth(z / 8) here (where the DEV run drew shellDepth(z)) and lands as an 8x divergence.
    const divergences: string[] = []
    let measured = 0
    for (const [i, f] of prod.frames.entries()) {
      // main.ts draws exactly one tracer per live shell, in order, so tracer[k] is shell[k]. Match
      // by POSITION, not identity — identity is INVARIANT 3's job, and matching by identity here
      // would make a doctored COPY (which is a different object) simply vanish from the depth check
      // instead of failing it. When the counts disagree, INVARIANT 3 owns that; skip the frame.
      if (f.tracers.length !== f.live.shells.length) continue
      for (const [k, shell] of f.live.shells.entries()) {
        const draw = f.tracers[k]
        const calls = f.proj.slice(draw.from, draw.to)
        if (calls.length !== 1) continue
        measured += 1
        const killDepth = shellDepth(shell.z)
        const drawnNose = -calls[0].a[2] // the front world-space endpoint the cockpit projected
        if (Math.abs(drawnNose - killDepth) > 1e-6) {
          divergences.push(
            `frame ${i}: shell z=${shell.z} KILLS at ${killDepth} but the PRODUCTION build draws ` +
              `its tracer at ${drawnNose} (${(killDepth / drawnNose).toFixed(2)}x).`,
          )
        }
      }
    }
    expect(measured, 'no tracer was measured under PROD env — the run put no shells on screen').toBeGreaterThan(20)
    expect(
      divergences,
      'THE PRODUCTION BUILD DRAWS THE BULLET SOMEWHERE OTHER THAN WHERE IT KILLS.\n\n' +
        'The suite is green because `npx vitest run` executes the DEV transform, where a ' +
        '`import.meta.env.PROD ? ... : ...` gate takes the honest arm. `vite build` folds PROD to ' +
        'true and ships the other arm. Draw geometry must not depend on the build mode.\n',
    ).toEqual([])
  })
})

describe('INVARIANT 3 (under PROD) — the shipped build draws the bullets it simulates', () => {
  it('shellSegments is called with the LIVE shell object, not a mode-gated copy', () => {
    // `{ ...shell, z: shell.z / 8 }` is a NEW object: the tracer draw's shell is no longer the one
    // the collision arm is flying. Reference identity is the negation of the whole attack class.
    const faults: string[] = []
    let checked = 0
    for (const [i, f] of prod.frames.entries()) {
      const drawn = f.tracers.map((d) => d.shell)
      if (drawn.length !== f.live.shells.length) {
        faults.push(`frame ${i}: ${f.live.shells.length} shells in flight but ${drawn.length} tracers drawn`)
        continue
      }
      for (const shell of f.live.shells) {
        checked += 1
        if (!drawn.some((d) => Object.is(d, shell))) {
          faults.push(
            `frame ${i}: the PRODUCTION build drew a shell that is NOT the one the sim is flying — ` +
              `a mode-gated copy (live z=${shell.z}).`,
          )
        }
      }
    }
    expect(checked, 'no shell was drawn under PROD env — the guard would be vacuous').toBeGreaterThan(20)
    expect(
      faults,
      'Under production build-mode the cockpit handed the tracer renderer something that is not the ' +
        'live shell. A copy whose depth is scaled behind an `import.meta.env.PROD` gate is the exact ' +
        'rejected bug, shipped only in the artifact.\n',
    ).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────
// RELATIVE — the artifact draws EXACTLY what the suite ran, pixel for pixel
// ─────────────────────────────────────────────────────────────────────────────────

describe('PARITY — the production build strokes the identical scene the DEV run strokes', () => {
  it('every pixel is byte-identical between the DEV run and the PROD run', () => {
    // The measurement-free half, and it covers the WHOLE draw path, not just the tracer: a mode gate
    // on the enemy model matrix (`-enemy.depth / 8`), on the wreck list, on the blimp — anything the
    // build folds differently — makes these two stroke lists diverge. Same pinned clock ⇒ same sky ⇒
    // the ONLY thing that can differ is a build-mode branch.
    expect(prod.strokes.length, 'the PROD run must actually draw something').toBeGreaterThan(100)
    expect(
      prod.strokes,
      'THE PRODUCTION BUILD DRAWS A DIFFERENT SCENE FROM THE ONE THE SUITE VERIFIED.\n\n' +
        'main.ts (or something it draws through) behaves differently under `import.meta.env` / ' +
        '`process.env` than it does under the suite\'s env. Whatever is gated on the build mode, the ' +
        'player sees it and no other test can: `vitest` runs the DEV transform, R2 serves the PROD ' +
        'one. The render path must not read the build mode at all.\n',
    ).toEqual(dev.strokes)
  })

  it('the two runs really did fly the same sky — parity is not passing by both being empty', () => {
    // Anti-vacuity for the parity check itself: equal-but-empty would pass toEqual. Pin that BOTH
    // runs stepped the sim, fired, and drew tracers — so the equality is over a real, busy scene.
    expect(dev.strokes.length).toBe(prod.strokes.length)
    expect(dev.frames.some((f) => f.tracers.length > 0), 'the DEV run must have drawn tracers').toBe(true)
    expect(prod.frames.some((f) => f.tracers.length > 0), 'the PROD run must have drawn tracers').toBe(true)
    const devShells = dev.frames.reduce((n, f) => n + f.live.shells.length, 0)
    const prodShells = prod.frames.reduce((n, f) => n + f.live.shells.length, 0)
    expect(devShells, 'both runs put the same shells in the air').toBe(prodShells)
    expect(prodShells).toBeGreaterThan(20)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────
// STRUCTURAL DEFENCE-IN-DEPTH — main.ts may not read the build mode at all
// ─────────────────────────────────────────────────────────────────────────────────
//
// The behavioural guards above are the real ones — they measure what the artifact DOES. This is the
// cheap tripwire that fails FAST and says WHY, and it is legitimate here for a reason the previous
// four rounds could not use: main.ts has NO honest need to know whether it is a dev server or a
// production bundle. The game plays the same either way. So a build-mode read in the render path is
// never a feature; forbidding the whole family (`import.meta.env`, `import.meta.hot`, `process.env`,
// and bare `typeof process` / `typeof require` environment-sniffing) removes the mechanism, not just
// the one instance. It is not a substitute for the behavioural guards — a divergence could hide in an
// imported module — but it closes the near path and documents the rule.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('main.ts never reads the build mode — the render path is build-agnostic', () => {
  const main = (): string => readFileSync(join(repoRoot, 'src', 'main.ts'), 'utf8')

  it('contains no import.meta.env / import.meta.hot build-mode read', () => {
    const src = main()
    expect(
      src,
      'main.ts reads import.meta.env — a value Vite folds differently for `vitest` and `vite build`. ' +
        'That is a test-vs-production divergence waiting to happen; the render path plays the same in ' +
        'both builds and must not branch on the mode.',
    ).not.toMatch(/import\s*\.\s*meta\s*\.\s*(env|hot)\b/)
  })

  it('contains no process.env / typeof-process build-mode sniff', () => {
    const src = main()
    expect(src, 'main.ts must not read process.env (Vite inlines NODE_ENV in the build)').not.toMatch(
      /\bprocess\s*\.\s*env\b/,
    )
    expect(
      src,
      'main.ts must not sniff the runtime with `typeof process` / `typeof require` — those differ ' +
        'between the node test host and the browser bundle, which is the same divergence one class over.',
    ).not.toMatch(/\btypeof\s+(process|require|global)\b/)
  })

  it('this guard is anchored to the ONE line the bug lives on — the tracer draw is still here', () => {
    // Anti-vacuity: if the tracer draw loop were renamed or moved, the regexes above would guard an
    // empty target. Pin that the thing they protect still exists and reads the honest live shell.
    expect(main(), 'main.ts must still draw tracers through core/guns.shellSegments').toMatch(
      /strokeSegments\s*\(\s*shellSegments\s*\(/,
    )
  })
})

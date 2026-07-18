// tests/shell/cockpit-draw-path.test.ts
//
// Story rb4-1 — round 4. THE COCKPIT IS BOOTED, AND THE LIGHT IS MEASURED.
//
// ─── WHY THIS FILE EXISTS: FOUR GUARDS, FOUR WALK-AROUNDS ───────────────────────
//
// This story has been rejected three times, always for the same disease: a suite that reports
// GREEN over a real bug. Each round the guard got smarter and each round it was beaten in
// minutes, because every one of them was asking the same KIND of question.
//
//   round 1  two depth constants left unscaled            (nothing measured them)
//   round 2  four regexes over main.ts's source text      (a regex asks what the code SAYS)
//   round 3  a structural fence — "main.ts must stroke the result of a MEASURED core
//            renderer, must not import projectSegment, must declare no rival"
//
// Round 3's fence is real and it is worth keeping. It pins the IDENTITY of the function the
// cockpit draws with. It says NOTHING about the ARGUMENTS. And `shellSegments(shell, mvp)` is a
// pure function of exactly those two things, both of which main.ts owns. So:
//
//     // ATTACK A — one line, at the draw call
//     strokeSegments(shellSegments({ ...shell, z: shell.z / 8 }, projView), width, height)
//
//     // ATTACK B — the same bug, moved 260 lines AWAY so the render line reads PRISTINE
//     const tracerShells = (shells) => shells.map((s) => ({ ...s, z: s.z / 8 }))
//     ...
//     draw(attitude, enemies, blimp, mountains, wrecks, tracerShells(guns.shells), ...)
//
// Both restore the EXACT rejected bug — the tracer drawn at 1/8 the depth it kills at, planes
// exploding 4224 units away while the bullet dies in your face — and BOTH went 832/832 GREEN
// with tsc clean. Every guard passed: `strokeSegments(` still receives a call to a name in
// MEASURED_SOURCES; main.ts still imports `shellSegments` and declares no rival; no banned
// identifier appears anywhere. The "measured core function" faithfully drew a lie, because
// nobody had measured it AS THE COCKPIT CALLS IT.
//
// And the class does not end at the shell. `multiply(projView, <z-scaled Mat4>)` needs no banned
// identifier at all. Nor does a doctored enemy depth in the model matrix main.ts builds at
// main.ts:175. As long as main.ts authors the INPUTS to geometry, a fence around the OUTPUTS is
// a fence with a gate in it.
//
// ─── THE ONLY QUESTION THAT CANNOT BE WALKED AROUND ─────────────────────────────
//
//     WHERE IS THE LIGHT?
//
// Not "which function did you call", not "what does the source say" — where, in the world, did
// the cockpit put the photons, and is that where the sim says the object IS? That question has
// exactly one honest answer and no amount of renaming, indirection or cosmetic comment can
// change it.
//
// So this file stops reading main.ts and RUNS it. main.ts touches `document` at module scope and
// vitest runs `environment: 'node'` — which is why, for four rounds, everyone accepted "main.ts
// is the one file no test can import" as a law of nature. It is not a law. It is a missing
// `document`. We supply one: a recording canvas, a recording 2-D context, a fake window whose
// `requestAnimationFrame` hands us the frame callback, and a keyboard we can hold the trigger on.
// Then we drive the REAL cockpit for real frames, with the REAL sim running inside it, and we
// watch every vector it draws.
//
// ─── WHAT IS OBSERVED (and why it cannot share a mistake with the code) ─────────
//
// Two seams are instrumented, and NEITHER of them is the render path:
//
//   * `core/guns.step` — the COLLISION arm. Its return value IS the live shell pool the cockpit
//     is about to draw, and its `targets` argument IS the live enemy/blimp list. This is the
//     sim's own ground truth, taken from the function that decides what the bullet KILLS.
//   * `core/scene.projectSegment` + `core/scene.projectWorldSegment` — the two gates every
//     vector on screen passes through (main.ts is forbidden from importing either, or from
//     building a `perspective(`). Motion objects take the pure divide; playfield objects take
//     the divide plus the ROM's HORIZN lift (rb4-5). Both see each segment's WORLD-SPACE
//     endpoints and the matrix it is divided by, and both are recorded here.
//
// Everything below is a comparison BETWEEN those two independent observations. The expected
// depths are derived from the shells the collision arm reports; the actual depths are read out
// of the geometry the render arm projected. There is no reconstruction of main.ts's loop to get
// out of step with, and no shared constant for both arms to be wrong about together.
//
// ─── THE FOUR INVARIANTS ────────────────────────────────────────────────────────
//
//   1. TRACER TRUTH   Every live shell is projected at `shellDepth(z)` — the depth it KILLS at,
//                     measured off the world-space endpoints the cockpit actually handed to
//                     projectSegment. Attacks A and B project at z x 32 where the gun kills at
//                     z x 256, and land here reading "kills at 4224, drawn at 512".
//   2. CAMERA TRUTH   Those tracers are divided by the REAL camera matrix — sceneProjection(the
//                     live aspect) . flightView(the live attitude) — so a doctored MVP cannot
//                     move the light instead.
//   3. NO DOCTORED INPUTS  The shells handed to the renderer are the LIVE shell objects, by
//                     reference identity, one draw per shell. A spread copy is a new object;
//                     `{ ...shell, z: shell.z / 8 }` and `shells.map(...)` both die here even
//                     before their depth is measured. No extra tracers, no missing ones.
//   4. PIXEL FIDELITY The strokes on the canvas are EXACTLY the segments projectSegment returned,
//                     in order — nothing added, dropped, reordered or rescaled between core and
//                     glass. `strokeSegments(shellSegments(...).map(scale))` dies here.
//
//   + TARGET TRUTH    The same measurement, for the things being shot at: every live plane and
//                     the airship are DRAWN where the sim says they ARE. main.ts builds the
//                     enemy's model matrix by hand (main.ts:175) — the identical hole, one
//                     object over — so a plane rendered at 1/8 its collision depth dies here too.
//
// ─── HONEST LIMITS ──────────────────────────────────────────────────────────────
//
// This does not make main.ts's KEYBOARD or AUDIO testable, and does not try to. It makes the
// DRAW PATH testable, which is where both of this story's HIGH bugs lived and where all three
// rejected guards failed. Sound is stubbed out (it is not geometry). The pilot flies level, on
// purpose: a level yoke makes the camera matrix independently computable, which is what turns
// invariant 2 from "the two renderers agree" into "the renderer is right".

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

import { multiply, type Mat4, type Vec3 } from '@arcade/shared/math3d'
import { LEVEL, flightView } from '../../src/core/camera'
import {
  DISCHK, INITIAL_FLIGHT, step as stepFlight, toAttitude, type ProximityBand,
} from '../../src/core/flight'
import { sceneProjection, type SceneSegment } from '../../src/core/scene'
import { shellDepth, type Shell } from '../../src/core/guns'
import { P_INDP, displayPos, type Enemy } from '../../src/core/enemy'
import type { Wreck } from '../../src/core/explosion'

// ─────────────────────────────────────────────────────────────────────────────────
// THE INSTRUMENTS — hoisted, because the module factories below run before this file's body
// ─────────────────────────────────────────────────────────────────────────────────

interface ProjCall {
  /** The FRONT world-space endpoint the cockpit asked to have projected. */
  readonly a: readonly number[]
  /** The BACK world-space endpoint. */
  readonly b: readonly number[]
  /** The matrix it was divided by. */
  readonly mvp: readonly number[]
  /** What came back (null = culled behind the eye, and never stroked). */
  readonly seg: SceneSegment | null
}

/** One invocation of the core tracer renderer, with the index range of the projections it made. */
interface TracerDraw {
  readonly shell: Shell
  readonly mvp: readonly number[]
  readonly from: number
  readonly to: number
}

/** One invocation of the core wreck renderer, with the projections it made. */
interface WreckDraw {
  readonly wreck: Wreck
  readonly mvp: readonly number[]
  readonly from: number
  readonly to: number
}

/** One calc-frame of the COLLISION arm — the sim's own ground truth about the world. */
interface GunStep {
  /** The shell pool AFTER the step: exactly the shells the cockpit is about to draw. */
  readonly shells: readonly Shell[]
  /** The live targets the shells were tested against: the planes, plus the airship if present. */
  readonly targets: readonly Enemy[]
  /**
   * rb4-6 — the EYE the shells were tested FROM. A target's stored position is WORLD; where it is
   * on screen (and therefore where it can be hit, and where it must be drawn) is that minus the
   * pilot. Capturing the eye the collision arm actually used is what lets TARGET TRUTH keep
   * measuring the drawn position against the killed position now that the two share a projection
   * rather than a coordinate.
   */
  readonly eye: Vec3
  readonly hits: number
}

const rec = vi.hoisted(() => ({
  proj: [] as ProjCall[],
  tracers: [] as TracerDraw[],
  gunSteps: [] as GunStep[],
  wreckDraws: [] as WreckDraw[],
  /** EVERY wreck object the SIM ever produced (explode / stepWreck), across the whole run. */
  simWrecks: [] as Wreck[],
}))

// Sound is not geometry. Stub the engine so no AudioContext is ever needed; the real
// shell/audio-dispatch still runs against it, which keeps the loop's shape honest.
vi.mock('../../src/shell/audio', () => ({
  createAudioEngine: () => ({
    resume: () => {},
    play: () => {},
    playTone: () => {},
    setEngine: () => {},
    setGun: () => {},
    setApproach: () => {},
  }),
}))

// THE TWO GATES. Every vector on screen is divided by a matrix here — main.ts may not import
// either function (screen-scale.test.ts) and may not build its own `perspective(`. So this sees
// the whole scene, in WORLD SPACE, before the perspective divide hides the depth. rb4-5 split the
// substrate: `projectSegment` is the pure divide the MOTION objects (planes, blimp, wrecks,
// tracers) take, and `projectWorldSegment` is the same divide PLUS the ROM's POSITH HORIZN lift
// that the PLAYFIELD objects (horizon, mountains) take (RBGRND.MAC:303 vs :359). Both are recorded
// into the SAME ordered `rec.proj` roster, so INVARIANT 4 still sees every vector that hits the
// glass — a world stroke lands with its HORIZN lift already in it, exactly as it is drawn.
vi.mock('../../src/core/scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/scene')>()
  return {
    ...actual,
    projectSegment: (a: Vec3, b: Vec3, mvp: Mat4): SceneSegment | null => {
      const seg = actual.projectSegment(a, b, mvp)
      rec.proj.push({ a: [...a], b: [...b], mvp: [...mvp], seg })
      return seg
    },
    projectWorldSegment: (a: Vec3, b: Vec3, mvp: Mat4): SceneSegment | null => {
      const seg = actual.projectWorldSegment(a, b, mvp)
      rec.proj.push({ a: [...a], b: [...b], mvp: [...mvp], seg })
      return seg
    },
  }
})

// THE SIM'S GROUND TRUTH. `step` is the COLLISION arm — the thing that decides what the bullet
// KILLS. Its output is the live shell pool; its input is the live target list. Both arms of the
// fork are read from here, so the expectation can never drift with the render code.
vi.mock('../../src/core/guns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/guns')>()
  return {
    ...actual,
    // rb4-6: forward the EYE. This wrapper used to take (guns, targets) and call through with
    // exactly those two — so when the gun gained a display-space eye, the recorded cockpit silently
    // collided from the origin while the real one collided from the pilot. A passthrough mock that
    // re-declares its parameters is a copy of the signature, and a copy cannot track anything: the
    // suite went on measuring a sim that no longer existed. Forward and record what was really used.
    step: (guns: Parameters<typeof actual.step>[0], targets: readonly Enemy[], eye: Vec3) => {
      const out = actual.step(guns, targets, eye)
      rec.gunSteps.push({ shells: out.guns.shells, targets, eye, hits: out.hits.length })
      return out
    },
    shellSegments: (shell: Shell, mvp: Mat4): readonly SceneSegment[] => {
      const from = rec.proj.length
      const segs = actual.shellSegments(shell, mvp)
      rec.tracers.push({ shell, mvp: [...mvp], from, to: rec.proj.length })
      return segs
    },
  }
})

// THE WRECK, BOTH ARMS. The downed plane is the THIRD thing main.ts hands to a renderer, and
// `DEBRIS_SPREAD = 4` rotting in main.ts is one of this story's three original bugs — so the
// wreck gets exactly the same treatment as the shell: the sim's own objects on one side
// (explode / stepWreck are the ONLY sources of a Wreck), the cockpit's draw on the other.
vi.mock('../../src/core/explosion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/explosion')>()
  return {
    ...actual,
    explode: (enemy: Enemy): Wreck => {
      const w = actual.explode(enemy)
      rec.simWrecks.push(w)
      return w
    },
    stepWreck: (wreck: Wreck): Wreck => {
      const w = actual.stepWreck(wreck)
      rec.simWrecks.push(w)
      return w
    },
  }
})

vi.mock('../../src/core/wreck-render', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/wreck-render')>()
  return {
    ...actual,
    wreckSegments: (wreck: Wreck, mvp: Mat4): readonly SceneSegment[] => {
      const from = rec.proj.length
      const segs = actual.wreckSegments(wreck, mvp)
      rec.wreckDraws.push({ wreck, mvp: [...mvp], from, to: rec.proj.length })
      return segs
    },
  }
})

// ─────────────────────────────────────────────────────────────────────────────────
// THE SYNTHETIC COCKPIT — a canvas that remembers every line it was asked to draw
// ─────────────────────────────────────────────────────────────────────────────────

const WIDTH = 1600
const HEIGHT = 900
/** The frame every screen question is asked against — main.ts's own `viewAspect()`. */
const ASPECT = WIDTH / HEIGHT // 16:9

interface PixelSeg {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

const strokes: PixelSeg[] = []
let pen: { x: number; y: number } | null = null

const ctxStub = {
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 0,
  shadowColor: '',
  shadowBlur: 0,
  font: '',
  textAlign: '',
  textBaseline: '',
  beginPath: (): void => {},
  moveTo: (x: number, y: number): void => {
    pen = { x, y }
  },
  lineTo: (x: number, y: number): void => {
    if (pen !== null) strokes.push({ x1: pen.x, y1: pen.y, x2: x, y2: y })
    pen = { x, y }
  },
  stroke: (): void => {},
  fillRect: (): void => {},
  fillText: (): void => {},
  save: (): void => {},
  restore: (): void => {},
}

const canvasStub = {
  width: 0,
  height: 0,
  clientWidth: WIDTH,
  clientHeight: HEIGHT,
  getContext: (): unknown => ctxStub,
}

type Listener = (e: unknown) => void
const listeners = new Map<string, Listener[]>()
let rafCb: ((t: number) => void) | null = null

const windowStub = {
  innerWidth: WIDTH,
  innerHeight: HEIGHT,
  addEventListener: (type: string, fn: Listener): void => {
    const list = listeners.get(type) ?? []
    list.push(fn)
    listeners.set(type, list)
  },
  requestAnimationFrame: (cb: (t: number) => void): number => {
    rafCb = cb
    return 1
  },
}

// Installed at module scope, BEFORE main.ts is dynamically imported below — main.ts reaches for
// `document` on its very first line, which is exactly why nobody had ever run it under a test.
const g = globalThis as unknown as Record<string, unknown>
g.document = { getElementById: (): unknown => canvasStub }
g.window = windowStub

/**
 * THE CLOCK IS PINNED, AND IT HAS TO BE.
 *
 * main.ts seeds BOTH its RNGs off the wall clock — `createRng((Date.now() ^ 0x5e_ed) >>> 0)` for
 * the BLMOTN blimp roll, `createRng((Date.now() + kills) >>> 0)` for each wave. Left alone, every
 * run of this file flies a DIFFERENT sky: a different wave, a different formation, sometimes an
 * airship and sometimes not, shells striking on different frames.
 *
 * I found that out the hard way. The first draft of this file caught ATTACK B on one run and let
 * TARGET TRUTH pass on the next, with the identical bug in the tree — because the wave that would
 * have exposed it had not spawned that time. A guard that catches the bug SOMETIMES is not a
 * guard; it is a coin toss that will eventually be dismissed as a flake and disabled. That is a
 * cousin of the very disease this story keeps being rejected for.
 *
 * Pinning the clock makes the whole sim — wave, formation, blimp, every kill — a pure function of
 * the code. Same sky, every run, on every machine.
 */
const FIXED_NOW = 1_700_000_000_000
const realNow = Date.now
Date.now = (): number => FIXED_NOW

/** main.ts's own NDC → pixel map (main.ts:103). Pinned by INVARIANT 4 below. */
const toPixel = (nx: number, ny: number): [number, number] => [
  ((nx + 1) / 2) * WIDTH,
  ((1 - ny) / 2) * HEIGHT,
]

const fire = (): void => {
  for (const fn of listeners.get('keydown') ?? []) {
    fn({ key: ' ', repeat: false, preventDefault: () => {} })
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// THE CAMERA, COMPUTED INDEPENDENTLY — the pilot flies level, so this is knowable
// ─────────────────────────────────────────────────────────────────────────────────

/** The MVP the cockpit MUST be drawing with: the real projection, the real (level) attitude. */
const PROJ_VIEW: Mat4 = multiply(sceneProjection(ASPECT), flightView(LEVEL, [0, 0, 0]))

/** Two matrices are the same matrix. (Tolerant of nothing but float dust — a z-scale is 8x.) */
function sameMatrix(m: readonly number[], expected: Mat4): boolean {
  if (m.length !== expected.length) return false
  return m.every((v, i) => Math.abs(v - expected[i]) <= 1e-9 * Math.max(1, Math.abs(expected[i])))
}

/** Homogeneous clip coordinates of a world point (scene.ts's own `toClip`, re-derived). */
function clipOf(mvp: readonly number[], v: Vec3): { x: number; y: number; w: number } {
  const [x, y, z] = v
  return {
    x: mvp[0] * x + mvp[1] * y + mvp[2] * z + mvp[3],
    y: mvp[4] * x + mvp[5] * y + mvp[6] * z + mvp[7],
    w: mvp[12] * x + mvp[13] * y + mvp[14] * z + mvp[15],
  }
}

/**
 * Where a model matrix puts its object's ORIGIN, in NDC.
 *
 * A model matrix is `translation(...) . rotation(...)`, and a rotation FIXES the origin — so this
 * reads out where the object was placed, whatever pose it was placed in. That is what lets one
 * measurement cover the plane (translation . rotationZ, built by main.ts) and the airship
 * (translation . rotationY . rotationZ, built by core/blimp) without knowing either pose.
 */
function originNdc(mvp: readonly number[]): { x: number; y: number; w: number } {
  return { x: mvp[3] / mvp[15], y: mvp[7] / mvp[15], w: mvp[15] }
}

/** Where the sim says an object at DISPLAY (x, y, depth) belongs on the screen. */
function ndcOfDisplay(x: number, y: number, depth: number): { x: number; y: number } {
  const c = clipOf(PROJ_VIEW, [x, y, -depth])
  return { x: c.x / c.w, y: c.y / c.w }
}

/**
 * Where the sim says a WORLD-space target belongs on the screen, seen from `eye`.
 *
 * rb4-6: a plane's stored (x, y) is its WORLD position and its screen position is that minus the
 * pilot (`PLSTAT − UNIV4X`, RBARON.MAC:2909-2913) — so the ground truth for "where must it be
 * drawn" is `displayPos` at the eye the gun COLLIDED from. That keeps this measurement exactly
 * what it always was — the drawn position versus the killed position — through the one function
 * both arms call, rather than through a second copy of the pan that could drift from it.
 */
function ndcOfTarget(t: Enemy, eye: Vec3): { x: number; y: number } {
  const s = displayPos(t, eye)
  return ndcOfDisplay(s.x, s.y, t.depth)
}

// ─────────────────────────────────────────────────────────────────────────────────
// FLYING IT — real frames, real sim, trigger held
// ─────────────────────────────────────────────────────────────────────────────────

/** One rendered frame of the real cockpit, and everything it did. */
interface Frame {
  readonly proj: readonly ProjCall[]
  readonly tracers: readonly TracerDraw[]
  readonly wreckDraws: readonly WreckDraw[]
  readonly strokes: readonly PixelSeg[]
  /** The sim's ground truth as of the LAST calc-step before this frame was drawn. */
  readonly live: GunStep
  /** Did a calc-frame actually run inside this rAF? */
  readonly stepped: boolean
}

const frames: Frame[] = []

/**
 * 200 ms per rAF: comfortably more than one 96 ms calc-frame (SIM_TIMESTEP_S), so every rendered
 * frame is backed by fresh sim state, and the accumulator's 2-steps-then-1-step rhythm is
 * exercised rather than avoided. 24 frames keeps the whole run inside the gun's ~30-shot GUN.ST
 * window, so there are live shells on screen throughout.
 */
const FRAME_MS = 200
const FRAMES = 24

/**
 * Live shells summed over the whole run, under the pinned clock. Measured, then pinned — the
 * anti-vacuity number. Every tracer assertion below is quantified over these; if the count ever
 * collapses (to zero, say, because the trigger stopped being held or the pool stopped filling),
 * the suite must go RED rather than pass by asserting nothing about nothing.
 *
 * Re-measured for rb4-4 (82 → 52): the pilot can DIE now. Under this pinned clock the airship's
 * fire connects mid-run, the shells death sequence grounds the pilot for .TIME2 = 28 calc frames
 * (EOL clears GUN.ST, RBARON.MAC:1109-1110 — no new shells while dying), and the gun cools
 * through the sequence. Same sky, same crash, every run — still a property of the code.
 *
 * Re-measured for rb4-6 (52 → 53), and the REASON is not the one round 1 recorded here.
 *
 * Round 1 wrote that the +1 was "one more shell lives out its flight instead of ending early on a
 * plane that used to sit still in Y". The Reviewer read that back as what it was: a shell that used
 * to CONNECT now MISSED, i.e. this number had noticed the soft-lock and been re-pinned over it. The
 * instruction was to re-read it only once the reachability defect was fixed, so that is what this
 * is — measured on the far side of the display seam, not before it.
 *
 * What the run now does: planes spawn at STPLNE's absolute altitude (:2310-2316) rather than a ±40
 * screen offset, settle onto the boresight, and are SHOT DOWN — the wreck guards below require a
 * kill to land and they pass, which is the assertion round 1's sky could not have satisfied. The
 * count arriving back at 53 is a coincidence of a genuinely different sky, not a survival of the
 * old one. Stable across runs (verified 3×), the pool still fills, the trigger is still held.
 *
 * Re-measured for rb4-17 (53 → 52): the gun window is no longer the inferred ±32 square but the
 * ROM's own COLLD plate — x ±48, y −64..+80 (037007.XXX:602-605 × the POINTP ×4 lift; guns.ts
 * WINDOW_X). A wider X window means one shell CONNECTS a sub-step earlier than it used to, and a
 * shell that kills sooner is consumed sooner — one fewer frame of it alive in the pool. The kill
 * still lands (the wreck guards below stay green); the sky is the same seeded sky.
 *
 * Re-measured for rb4-7 (52 → 51): the MODECT/NEWCT wave clock now counts WAVES, so the opening is
 * a RUN of plane waves instead of the old 1:1 plane/ground alternation — a genuinely different (but
 * still seeded, still deterministic) sequence of planes. One shell fewer is alive across the run.
 * This is the "re-read the numbers on purpose" the guard is built to force.
 *
 * A drift toward zero would still fail, which is the point.
 */
const TOTAL_LIVE_SHELLS = 51

beforeAll(async () => {
  await import('../../src/main') // the module body runs: resize(), the listeners, the first rAF

  let live: GunStep = { shells: [], targets: [], eye: [0, 0, 0], hits: 0 }
  let t = 0
  for (let i = 0; i < FRAMES; i++) {
    fire() // hold the trigger — `held` is a Set, so this is idempotent
    const cb = rafCb
    expect(cb, 'the cockpit must have scheduled the next frame').not.toBeNull()
    rafCb = null

    rec.proj.length = 0
    rec.tracers.length = 0
    rec.gunSteps.length = 0
    rec.wreckDraws.length = 0
    strokes.length = 0
    // NB: rec.simWrecks is NOT cleared — a wreck drawn on a frame where no calc-step ran was
    // produced on an EARLIER frame, so the sim's roster of real Wreck objects must accumulate.

    t += FRAME_MS
    cb!(t)

    // The shells/targets the cockpit DREW are the ones the last collision pass left behind. If no
    // calc-frame ran this rAF (the accumulator was short), the previous frame's state is still
    // what is on screen — carry it.
    const stepped = rec.gunSteps.length > 0
    if (stepped) live = rec.gunSteps[rec.gunSteps.length - 1]

    frames.push({
      proj: [...rec.proj],
      tracers: [...rec.tracers],
      wreckDraws: [...rec.wreckDraws],
      strokes: [...strokes],
      live,
      stepped,
    })
  }
})

afterAll(() => {
  Date.now = realNow
})

/** Total tracer draws over the whole run — pinned, so "nothing was measured" cannot pass. */
const totalTracers = (): number => frames.reduce((n, f) => n + f.tracers.length, 0)
/** Total live shells the sim reports over the whole run. */
const totalLiveShells = (): number => frames.reduce((n, f) => n + f.live.shells.length, 0)

// ─────────────────────────────────────────────────────────────────────────────────
// THE COCKPIT ACTUALLY RAN — a vacuous guard is the round-2 sin, so prove it first
// ─────────────────────────────────────────────────────────────────────────────────

describe('the REAL cockpit booted, flew, and fired (this suite is not vacuous)', () => {
  it('drew every frame, stepped the sim, and put live shells in the air', () => {
    expect(frames).toHaveLength(FRAMES)
    expect(frames.every((f) => f.strokes.length > 0), 'every frame must stroke vectors').toBe(true)
    expect(frames.some((f) => f.stepped), 'the sim must have ticked').toBe(true)

    const armed = frames.filter((f) => f.live.shells.length > 0)
    expect(armed.length, 'the trigger was held — shells must be in flight').toBeGreaterThan(10)
    expect(
      Math.max(...armed.map((f) => f.live.shells.length)),
      'the pool must fill: several tracers on screen at once',
    ).toBeGreaterThan(2)
    expect(
      Math.max(...armed.flatMap((f) => f.live.shells.map((s) => shellDepth(s.z)))),
      'and a shell must reach out past the plane spawn depth, where this story lives',
    ).toBeGreaterThanOrEqual(P_INDP)

    // A live WAVE must have reached the canvas, or TARGET TRUTH below has nothing to measure and
    // would pass by having checked nothing. With the clock pinned this is a FACT about the code,
    // not a hope about the weather.
    expect(
      frames.some((f) => f.live.targets.length > 0),
      'the wave must have spawned and been drawn — otherwise TARGET TRUTH is vacuous',
    ).toBe(true)
  })

  it('the sim is DETERMINISTIC under the pinned clock — the same sky every run', () => {
    // The guard's own anti-flake pin. main.ts seeds its RNGs from Date.now(); with the clock
    // pinned, the run is reproducible, so these counts are properties of the CODE. If a future
    // change moves them, this fails and someone re-reads the numbers on purpose — which is
    // exactly the behaviour we want, and the opposite of a threshold quietly sliding to zero.
    expect(totalLiveShells(), 'live shells summed over the run').toBe(TOTAL_LIVE_SHELLS)
    expect(totalTracers(), 'tracer draws summed over the run').toBe(TOTAL_LIVE_SHELLS)
  })

  it('the pilot flies LEVEL on a neutral yoke — which is what makes the camera knowable', () => {
    // INVARIANT 2 compares main.ts's matrix against one computed here. That is only a real
    // measurement if the attitude is independently known. It is: with turn = 0 and pitch = 0 the
    // flight model is a fixed point, at EVERY DISCHK band (read off DISCHK itself, so a new band
    // cannot quietly escape the claim), so the attitude is LEVEL forever — whatever the wave in
    // front of the pilot is doing.
    const bands = Object.keys(DISCHK) as readonly ProximityBand[]
    expect(bands.length).toBeGreaterThan(0)
    for (const proximity of bands) {
      let flight = INITIAL_FLIGHT
      for (let i = 0; i < FRAMES * 3; i++) flight = stepFlight(flight, { turn: 0, pitch: 0, proximity })
      expect(toAttitude(flight), `band ${proximity}`).toEqual(LEVEL)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────
// INVARIANT 1 + 2 — THE TRACER IS DRAWN AT THE DEPTH THE BULLET KILLS AT
// ─────────────────────────────────────────────────────────────────────────────────

describe('INVARIANT 1 — the light is where the kill is (measured off the real draw path)', () => {
  it('every live shell is PROJECTED at shellDepth(z) — the depth it collides at', () => {
    // THE ASSERTION THE WHOLE STORY IS ABOUT, asked of the running cockpit.
    //
    // Expected depth comes from the COLLISION arm (`guns.step`'s live pool). Actual depth comes
    // from the world-space endpoint the cockpit handed to `projectSegment`. Two independent
    // observations of the same bullet; they must agree, or the player is watching a lie.
    //
    // ATTACK A/B project the nose at `shellDepth(z / 8)` = z x 32 while the gun kills at
    // z x 256. Against a shell that reaches the plane's spawn depth that reads:
    //     kills at 4224, drawn at 512  (8.00x)
    const divergences: string[] = []
    let measured = 0

    for (const [i, f] of frames.entries()) {
      for (const shell of f.live.shells) {
        // The tracer draw for THIS shell — found by identity, so a doctored copy cannot answer
        // for it (that is INVARIANT 3's job; here we only need the right draw).
        const draw = f.tracers.find((d) => d.shell === shell)
        if (draw === undefined) continue // INVARIANT 3 reports the missing draw
        const calls = f.proj.slice(draw.from, draw.to)
        if (calls.length !== 1) {
          divergences.push(`frame ${i}: a tracer projected ${calls.length} segments, expected 1`)
          continue
        }
        measured += 1

        const killDepth = shellDepth(shell.z) // what the SIM says this bullet reaches
        const drawnNose = -calls[0].a[2] // what the COCKPIT actually drew (front endpoint)
        const drawnTail = -calls[0].b[2]

        if (Math.abs(drawnNose - killDepth) > 1e-6) {
          divergences.push(
            `frame ${i}: shell z=${shell.z} KILLS at depth ${killDepth} but its tracer is ` +
              `DRAWN at depth ${drawnNose} — a factor of ${(killDepth / drawnNose).toFixed(2)}x. ` +
              `A bullet must be drawn where it can kill.`,
          )
        }
        // rb4-9 / AC-5: the shell is a DOT (VGDOT), not a streak. Both endpoints are the SAME
        // point at the kill depth — the shape check is now "tail == nose", the trail is gone. The
        // DEPTH-truth above is untouched (a dot at the wrong depth still lands at `drawnNose`).
        if (Math.abs(drawnTail - killDepth) > 1e-6) {
          divergences.push(`frame ${i}: dot tail at ${drawnTail}, expected the kill depth ${killDepth}`)
        }
        if (Math.abs(drawnNose - drawnTail) > 1e-6) {
          divergences.push(`frame ${i}: a dot has zero length, but nose−tail = ${drawnNose - drawnTail}`)
        }
      }
    }

    expect(measured, 'no tracer was measured — the run put no shells on screen').toBeGreaterThan(20)
    expect(
      divergences,
      'THE COCKPIT IS DRAWING THE BULLET SOMEWHERE OTHER THAN WHERE IT KILLS.\n\n' +
        'This is rb4-1\'s HIGH bug, and the three guards before this one could not see it, ' +
        'because they all asked WHICH FUNCTION main.ts calls and none of them asked WHAT IT ' +
        'PASSED IN. `shellSegments(shell, mvp)` is a pure function of its arguments: corrupt the ' +
        'argument and the measured core renderer faithfully draws a lie.\n\n' +
        'Do not fix this by making the tracer agree with itself. The depth on the right is read ' +
        'out of core/guns.step — the COLLISION arm, the thing that decides what the bullet ' +
        'actually destroys. The tracer follows the bullet; the bullet does not follow the tracer.\n',
    ).toEqual([])
  })
})

describe('INVARIANT 2 — the tracer is divided by the REAL camera, not a doctored one', () => {
  it('every tracer MVP is sceneProjection(live aspect) . flightView(live attitude)', () => {
    // Close the other half of the same hole. main.ts composes the MVP and hands it to core, so
    // `multiply(projView, <a z-scaled Mat4>)` reopens the bug with NO banned identifier, no new
    // declaration, and a pristine `strokeSegments(shellSegments(shell, projView), ...)` line —
    // the depth check above would pass with honest world endpoints while the light moved anyway.
    //
    // The matrix is not compared against "the one the other renderers got" (two liars agree).
    // It is compared against one composed HERE, from the real projection at the real viewport
    // aspect and the real (level) attitude.
    const bad: string[] = []
    let checked = 0
    for (const [i, f] of frames.entries()) {
      for (const draw of f.tracers) {
        checked += 1
        if (!sameMatrix(draw.mvp, PROJ_VIEW)) {
          bad.push(`frame ${i}: tracer drawn through a matrix that is not the cockpit's camera`)
        }
      }
    }
    expect(checked, 'no tracer was drawn at all').toBeGreaterThan(20)
    expect(
      bad,
      'A tracer was projected through a matrix that is NOT sceneProjection(aspect) . ' +
        'flightView(attitude). Whatever it is, it is not the camera the rest of the world is ' +
        'seen through, and a z-scale hidden in it moves the bullet exactly as surely as a ' +
        'z-scale on the shell.\n',
    ).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────
// INVARIANT 3 — THE RENDERER IS FED THE LIVE SIM, NOT A COPY OF IT
// ─────────────────────────────────────────────────────────────────────────────────

describe('INVARIANT 3 — the cockpit draws the bullets it simulates (no doctored inputs)', () => {
  it('shellSegments is called exactly once per live shell, WITH THE LIVE SHELL OBJECT', () => {
    // Reference identity, and it is not a trick — it is the negation of the entire attack class,
    // stated in one line: THE THING YOU DRAW IS THE THING YOU SIMULATE.
    //
    //   { ...shell, z: shell.z / 8 }        a new object   -> caught
    //   shells.map((s) => ({ ...s, ... }))  new objects    -> caught
    //   an extra, hand-doctored tracer      an extra draw  -> caught (the counts diverge)
    //   dropping the tracer entirely        a missing draw -> caught
    //
    // It cannot be satisfied by mutating the live shells in place either: `collides` reads the
    // same `z`, so the kill depth would move with the tracer and there would be no bug left.
    const faults: string[] = []
    let checked = 0

    for (const [i, f] of frames.entries()) {
      const drawn = f.tracers.map((d) => d.shell)
      if (drawn.length !== f.live.shells.length) {
        faults.push(
          `frame ${i}: ${f.live.shells.length} shells are in flight but ${drawn.length} tracers ` +
            `were drawn`,
        )
        continue
      }
      for (const [k, shell] of f.live.shells.entries()) {
        checked += 1
        // Object.is — a spread copy is a DIFFERENT object, however identical its fields look.
        if (!drawn.some((d) => Object.is(d, shell))) {
          const copy = f.tracers[k]?.shell
          faults.push(
            `frame ${i}: the cockpit drew a shell that is NOT the one the sim is flying. ` +
              `live z=${shell.z} (kills at ${shellDepth(shell.z)}); drawn z=${copy?.z} ` +
              `(drawn at ${copy === undefined ? '?' : shellDepth(copy.z)})`,
          )
        }
      }
    }

    expect(checked, 'no shell was ever drawn — the suite would be vacuous').toBeGreaterThan(20)
    expect(
      faults,
      'The cockpit handed the tracer renderer something that is not the live shell.\n\n' +
        'THIS IS THE WHOLE BUG CLASS. Round 3 pinned the IDENTITY of the render function and ' +
        'said nothing about its ARGUMENTS, so a one-line `{ ...shell, z: shell.z / 8 }` at the ' +
        'draw call — or a `tracerShells()` helper 260 lines away, wearing a cosmetic comment — ' +
        'restored the rejected bug with the suite fully green.\n\n' +
        'main.ts may not author geometry, and it may not author the INPUTS to geometry either. ' +
        'Pass the shells the sim is flying, and pass the camera the world is seen through.\n',
    ).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────
// INVARIANT 4 — WHAT REACHES THE GLASS IS WHAT CORE PROJECTED
// ─────────────────────────────────────────────────────────────────────────────────

describe('INVARIANT 4 — every pixel stroked came out of a core projection, unaltered', () => {
  it('the canvas path is EXACTLY the projected segments, in order', () => {
    // The last arm of the fork: even with honest inputs and an honest camera, main.ts could
    // scale, drop, reorder or add segments on the way to the glass —
    //   strokeSegments(shellSegments(shell, projView).map(stretch), width, height)
    // passes every source-text guard in screen-scale.test.ts (the regex captures `shellSegments`)
    // and passes invariants 1-3 (the renderer was called correctly!). It dies here, because here
    // we compare the RECORDED CANVAS against what core actually returned.
    //
    // Every core renderer drops null (behind-eye) segments and strokes the rest in projection
    // order — renderModel, shellSegments, horizonSegments, mountainSegments, and now propSegments
    // (the player + enemy propellers, rb4-9) all do — so the WORLD path is the non-null
    // projections, one for one.
    //
    // rb4-9 changes the shape of the canvas path: after the projected WORLD (which now includes the
    // props) comes a HUD OVERLAY — the lives glyphs (DSPLIF) and windscreen bullet holes (WNDSHD).
    // Those are authored directly in NDC (screen space), NOT projected, so they are NOT in `f.proj`.
    // The guard keeps its full teeth on the projected geometry — the world+props are stroked EXACTLY
    // as projected, in order (the whole original attack class) — and the non-projected HUD tail
    // (whose geometry is pinned in tests/core/hud.test.ts) is required only to be finite, in-frame
    // pixels. main.ts draws the world first and the HUD last, so the world is a strict prefix.
    for (const [i, f] of frames.entries()) {
      const expected: PixelSeg[] = f.proj
        .filter((c): c is ProjCall & { seg: SceneSegment } => c.seg !== null)
        .map((c) => {
          const [x1, y1] = toPixel(c.seg.x1, c.seg.y1)
          const [x2, y2] = toPixel(c.seg.x2, c.seg.y2)
          return { x1, y1, x2, y2 }
        })

      expect(
        f.strokes.slice(0, expected.length),
        `frame ${i}: the WORLD vectors on the canvas are not the vectors core projected. ` +
          `Something between the renderer and the glass added, dropped, reordered or rescaled ` +
          `geometry — which is a renderer with no name and no test.`,
      ).toEqual(expected)

      // The tail is the HUD overlay (lives + windscreen). It must be finite, in-frame pixels —
      // never a smuggled WORLD stroke escaping the projection guard by being authored in NDC.
      for (const s of f.strokes.slice(expected.length)) {
        for (const v of [s.x1, s.x2]) expect(v, `frame ${i}: HUD x out of frame`).toBeGreaterThanOrEqual(0)
        for (const v of [s.x1, s.x2]) expect(v).toBeLessThanOrEqual(WIDTH)
        for (const v of [s.y1, s.y2]) expect(v, `frame ${i}: HUD y out of frame`).toBeGreaterThanOrEqual(0)
        for (const v of [s.y1, s.y2]) expect(v).toBeLessThanOrEqual(HEIGHT)
      }
    }
    expect(frames.some((f) => f.strokes.length > 0)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────
// TARGET TRUTH — the same measurement, for the things being shot AT
// ─────────────────────────────────────────────────────────────────────────────────

describe('TARGET TRUTH — every plane and the airship are DRAWN where the sim says they ARE', () => {
  it('each live target’s model matrix places its origin at its collision position', () => {
    // The tracer is not the only place main.ts authors geometry. It builds the enemy's model
    // matrix by hand:
    //
    //     multiply(translation(enemy.x, enemy.y, -enemy.depth), rotationZ(enemy.bank))
    //
    // which is the identical hole, one object over: `-enemy.depth / 8` there draws the plane in
    // the player's lap while `collides` still kills it at 4224, and every existing guard — the
    // MEASURED_SOURCES fence included — passes, because `renderModel` IS a measured core renderer.
    //
    // Measured the same way, against the same ground truth: the targets `guns.step` collided
    // against. A model matrix is `translation . rotation`, and a rotation fixes the origin, so
    // reading the origin out of the matrix says WHERE the object was placed without needing to
    // know what pose it was placed in — which is what lets one assertion cover both the plane
    // (posed by main.ts) and the airship (posed inside core/blimp).
    const misplaced: string[] = []
    let checked = 0

    for (const [i, f] of frames.entries()) {
      // On a frame where a shell connected, the drawn wave is the POST-kill wave while the
      // collision pass's target list is the PRE-kill one. Skip those: the kill path is
      // engagement.test.ts's business, and a false red here would teach nobody anything.
      if (!f.stepped || f.live.hits > 0) continue

      // Every distinct matrix the cockpit projected through, this frame.
      const mvps = f.proj.map((c) => c.mvp)

      for (const target of f.live.targets) {
        if (!(target.depth > 0)) continue // behind/at the eye — nothing to place
        checked += 1
        const want = ndcOfTarget(target, f.live.eye)
        const found = mvps.some((m) => {
          const o = originNdc(m)
          return (
            o.w > 0 && Math.abs(o.x - want.x) <= 1e-9 && Math.abs(o.y - want.y) <= 1e-9
          )
        })
        if (!found) {
          misplaced.push(
            `frame ${i}: a target the guns are colliding with at depth ${target.depth} ` +
              `(ndc ${want.x.toFixed(4)}, ${want.y.toFixed(4)}) was never DRAWN there.`,
          )
        }
      }
    }

    expect(checked, 'no live target was ever checked — the wave never reached the canvas').toBeGreaterThan(5)
    expect(
      misplaced,
      'A plane or the airship is being SHOT AT in one place and DRAWN in another. The cockpit ' +
        'must pose every object at the position the sim gives it — no scaling, no offset, no ' +
        'private copy of the depth axis.\n',
    ).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────
// WRECK TRUTH — the third object main.ts hands to a renderer, and the third rotting constant
// ─────────────────────────────────────────────────────────────────────────────────

describe('WRECK TRUTH — the downed plane bursts where it died', () => {
  it('every wreck DRAWN is a wreck the SIM produced — not a doctored copy of one', () => {
    // I attacked my own guard and found this gap: invariants 1-3 cover the shells, TARGET TRUTH
    // covers the planes and the airship, and NOTHING covered the wrecks. But main.ts hands
    // `wrecks` to `wreckSegments` exactly the way it hands `shells` to `shellSegments`, so
    //
    //     wrecks.map((w) => ({ ...w, depth: w.depth / 8 }))
    //
    // is ATTACK B again, one object over — and it would put every explosion in the player's face
    // while the plane died 4224 units away. That is not a hypothetical shape: `DEBRIS_SPREAD = 4`
    // rotting in main.ts, so the burst was invisible at the spawn depth, is ONE OF THE THREE BUGS
    // THIS STORY EXISTS TO FIX.
    //
    // Same instrument, same principle: `explode` and `stepWreck` are the ONLY things in the
    // codebase that can make a Wreck, so the sim's roster of real wrecks is knowable, and every
    // wreck the cockpit draws must BE one of them (Object.is). A spread copy is not.
    const impostors: string[] = []
    let drawn = 0

    for (const [i, f] of frames.entries()) {
      for (const d of f.wreckDraws) {
        drawn += 1
        if (!rec.simWrecks.some((w) => Object.is(w, d.wreck))) {
          impostors.push(
            `frame ${i}: the cockpit drew a wreck the sim never made — phase ${d.wreck.phase}, ` +
              `depth ${d.wreck.depth}`,
          )
        }
      }
    }

    expect(drawn, 'no wreck was drawn — a kill must land, or this guard is vacuous').toBeGreaterThan(0)
    expect(
      impostors,
      'The cockpit is drawing a WRECK that the simulation did not produce — a doctored copy. ' +
        'Same class as the tracer bug: main.ts may not author the inputs to geometry.\n',
    ).toEqual([])
  })

  it('a FALLING wreck is projected at the depth it actually fell to', () => {
    // The identity check above already kills the copy. This measures the LIGHT, so the guard
    // survives even if someone rebuilds the wreck pipeline: a falling wreck is posed
    // `translation(x, y, -depth) . rotationZ(spin)`, and a rotation fixes the origin — so the
    // origin of the matrix it was projected through says exactly where the cockpit put it.
    //
    // (Only 'falling'. An EXPLODING wreck is drawn as four PIECE0-3 fragments deliberately
    // OFFSET from its centre by debrisSpread(), so its pieces' origins are NOT the wreck's
    // position — measuring them here would be asserting the burst does not open. The identity
    // check above is what covers the exploding phase.)
    const misplaced: string[] = []
    let measured = 0

    for (const [i, f] of frames.entries()) {
      for (const d of f.wreckDraws) {
        if (d.wreck.phase !== 'falling') continue
        const calls = f.proj.slice(d.from, d.to)
        if (calls.length === 0) continue // wholly behind the eye — nothing was drawn
        measured += 1

        // rb4-6: a wreck is a DISPLAY-space object. A downed plane leaves the world sim (the ROM's
        // `STA PLSTAT+6 ;CLR PLANE`, :2741) and main.ts converts it through `displayPos` once, at
        // the `explode` boundary — so its stored (x, y) is already where it is on screen, and
        // measuring it needs no eye. (Which is also why the fake Enemy literal is gone.)
        const want = ndcOfDisplay(d.wreck.x, d.wreck.y, d.wreck.depth)
        const o = originNdc(calls[0].mvp)
        if (o.w <= 0 || Math.abs(o.x - want.x) > 1e-9 || Math.abs(o.y - want.y) > 1e-9) {
          misplaced.push(
            `frame ${i}: a wreck falling at depth ${d.wreck.depth} was drawn somewhere else`,
          )
        }
      }
    }

    expect(measured, 'no falling wreck was measured').toBeGreaterThan(0)
    expect(
      misplaced,
      'A downed plane is being DRAWN at a different depth from the one it fell to.\n',
    ).toEqual([])
  })
})

// tests/cockpit-loop.test.ts
//
// Story rb4-1 — round 4. THE COCKPIT IS BOOTED AND FLOWN. This file exists because of one
// sentence that this repo has repeated to itself in four different files, believed without
// checking, and been robbed by three times:
//
//     "main.ts touches `document` at module scope, so under vitest (environment: 'node') it
//      CANNOT BE IMPORTED — every line in it is unreachable from every test in the suite."
//
// ─── IT IS NOT TRUE ──────────────────────────────────────────────────────────────────────
//
// `document` and `window` are globals. Globals can be stubbed. This file stubs them, imports
// src/main.ts, catches the `requestAnimationFrame` callback the module hands out on the way in,
// and then DRIVES THE REAL LOOP — the real fixed-step accumulator, the real calc-frames, the
// real spawn roll, the real despawn — against a fake canvas that records every stroke.
//
// ─── WHY THAT IS THE WHOLE POINT, AND NOT A CONVENIENCE ──────────────────────────────────
//
// Because that one false sentence is the ROOT of every rb4-1 rejection. Believing main.ts was
// untestable, every guard on it was written as a REGEX over its source text — and a regex can
// only ask what the code SAYS, while the bug is always what the code DOES. The scoreboard:
//
//   round 1  two depth constants left unscaled              — suite green
//   round 2  four regexes on main.ts; a rival renderer with a fresh name walked around all four
//                                                            — suite green
//   round 3  the despawn moved to core (blimpOffScreen), and main.ts kept the BOOLEAN:
//                blimp = blimpOffScreen(drifted, aspect) ? null : drifted
//            The Reviewer added ONE `||` and a 640 and put the shipped bug back, WORSE — the
//            airship now deleted on its FIRST calc-frame, at 70-84 % of the way to the edge,
//            in plain view:
//                const gone = blimpOffScreen(drifted, aspect) || Math.abs(drifted.x) > REAP_LIMIT
//            He touched no test, no core file, and no findings JSON.  — suite 832/832 GREEN
//
// Every guard he passed asked whether main.ts *named* the right function. It imported it (regex).
// It referenced it (noUnusedLocals). It said "despawn" (regex). It assigned `blimp = null`
// somewhere (regex — satisfied by the KILL path he never touched). All true, all satisfied by a
// lie, because the OR short-circuited and the correct predicate never decided anything.
//
//     IMPORTED IS NOT OBEYED. NAMED IS NOT USED. The only thing that cannot be faked is the
//     EFFECT ON WHAT THE PLAYER SEES.
//
// So this file does not read main.ts. It RUNS it, and watches the airship.
//
// ─── THE OBSERVABLE ──────────────────────────────────────────────────────────────────────
//
// The ONLY thing asserted below is the sequence of blimp states that reach `blimpSegments` —
// the function that turns the airship into vectors on the canvas. That is, literally, the frames
// the player sees the blimp in. It is the least gameable signal in the game:
//
//   * A rival renderer cannot substitute for it — screen-scale.test.ts's DRAW PATH guard forbids
//     main.ts stroking anything that is not a MEASURED core function, and blimp-wiring forbids a
//     local `blimpSegments`. If main.ts stops calling it, `drawn` is EMPTY and this file fails.
//   * The strokes are cross-checked against the fake canvas (below), so a call to `blimpSegments`
//     whose result is thrown away and replaced is caught too.
//
// From that sequence alone, four things are proved, and no name, comment, import, constant or
// expression shape appears in any of them (re-seated by rb4-15 — the machine APPROACHES):
//
//   1. the airship ENTERS at the ROM depth (Z = 0x1000) and is on screen the moment it appears
//   2. every frame-to-frame move is EXACTLY one core `step` — it cannot be teleported, double-
//      stepped, or hurried past the line
//   3. it APPROACHES: the drawn depth closes by the ROM's 0x80 every calc-frame
//   4. THE ONE THAT MATTERS: the state main.ts DROPPED — the successor of the last state it drew —
//      must be genuinely past the ROM's Z = 0x100 line by core's own reckoning. An early bound, in
//      any shape, drops a state above the line. This test says so, by name, with the number.
//
// A despawn bound smuggled back into main.ts under ANY name, in ANY shape — a const, a bare
// literal, an `||`, an `&&`, a helper function, an early `return`, a frame counter — changes
// WHICH state gets dropped, and (4) fails. There is nothing to walk around, because there is
// no text being inspected.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRng, nextFloat } from '@arcade/shared/rng'

import { sceneProjection, type SceneSegment } from '../src/core/scene'
import { inFrame } from '../src/core/screen'
import type { Mat4 } from '@arcade/shared/math3d'
import type { Blimp } from '../src/core/blimp'

/**
 * THE GENUINE CORE — `vi.importActual`, NOT the module the cockpit gets.
 *
 * This matters, and getting it wrong cost me an hour: `vi.mock` below replaces `../src/core/blimp`
 * for EVERY importer in this file, the test included. Asserting with the tapped `blimpSegments`
 * would have appended the test's own visibility checks to the recording it was checking — the
 * observer writing into the observation. So every assertion below is made with the UNMOCKED
 * functions, and the tap is used for nothing but writing down what the cockpit did.
 */
// rb4-15 mid-migration mirror: the TARGET module shape — one-arg reapBlimp, no
// blimpOffScreen (the drifter's screen-edge predicate retires with the drifter).
// `typeof import` would pin whichever side of the migration the source currently
// sits on; the mirror + `as unknown as` bridges the contravariant function members
// (the rb4-7 lesson). Every member the tests call is still fully typed, and
// realReap() fails loud-and-clear while the export is missing (RED-friendly).
interface CoreBlimp {
  readonly BLIMP_SPAWN_CHANCE: number
  readonly step: (b: Blimp) => Blimp
  readonly reapBlimp?: (b: Blimp) => Blimp | null
  readonly blimpSegments: (b: Blimp, viewProj: Mat4) => readonly SceneSegment[]
}
const core = (await vi.importActual<object>('../src/core/blimp')) as unknown as CoreBlimp
const { BLIMP_SPAWN_CHANCE } = core
const realStep = core.step
const realSegments = core.blimpSegments
function realReap(b: Blimp): Blimp | null {
  if (core.reapBlimp === undefined) {
    throw new Error('src/core/blimp.ts must export reapBlimp(blimp) (rb4-15 RED contract)')
  }
  return core.reapBlimp(b)
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE RECORDER — a transparent tap on core/blimp. It DELEGATES to the real module (this is
// not a fake blimp; it is the real blimp, watched), so the sim main.ts runs is the shipped
// sim, byte for byte. It only writes down what went past.
// ─────────────────────────────────────────────────────────────────────────────────────────

const rec = vi.hoisted(() => ({
  spawned: [] as unknown[],
  spawnedAt: [] as number[], // display frame of each blimp spawn (parallel to `spawned`)
  waves: [] as Array<{ display: number; count: number }>, // every plane wave, as it spawned
  drawn: [] as Array<{ display: number; blimp: unknown }>,
  display: 0,
  reset(): void {
    this.spawned = []
    this.spawnedAt = []
    this.waves = []
    this.drawn = []
    this.display = 0
  },
}))

vi.mock('../src/core/blimp', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/core/blimp')>()
  return {
    ...real,
    spawn(rng: Parameters<typeof real.spawn>[0], aspect: number) {
      const b = real.spawn(rng, aspect)
      rec.spawned.push(b)
      rec.spawnedAt.push(rec.display)
      return b
    },
    blimpSegments(blimp: Blimp, viewProj: Parameters<typeof real.blimpSegments>[1]) {
      rec.drawn.push({ display: rec.display, blimp })
      return real.blimpSegments(blimp, viewProj)
    },
  }
})

// rb4-15: a second transparent tap, on the WAVE spawner, so the N.PLNZ gate is checkable
// from the cockpit — how many planes had appeared when each airship rolled in. Delegates
// to the real module; it only writes down what went past.
vi.mock('../src/core/waves', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/core/waves')>()
  return {
    ...real,
    spawnWave(...args: Parameters<typeof real.spawnWave>) {
      const wave = real.spawnWave(...args)
      rec.waves.push({ display: rec.display, count: wave.length })
      return wave
    },
  }
})

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE STUB CABINET — a canvas that records vectors instead of glowing them
// ─────────────────────────────────────────────────────────────────────────────────────────

interface Stroke {
  readonly op: 'moveTo' | 'lineTo'
  readonly x: number
  readonly y: number
}

/** Everything the loop drew on one display frame. */
interface Painted {
  readonly strokes: readonly Stroke[]
}

interface Cockpit {
  /** Advance the browser one display frame (nowMs is monotone). Returns what got painted. */
  tick(): Painted
  readonly aspect: number
}

/**
 * Boot src/main.ts against a fake DOM and hand back a handle that drives its rAF callback.
 *
 * `seedMs` is what `Date.now()` will answer — main.ts seeds the BLMOTN spawn Rng with
 * `(Date.now() ^ 0x5eed) >>> 0`, so pinning it makes the blimp's whole life deterministic
 * without changing one line of the game.
 */
async function bootCockpit(width: number, height: number, seedMs: number): Promise<Cockpit> {
  rec.reset()
  vi.resetModules()

  let strokes: Stroke[] = []
  const ctx = {
    // the vector path — the only thing this test cares about
    beginPath: () => {},
    moveTo: (x: number, y: number) => strokes.push({ op: 'moveTo', x, y }),
    lineTo: (x: number, y: number) => strokes.push({ op: 'lineTo', x, y }),
    stroke: () => {},
    // the chrome (background fill, HUD text, the pause card) — accepted and ignored
    fillRect: () => {},
    fillText: () => {},
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
  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    getContext: () => ctx,
  }

  let rafCallback: ((nowMs: number) => void) | null = null
  vi.stubGlobal('document', { getElementById: () => canvas })
  vi.stubGlobal('window', {
    innerWidth: width,
    innerHeight: height,
    addEventListener: () => {}, // no pilot: no keys are ever held, so nothing is ever fired
    removeEventListener: () => {},
    requestAnimationFrame: (cb: (nowMs: number) => void) => {
      rafCallback = cb
      return 1
    },
  })
  vi.spyOn(Date, 'now').mockReturnValue(seedMs)

  await import('../src/main')
  if (rafCallback === null) throw new Error('main.ts never scheduled a frame — the cockpit did not boot')
  const frame = rafCallback as (nowMs: number) => void

  // 16 ms of wall-clock per display frame — a real 60 Hz browser. The sim's ~10.42 Hz calc-frames
  // therefore fall out of main.ts's OWN accumulator, exactly as they do in the cabinet: this test
  // does not get to choose when a calc-frame happens.
  let nowMs = 0
  return {
    aspect: width / height,
    tick(): Painted {
      rec.display += 1
      strokes = []
      nowMs += 16
      frame(nowMs)
      return { strokes }
    },
  }
}

beforeEach(() => rec.reset())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE FLIGHT PLAN — fly the booted cockpit and collect the airship's life
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * A `Date.now()` seed whose blimpRng stream rolls UNDER the ~25 % chance early and OFTEN.
 *
 * rb4-15 makes the spawn decision TWO-gated (four planes must have appeared, THEN the
 * roll — RBARON.MAC:2325-2331), so WHICH draw of main.ts's blimpRng is the accepted roll
 * now depends on how many wave decisions pass before the sky has shown four planes (and
 * on whether Dev draws per decision or per open gate). Rather than guess that index,
 * pick a seed whose FIRST draw wins AND whose first six draws include at least three
 * winners — dense enough that the first open-gate decision lands a blimp for any
 * reasonable wiring. FOUND, not hardcoded, and deliberately CONTRACT-AGNOSTIC: it reads
 * the RAW Rng floats against BLIMP_SPAWN_CHANCE (shouldSpawnBlimp's own gate matrix is
 * pinned in tests/core/blimp-approach.test.ts), so it works identically on both sides
 * of the migration instead of quietly failing to spawn and passing vacuously.
 */
function seedThatSpawnsABlimp(): number {
  for (let t = 1; t < 500_000; t++) {
    // main.ts: createRng((Date.now() ^ 0x5e_ed) >>> 0) is the blimpRng stream
    const rng = createRng((t ^ 0x5e_ed) >>> 0)
    const draws = Array.from({ length: 6 }, () => nextFloat(rng))
    const wins = draws.filter((d) => d < BLIMP_SPAWN_CHANCE).length
    if (draws[0] < BLIMP_SPAWN_CHANCE && wins >= 3) return t
  }
  throw new Error('no Date.now seed rolls a dense blimp stream — has BLIMP_SPAWN_CHANCE changed?')
}

const SEED_MS = seedThatSpawnsABlimp()

/** NDC ([-1,1], +y up) → canvas pixels — main.ts's own toPixel, mirrored so we can find its strokes. */
const toPixel = (nx: number, ny: number, w: number, h: number): [number, number] => [
  ((nx + 1) / 2) * w,
  ((1 - ny) / 2) * h,
]

/** One frame on which the cockpit drew the airship. */
interface Sighting {
  readonly display: number
  readonly blimp: Blimp
}

/** The airship's life, as observed from the canvas. A SNAPSHOT — `rec` is never read after this. */
interface Life {
  /** Every DISTINCT blimp state the cockpit drew, in order — one per calc-frame it survived. */
  readonly states: readonly Blimp[]
  /** `states`, split into one array per airship (rb4-15: after the first is reaped past the
   *  player, the two-gate roll may legitimately land a SECOND — each life is its own machine). */
  readonly lives: ReadonlyArray<readonly Blimp[]>
  /** Every display frame on which the cockpit drew the airship, with the state it drew. */
  readonly sightings: readonly Sighting[]
  /** The painted output of every display frame, in order. */
  readonly painted: readonly Painted[]
  /** How many display frames were flown in total. */
  readonly displayFrames: number
  /** How many airships rolled in over the whole run. */
  readonly spawns: number
  /** Every plane wave the cockpit spawned: when, and how many planes it held (rb4-15). */
  readonly planeWaves: ReadonlyArray<{ readonly display: number; readonly count: number }>
  /** The display frame each airship rolled in on (parallel to the lives, rb4-15). */
  readonly blimpSpawnDisplays: readonly number[]
  readonly aspect: number
}

/** Boot the cockpit, fly it for `displayFrames`, and report the airship's whole life.
 *  rb4-15: 3000 display frames ≈ 480 calc-frames — room for the sky to show FOUR planes
 *  (the N.PLNZ gate), the roll to land, and the 31-calc-frame approach to run its course. */
async function flyTheCockpit(width: number, height: number, displayFrames = 3000): Promise<Life> {
  const cockpit = await bootCockpit(width, height, SEED_MS)
  const painted: Painted[] = []
  for (let i = 0; i < displayFrames; i++) painted.push(cockpit.tick())

  const sightings: Sighting[] = rec.drawn.map((d) => ({ display: d.display, blimp: d.blimp as Blimp }))
  const spawns = rec.spawned.length

  // Collapse the per-display-frame draw record to the DISTINCT sim states. The sim ticks at
  // ~10.42 Hz and the browser at ~62.5 Hz, so each state is drawn about six times.
  const states: Blimp[] = []
  for (const s of sightings) {
    if (states.length === 0 || states[states.length - 1] !== s.blimp) states.push(s.blimp)
  }

  // Split the state sequence into one life per airship. The recorder tap returns the exact
  // object main.ts stores, so a life starts precisely at a state the spawn wrapper minted —
  // identity, not a heuristic.
  const spawnSet = new Set(rec.spawned)
  const lives: Blimp[][] = []
  for (const s of states) {
    if (spawnSet.has(s) || lives.length === 0) lives.push([s])
    else lives[lives.length - 1].push(s)
  }
  return {
    states,
    lives,
    sightings,
    painted,
    displayFrames,
    spawns,
    planeWaves: [...rec.waves],
    blimpSpawnDisplays: [...rec.spawnedAt],
    aspect: width / height,
  }
}

/** Is ANY part of the airship's REAL drawn geometry inside the frame? Ground truth for "visible". */
function isVisible(b: Blimp, aspect: number): boolean {
  return realSegments(b, sceneProjection(aspect)).some((s) => inFrame(s.x1) || inFrame(s.x2))
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE TESTS
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('THE COCKPIT BOOTS — main.ts is not, and never was, untestable', () => {
  it('src/main.ts imports, wires its canvas, and schedules a frame under a stub DOM', async () => {
    const cockpit = await bootCockpit(1600, 900, SEED_MS)
    const first = cockpit.tick()
    // The horizon alone is a fistful of vectors — if nothing was stroked, main.ts is not drawing.
    expect(first.strokes.length, 'the booted cockpit must paint vectors on the canvas').toBeGreaterThan(0)
    expect(first.strokes.some((s) => s.op === 'moveTo')).toBe(true)
    expect(first.strokes.some((s) => s.op === 'lineTo')).toBe(true)
  })

  it('the two-gate spawn actually rolls an airship in — this suite is not vacuous', async () => {
    // A test that proves nothing about a blimp that never spawned is the fourth way to be green
    // and wrong. Prove the airship exists before proving anything about it. (rb4-15: the gate
    // opens only after FOUR planes have appeared, so the airship arrives mid-run, not on the
    // opening wave — and a second one may legitimately roll in after the first flies past.)
    const { states, spawns } = await flyTheCockpit(1600, 900)
    expect(BLIMP_SPAWN_CHANCE).toBe(0.25)
    expect(spawns, 'at least one airship must roll in once the sky has shown four planes').toBeGreaterThanOrEqual(1)
    expect(states.length, 'and the cockpit must actually DRAW it').toBeGreaterThan(10)
  }, 30_000)
})

describe('THE AIRSHIP, FLOWN IN THE REAL COCKPIT — it approaches, and the reap is the ROM line', () => {
  // 16:9 is the cabinet. The other two aspects prove the entry visibility and the step
  // fidelity are window-independent — a poisoned `aspect` argument still dies here.
  const CABINETS: ReadonlyArray<readonly [string, number, number]> = [
    ['16:9', 1600, 900],
    ['4:3', 1200, 900],
    ['21:9', 2100, 900],
  ]

  it('the FIRST airship waits for the sky to show FOUR planes — the N.PLNZ gate, flown (:2325-2331)', async () => {
    // The core gate matrix is pinned in blimp-approach.test.ts; THIS proves main.ts feeds it
    // the real count. Sum the planes of every wave the cockpit spawned up to and including
    // the display frame the first airship rolled in on: the ROM requires at least four. The
    // shipped wiring rolls on the FIRST wave decision — one plane in the sky — and dies here.
    const { blimpSpawnDisplays, planeWaves } = await flyTheCockpit(1600, 900)
    expect(blimpSpawnDisplays.length, 'an airship must roll in during the run').toBeGreaterThanOrEqual(1)
    const firstBlimpAt = blimpSpawnDisplays[0]
    const planesShown = planeWaves
      .filter((wv) => wv.display <= firstBlimpAt)
      .reduce((sum, wv) => sum + wv.count, 0)
    expect(
      planesShown,
      `the airship rolled in on display frame ${firstBlimpAt} with only ${planesShown} plane(s) ` +
        `shown — LDA N.PLNZ / CMP I,4 / BCC skips the blimp until FOUR have appeared`,
    ).toBeGreaterThanOrEqual(4)
  }, 30_000)

  it.each(CABINETS)('(%s) every life ENTERS deep, at the ROM depth, IN FRAME — visible on arrival', async (_n, w, h) => {
    // rb4-15: the machine enters at Z = 0x1000 = 4096 (INITBP, RBARON.MAC:1425-1426) — a
    // distant airship the player watches arrive, not a prop materialising at a cruise depth.
    const { lives, aspect } = await flyTheCockpit(w, h)
    expect(lives.length).toBeGreaterThanOrEqual(1)
    for (const life of lives) {
      const entry = life[0]
      expect(entry.depth, 'every airship must enter at BLIMP_Z_START = 0x1000').toBe(0x1000)
      expect(isVisible(entry, aspect), 'and the player must see it arrive').toBe(true)
    }
  }, 30_000)

  it.each(CABINETS)('(%s) every move is EXACTLY one core step — it cannot be hurried past the line', async (_n, w, h) => {
    // Closes the "close it out faster" family: double-stepping, teleporting, or mutating the pose
    // would all reap a visible airship "legitimately". The drawn path must BE the core approach.
    const { lives } = await flyTheCockpit(w, h)
    expect(lives.length, 'no airship flew — this guard would pass vacuously').toBeGreaterThanOrEqual(1)
    for (const life of lives) {
      for (let i = 1; i < life.length; i++) {
        expect(life[i], `frame ${i}: the cockpit moved the airship somewhere core/blimp.step did not`)
          .toEqual(realStep(life[i - 1]))
      }
    }
  }, 30_000)

  it.each(CABINETS)('(%s) APPROACHES — the drawn depth CLOSES by the ROM rate, frame on frame', async (_n, w, h) => {
    // The wiring-level mirror of BLMOTN :4259-4265: between every two states the cockpit
    // drew of one airship, the depth fell by exactly 0x80 = 128. The shipped drifter's
    // delta is 0 — the one-number discriminator between the machines, read off the canvas.
    const { lives } = await flyTheCockpit(w, h)
    expect(lives[0].length, 'the approach must be drawn across many calc-frames').toBeGreaterThan(1)
    for (const life of lives) {
      for (let i = 1; i < life.length; i++) {
        expect(life[i - 1].depth - life[i].depth, `state ${i}`).toBe(0x80)
      }
      expect(life[life.length - 1].depth, 'no drawn state may sit below the 0x100 line')
        .toBeGreaterThanOrEqual(0x100)
    }
  }, 30_000)

  it.each(CABINETS)(
    '(%s) THE ONE THAT MATTERS: the state the cockpit DROPPED was genuinely past the ROM line',
    async (_n, w, h) => {
      // Nothing shot the airship — `held` is empty, so the guns never fire (no shells, no hits).
      // The ONLY way it can stop being drawn is that main.ts reaped it. So: take the FIRST
      // life (the run is ~480 calc-frames; a 31-frame life beginning mid-run always completes),
      // advance its last drawn state one core calc-frame (exactly the state main.ts then
      // binned), and demand that core agrees it was gone — and that "gone" is the ROM's Z line
      // (BLMOTN :4266-4270), not a screen-edge invention or an early bound.
      const { lives, sightings, displayFrames } = await flyTheCockpit(w, h)

      const firstLife = lives[0]
      const lastDrawn = firstLife[firstLife.length - 1]
      const dropped = realStep(lastDrawn) // what main.ts had in hand when it decided to reap

      expect(
        realReap(dropped),
        `core/blimp.reapBlimp says the state the cockpit binned (depth ${dropped.depth}) was still ` +
          `alive. Something in src/main.ts is overruling the reap — a bound, a counter, a second ` +
          `operand. The despawn is ONE call with no operator in it: blimp = reapBlimp(stepped)`,
      ).toBeNull()
      expect(dropped.depth, 'the binned state sits below Z = 0x100 — it flew past the player').toBeLessThan(0x100)
      expect(lastDrawn.depth, 'and the last DRAWN state does not — the reap is never early')
        .toBeGreaterThanOrEqual(0x100)

      // It must also actually LEAVE — an airship that never despawns closes forever, firing.
      // (The FIRST life's last sighting: a later airship may legitimately still be aloft at
      // the end of the run, so the whole-run last sighting proves nothing about this one.)
      const lifeSightings = sightings.filter((s) => firstLife.includes(s.blimp))
      const lastSeenOn = lifeSightings[lifeSightings.length - 1].display
      expect(lastSeenOn, 'the airship never left — the approach was never reaped')
        .toBeLessThan(displayFrames)
    },
    30_000,
  )

  it('the recorded airship is the one on the CANVAS — the tap is not being bypassed', async () => {
    // Guards the observable itself. If main.ts called blimpSegments and then drew something else
    // (round 2's defeat, one level up), `rec.drawn` would be a fiction. So: take a display frame on
    // which the airship was drawn, project its REAL geometry, and find those exact pixels among the
    // vectors the canvas actually received.
    const W = 1600
    const H = 900
    const { states, sightings, painted, aspect } = await flyTheCockpit(W, H)

    const { display, blimp } = sightings[Math.floor(sightings.length / 2)]
    expect(states).toContain(blimp)

    const segs = realSegments(blimp, sceneProjection(aspect))
    expect(segs.length, 'the airship has 36 vertices — it must project to real vectors').toBeGreaterThan(10)

    const frameStrokes = painted[display - 1].strokes
    const hit = segs.filter((s) => {
      const [px, py] = toPixel(s.x1, s.y1, W, H)
      return frameStrokes.some(
        (st) => st.op === 'moveTo' && Math.abs(st.x - px) < 1e-6 && Math.abs(st.y - py) < 1e-6,
      )
    })
    expect(
      hit.length,
      'core/blimp.blimpSegments produced the airship, and its vectors are NOT on the canvas. ' +
        'main.ts is drawing the blimp with something else.',
    ).toBeGreaterThan(segs.length / 2)
  }, 30_000)
})

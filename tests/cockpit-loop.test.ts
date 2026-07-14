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
// expression shape appears in any of them:
//
//   1. the airship ENTERS at an edge and is on screen the moment it appears
//   2. every frame-to-frame move is EXACTLY one core `step` — it cannot be teleported, double-
//      stepped, or hurried off the edge
//   3. it CROSSES: through the centre, out to the far side
//   4. THE ONE THAT MATTERS: the state main.ts DROPPED — the successor of the last state it drew —
//      must be genuinely off-screen by core's own reckoning, at the aspect of the canvas the game
//      is really being drawn on. Round 3's bypass drops it at ndc 0.70. This test says so, by name,
//      with the number.
//
// A despawn bound smuggled back into main.ts under ANY name, in ANY shape — a const, a bare
// literal, an `||`, an `&&`, a helper function, an early `return`, a frame counter, a poisoned
// aspect argument — changes WHICH state gets dropped, and (4) fails. There is nothing to walk
// around, because there is no text being inspected.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRng, nextFloat } from '@arcade/shared/rng'

import { sceneProjection } from '../src/core/scene'
import { ndcX, inFrame } from '../src/core/screen'
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
const core = await vi.importActual<typeof import('../src/core/blimp')>('../src/core/blimp')
const { shouldSpawnBlimp, BLIMP_SPAWN_CHANCE } = core
const realStep = core.step
const realOffScreen = core.blimpOffScreen
const realSegments = core.blimpSegments

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE RECORDER — a transparent tap on core/blimp. It DELEGATES to the real module (this is
// not a fake blimp; it is the real blimp, watched), so the sim main.ts runs is the shipped
// sim, byte for byte. It only writes down what went past.
// ─────────────────────────────────────────────────────────────────────────────────────────

const rec = vi.hoisted(() => ({
  spawned: [] as unknown[],
  drawn: [] as Array<{ display: number; blimp: unknown }>,
  display: 0,
  reset(): void {
    this.spawned = []
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
      return b
    },
    blimpSegments(blimp: Blimp, viewProj: Parameters<typeof real.blimpSegments>[1]) {
      rec.drawn.push({ display: rec.display, blimp })
      return real.blimpSegments(blimp, viewProj)
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
 * A `Date.now()` whose BLMOTN roll lands under the ~25 % chance, so an airship rolls in on the
 * cockpit's very first wave decision. FOUND, not hardcoded: it is re-derived here from the real
 * `createRng`/`nextFloat`/`shouldSpawnBlimp`, so if the Rng or the chance ever changes, this
 * finds the new answer instead of quietly failing to spawn a blimp and passing vacuously.
 */
function seedThatSpawnsABlimp(): number {
  for (let t = 1; t < 500_000; t++) {
    // main.ts: createRng((Date.now() ^ 0x5e_ed) >>> 0), and the FIRST draw off that Rng is the roll
    if (shouldSpawnBlimp(nextFloat(createRng((t ^ 0x5e_ed) >>> 0)))) return t
  }
  throw new Error('no Date.now seed rolls a blimp — has BLIMP_SPAWN_CHANCE changed?')
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
  /** Every display frame on which the cockpit drew the airship, with the state it drew. */
  readonly sightings: readonly Sighting[]
  /** The painted output of every display frame, in order. */
  readonly painted: readonly Painted[]
  /** How many display frames were flown in total. */
  readonly displayFrames: number
  /** How many airships rolled in over the whole run. */
  readonly spawns: number
  readonly aspect: number
}

/** Boot the cockpit, fly it for `displayFrames`, and report the airship's whole life. */
async function flyTheCockpit(width: number, height: number, displayFrames = 1400): Promise<Life> {
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
  return { states, sightings, painted, displayFrames, spawns, aspect: width / height }
}

const ndcOf = (b: Blimp, aspect: number): number => ndcX(b.x, b.depth, aspect)

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

  it('the BLMOTN roll actually rolls an airship in — this suite is not vacuous', async () => {
    // A test that proves nothing about a blimp that never spawned is the fourth way to be green
    // and wrong. Prove the airship exists before proving anything about it.
    const { states, spawns } = await flyTheCockpit(1600, 900)
    expect(BLIMP_SPAWN_CHANCE).toBe(0.25)
    expect(spawns, 'exactly one airship should roll in during the opening wave').toBe(1)
    expect(states.length, 'and the cockpit must actually DRAW it').toBeGreaterThan(10)
  })
})

describe('THE AIRSHIP, FLOWN IN THE REAL COCKPIT — it is never deleted while the player can see it', () => {
  // 16:9 is the cabinet. The other two aspects prove the despawn tracks the WINDOW, not a
  // constant fitted to one of them — a poisoned `aspect` argument dies here too.
  const CABINETS: ReadonlyArray<readonly [string, number, number]> = [
    ['16:9', 1600, 900],
    ['4:3', 1200, 900],
    ['21:9', 2100, 900],
  ]

  it.each(CABINETS)('(%s) ENTERS at an edge, IN FRAME — it does not materialise mid-screen', async (_n, w, h) => {
    const { states, aspect } = await flyTheCockpit(w, h)
    const entry = states[0]
    const ndc = ndcOf(entry, aspect)
    expect(Math.abs(ndc), `the airship entered at ndc ${ndc.toFixed(3)} — that is the middle of the screen`)
      .toBeGreaterThanOrEqual(0.7)
    expect(Math.abs(ndc), 'and it must be INSIDE the frame, so the player sees it arrive').toBeLessThanOrEqual(1)
    expect(isVisible(entry, aspect)).toBe(true)
  })

  it.each(CABINETS)('(%s) every move is EXACTLY one core step — it cannot be hurried off the edge', async (_n, w, h) => {
    // Closes the "drift it out faster" family: double-stepping, teleporting, or mutating the pose
    // would all reap a visible airship "legitimately". The drawn path must BE the core drift.
    const { states } = await flyTheCockpit(w, h)
    for (let i = 1; i < states.length; i++) {
      expect(states[i], `frame ${i}: the cockpit moved the airship somewhere core/blimp.step did not`)
        .toEqual(realStep(states[i - 1]))
    }
  })

  it.each(CABINETS)('(%s) CROSSES the frame — edge, through the centre, out the far side', async (_n, w, h) => {
    const { states, aspect } = await flyTheCockpit(w, h)
    const path = states.map((b) => ndcOf(b, aspect))
    const side = Math.sign(path[0])
    expect(Math.min(...path.map(Math.abs)), 'the airship must pass through the middle of the screen')
      .toBeLessThan(0.1)
    expect(
      Math.max(...path.map((n) => (Math.sign(n) === -side ? Math.abs(n) : 0))),
      'and sail out the FAR side — "drifts across the screen" (rb2-10 AC), not "pops and vanishes"',
    ).toBeGreaterThan(0.9)
  })

  it.each(CABINETS)(
    '(%s) THE ONE THAT MATTERS: the state the cockpit DROPPED was genuinely off-screen',
    async (_n, w, h) => {
      // Nothing shot the airship — `held` is empty, so the guns never fire (no shells, no hits).
      // The ONLY way it can stop being drawn is that main.ts despawned it. So: take the last state
      // it drew, advance it one core calc-frame (that is exactly the `drifted` main.ts then reaped),
      // and demand that core — at the aspect of the canvas the game is REALLY drawn on — agrees it
      // was gone.
      //
      // ROUND 3'S BYPASS DIES HERE, LOUDLY. `|| Math.abs(drifted.x) > 640` drops the airship on its
      // FIRST calc-frame, at ndc ~0.70 — 70 % of the way to the edge, all 36 vertices of it being
      // stroked onto the canvas. This assertion prints that number back at you.
      const { states, aspect, sightings, displayFrames } = await flyTheCockpit(w, h)

      const lastDrawn = states[states.length - 1]
      const dropped = realStep(lastDrawn) // what main.ts had in hand when it decided to reap

      expect(
        realOffScreen(dropped, aspect),
        `THE AIRSHIP WAS DELETED IN PLAIN VIEW.\n` +
          `  last drawn at ndc ${ndcOf(lastDrawn, aspect).toFixed(3)}\n` +
          `  deleted at    ndc ${ndcOf(dropped, aspect).toFixed(3)}  (|ndc| <= 1 is ON SCREEN)\n` +
          `  aspect        ${aspect.toFixed(4)} (the canvas the game is actually drawn on)\n\n` +
          `core/blimp.reapBlimp says this airship is still in the frame, and the cockpit binned it ` +
          `anyway. Something in src/main.ts is overruling the despawn — a bound, a counter, a ` +
          `second operand, a doctored aspect. The despawn is ONE call with no operator in it:\n` +
          `      blimp = reapBlimp(drifted, aspect)\n`,
      ).toBe(true)

      // …and the hull, not just the centre: not one vertex of the airship may still be drawable.
      expect(isVisible(dropped, aspect), 'the airship\'s geometry was still inside the frame').toBe(false)

      // It must also actually LEAVE — an airship that never despawns drifts to infinity, firing.
      // (It was drawn, and by the end of the run it is not being drawn any more.)
      const lastSeenOn = sightings[sightings.length - 1].display
      expect(lastSeenOn, 'the airship never left — the unbounded drift was never reaped')
        .toBeLessThan(displayFrames)
    },
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
  })
})

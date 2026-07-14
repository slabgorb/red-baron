// tests/core/camera-shape.test.ts
//
// Story rb4-5 — RED phase (Han Solo / TEA). "THE CAMERA IS THE WRONG SHAPE —
// the arcade TRANSLATES the world; we ROTATE it." Cluster C4 (subsumes FL-013,
// FL-014, FL-015, FL-001, FL-004, FL-005). A genuine rewrite of the view pipeline,
// not a constant tweak.
//
// THE ROM PIPELINE (verified against the CITABLE quarry ~/Projects/red-baron-source-text —
// NEVER the R2BRON/R2GRND decoys):
//   * NO YAW ROTATION. Turning adds the DISCHK-scaled PLDELX to UNIV4X, a linear
//     universe-X accumulator, and objects are drawn at (their X − UNIV4X)
//     (RBARON.MAC:3196-3213). The world PANS sideways; an object's depth never
//     changes when you turn.
//   * NO PITCH ROTATION. Climb/dive adds the DISCHK-scaled PLDELY to I4YPOS, the
//     eye height, clamped [PLYMIN,PLYMAX] (RBARON.MAC:3237-3262). POSITH then
//     subtracts I4YPOS from every object's Y (RBGRND.MAC:279 `SBC I4YPOS ;-EYE
//     POSITION`) BEFORE the single Z rotation and the divide-by-depth. The eye
//     RISES; an object's depth never changes when you climb.
//   * THE SINGLE Z ROTATION is the bank: PFROTN = PLDELX×8, clamped ±0x100
//     (RBARON.MAC:3214-3236). Rolling still tilts the horizon — that rotation stays.
//   * DIVIDE-BY-DEPTH then + HORIZN. POSITH (RBGRND.MAC:269-322): subtract eye Y,
//     rotate by the bank (MATSTT), SCALE BY DEPTH / START DIVIDE, then
//     `LDA YLOW / ADC I,HORIZN / STA XPOS+2 ;Y RESULT` (RBGRND.MAC:301-304) — a
//     CONSTANT screen-Y offset HORIZN=$40=64 (RBARON.MAC:456) added to EVERY object.
//   * The horizon sits at the FINITE depth HORZ=$1000=4096 (RBARON.MAC:451) and
//     MOVES WITH ALTITUDE — it is not "at infinity" and it is not altitude-invariant.
//
// WHAT WE HAVE TODAY (the bug): camera.ts composes rotationZ(roll)∘rotationX(pitch)∘
// rotationY(yaw) — a full 3-D yaw+pitch camera. flight.ts drives it with a transient
// pitch and an accumulated yaw. horizon.ts pins the horizon at HORIZON_DISTANCE=10000
// with EYE_AT_ORIGIN (never moves with altitude). HORIZN is defined in topology.ts but
// applied NOWHERE. Every one of those is the wrong shape.
//
// TEST STRATEGY (scale-agnostic behavioural invariants, not pinned pixels): the exact
// ROM→canvas scale and the coordinate convention are Dev's seam (the ROM works in VG
// screen units; how they map to our NDC is an implementation choice). So these tests
// pin the SHAPE that separates a TRANSLATION from a ROTATION — depth-invariance under
// pan/climb, a constant (not depth-scaled) HORIZN offset, a finite altitude-tracking
// horizon — via the public flight→camera bridge and the real projection substrate.
// Any faithful pipeline passes; the current rotation pipeline fails.
//
// Defensive import (the house pattern): the rewrite reshapes these modules, so load
// them loosely and fail per-assertion rather than crashing collection.

import { describe, it, expect, beforeAll } from 'vitest'
import { transform, type Vec3, type Mat4 } from '@arcade/shared/math3d'
import { HORIZN, HORZ } from '../../src/core/topology'

// ─── local mirrors + loose module handles (signatures change in this rewrite) ──

interface Attitude {
  readonly roll: number
  readonly pitch: number
  readonly yaw: number
}

interface FlightState {
  readonly turnRate: number
  readonly pitchRate: number
  readonly altitude: number
  readonly heading: number
}

interface SceneSegment {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

// flight.ts bridge — the "camera shape". toAttitude/toEye map ROM flight state onto
// the camera; the rewrite makes yaw+pitch a TRANSLATION, so these change behaviour.
interface FlightModule {
  INITIAL_FLIGHT?: FlightState
  toAttitude?: (s: FlightState) => Attitude
  toEye?: (s: FlightState) => Vec3
}
// camera.ts — flightView(attitude, eye) → Mat4 (roll is the ONLY rotation left).
interface CameraModule {
  flightView?: (attitude: Attitude, eye: Vec3) => Mat4
}
// scene.ts — the projection substrate; projectPointRB projects ONE world point.
interface SceneModule {
  sceneProjection?: (aspect: number) => Mat4
  projectSegment?: (a: Vec3, b: Vec3, mvp: Mat4) => SceneSegment | null
}
// horizon.ts — the horizon must now depend on ALTITUDE (finite HORZ), not just attitude.
type HorizonFn = (...args: unknown[]) => readonly SceneSegment[]
interface HorizonModule {
  horizonSegments?: HorizonFn
}

let f: FlightModule = {}
let cam: CameraModule = {}
let scene: SceneModule = {}
let hz: HorizonModule = {}

beforeAll(async () => {
  try { f = (await import('../../src/core/flight')) as FlightModule } catch { f = {} }
  try { cam = (await import('../../src/core/camera')) as CameraModule } catch { cam = {} }
  try { scene = (await import('../../src/core/scene')) as SceneModule } catch { scene = {} }
  try { hz = (await import('../../src/core/horizon')) as HorizonModule } catch { hz = {} }
})

function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`rb4-5 RED contract: missing export ${name}`)
  return value
}

const ASPECT = 4 / 3
const base = (): FlightState => ({ ...need(f.INITIAL_FLIGHT, 'INITIAL_FLIGHT') })
const withState = (o: Partial<FlightState>): FlightState => ({ ...base(), ...o })

/** Where a world point lands in EYE space, through the real flight→camera bridge. */
function eyeSpace(state: FlightState, world: Vec3): Vec3 {
  const view = need(cam.flightView, 'flightView')(
    need(f.toAttitude, 'toAttitude')(state),
    need(f.toEye, 'toEye')(state),
  )
  return transform(view, world)
}

/** Where a world point lands in NDC, through the full projection substrate. */
function project(state: FlightState, world: Vec3): SceneSegment | null {
  const projFn = need(scene.sceneProjection, 'sceneProjection')
  const projectSegment = need(scene.projectSegment, 'projectSegment')
  const view = need(cam.flightView, 'flightView')(
    need(f.toAttitude, 'toAttitude')(state),
    need(f.toEye, 'toEye')(state),
  )
  // MVP = projection · view (the composition main.ts/landscape.ts use).
  const mvp = multiply4(projFn(ASPECT), view)
  return projectSegment(world, world, mvp)
}

/** Local 4×4 multiply so this file does not depend on math3d's export name set. */
function multiply4(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0) as unknown as Mat4
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      for (let k = 0; k < 4; k++)
        (out as number[])[r * 4 + c] += (a as number[])[r * 4 + k] * (b as number[])[k * 4 + c]
  return out
}

// ───────────────────────────────────────────────────────────────────────────
// AC-1a — turning TRANSLATES the world (UNIV4X): no yaw rotation
// ───────────────────────────────────────────────────────────────────────────
describe('rb4-5 AC1 — turning pans the world without rotating the camera (UNIV4X)', () => {
  // A rotationY(yaw) camera swings the world about the eye's up-axis: an off-nose
  // object's DEPTH (eye-space Z) changes as you turn. A UNIV4X translation only
  // slides it sideways — depth is invariant. That invariance is the whole finding.
  const AHEAD: Vec3 = [0, 0, -1000] // dead ahead, on the ground plane's centreline

  // heading WITHOUT active bank (turnRate 0): isolates the pan from the roll, which
  // legitimately rotates the scene. A settled heading is the accumulated UNIV4X pan.
  it('a turn leaves a forward object at the SAME depth (translate, not rotate)', () => {
    const level = eyeSpace(base(), AHEAD)
    const turned = eyeSpace(withState({ heading: 40 }), AHEAD)
    // depth (−Z, forward) is unchanged by a pure pan; a yaw ROTATION would change it.
    expect(turned[2]).toBeCloseTo(level[2], 3)
  })

  it('a turn DOES move the object horizontally (the world really pans)', () => {
    const level = eyeSpace(base(), AHEAD)
    const turned = eyeSpace(withState({ heading: 40 }), AHEAD)
    expect(Math.abs(turned[0] - level[0])).toBeGreaterThan(1e-3) // it panned in X…
    expect(turned[1]).toBeCloseTo(level[1], 3) // …but a level turn never lifts/drops it
  })

  it('opposite turns pan opposite ways, both at the original depth', () => {
    const rightZ = eyeSpace(withState({ heading: 30 }), AHEAD)
    const leftZ = eyeSpace(withState({ heading: -30 }), AHEAD)
    const level = eyeSpace(base(), AHEAD)
    expect(Math.sign(rightZ[0] - level[0])).toBe(-Math.sign(leftZ[0] - level[0]))
    expect(rightZ[2]).toBeCloseTo(level[2], 3)
    expect(leftZ[2]).toBeCloseTo(level[2], 3)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-1b — climb/dive TRANSLATES the eye (I4YPOS): no pitch rotation
// ───────────────────────────────────────────────────────────────────────────
describe('rb4-5 AC1 — climb/dive is an eye-height translation, not a camera pitch', () => {
  const AHEAD: Vec3 = [0, -40, -1000] // a point on the ground ahead

  it('the instantaneous camera depends on ALTITUDE, never on the transient pitchRate', () => {
    // The ROM adds PLDELY into I4YPOS and the camera only ever reads I4YPOS
    // (RBGRND.MAC:279). Two states that differ ONLY in pitchRate must render
    // IDENTICALLY — a rotationX(pitch) camera would swing the view between them.
    const a = eyeSpace(withState({ pitchRate: 0, altitude: 400 }), AHEAD)
    const b = eyeSpace(withState({ pitchRate: -23, altitude: 400 }), AHEAD)
    expect(b[0]).toBeCloseTo(a[0], 6)
    expect(b[1]).toBeCloseTo(a[1], 6)
    expect(b[2]).toBeCloseTo(a[2], 6)
  })

  it('climbing raises the eye and drops the ground point WITHOUT changing its depth', () => {
    const low = eyeSpace(withState({ altitude: 100 }), AHEAD)
    const high = eyeSpace(withState({ altitude: 700 }), AHEAD)
    expect(high[1]).toBeLessThan(low[1]) // higher eye ⇒ the ground sits lower in view
    expect(high[2]).toBeCloseTo(low[2], 3) // …but a translation never changes its depth
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-1c — the ONE rotation that stays: roll banks the horizon (rotationZ)
// ───────────────────────────────────────────────────────────────────────────
describe('rb4-5 AC1 — the single Z rotation (bank) survives the rewrite', () => {
  it('roll still tilts world-up toward screen-right; opposite banks tilt oppositely', () => {
    // Only PFROTN (the bank) rotates. World-up must lean under a bank, and a pure
    // bank must NOT move the dead-ahead point (roll is about the line of flight).
    const up: Vec3 = [0, 1, 0]
    const rightBank = eyeSpace(withState({ turnRate: 20 }), up)
    const leftBank = eyeSpace(withState({ turnRate: -20 }), up)
    const level = eyeSpace(base(), up)
    expect(Math.abs(level[0])).toBeLessThan(1e-6) // wings level ⇒ up stays up
    expect(Math.abs(rightBank[0])).toBeGreaterThan(1e-3) // a bank leans it
    expect(Math.sign(rightBank[0])).toBe(-Math.sign(leftBank[0]))
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-5a — HORIZN=$40=64 is a CONSTANT screen-Y offset on EVERY object (POSITH)
// ───────────────────────────────────────────────────────────────────────────
describe('rb4-5 AC5 — HORIZN is a constant Y offset added to every projected object', () => {
  it('HORIZN is the ROM $40 = 64 screen offset, distinct from the HORZ depth', () => {
    expect(HORIZN).toBe(0x40)
    expect(HORIZN).toBe(64)
    expect(HORZ).toBe(0x1000)
    expect(HORZ).toBe(4096)
    expect(HORIZN).not.toBe(HORZ) // the classic conflation the audit calls out
  })

  it('two eye-height objects at DIFFERENT depths project to the SAME screen-Y (a constant, not a divide)', () => {
    // A point at the eye's own height (world Y = eye Y) sits on the vertical centre
    // BEFORE HORIZN. POSITH then adds the SAME HORIZN to both, regardless of depth —
    // so their screen-Y are equal AND non-zero. Without HORIZN they would both be 0.
    const state = withState({ altitude: 0 }) // eye at world Y = 0 (toEye maps altitude→eye Y)
    const near = project(state, [0, 0, -800])
    const far = project(state, [0, 0, -6000])
    if (near === null || far === null) throw new Error('both eye-height points must project (w > 0)')
    expect(near.y1).toBeCloseTo(far.y1, 4) // HORIZN is depth-independent (an offset, not ÷depth)
    expect(Math.abs(near.y1)).toBeGreaterThan(1e-3) // …and non-zero: the offset was actually applied
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-5b — the horizon sits at the finite HORZ depth and MOVES WITH ALTITUDE
// ───────────────────────────────────────────────────────────────────────────
describe('rb4-5 AC5 — the horizon is at finite HORZ and tracks altitude', () => {
  // Level attitude (roll/pitch/yaw = 0) at a given altitude. The current
  // horizonSegments reads only roll/pitch/yaw (all 0 here) → a fixed horizon;
  // the rewrite must read the ALTITUDE and slide the finite-HORZ horizon by it.
  const horizonArg = (altitude: number): Record<string, number> => ({
    roll: 0, pitch: 0, yaw: 0, ...withState({ altitude }),
  })
  const horizonY = (altitude: number): number => {
    const fn = need(hz.horizonSegments, 'horizonSegments') as HorizonFn
    const segs = fn(horizonArg(altitude), ASPECT)
    expect(segs.length).toBeGreaterThan(0)
    return (segs[0].y1 + segs[0].y2) / 2
  }

  it('climbing and diving MOVE the horizon on screen (it is not altitude-invariant)', () => {
    const low = horizonY(100)
    const high = horizonY(1400)
    // A horizon at finite depth HORZ shifts vertically as the eye rises — the current
    // horizon-at-infinity (EYE_AT_ORIGIN) leaves it dead still, which this refutes.
    expect(Math.abs(high - low)).toBeGreaterThan(1e-3)
  })

  it('climb and dive move the horizon OPPOSITE ways from level', () => {
    const level = horizonY(528)
    const climb = horizonY(1400)
    const dive = horizonY(100)
    expect(Math.sign(climb - level)).toBe(-Math.sign(dive - level))
  })
})

// tests/core/camera.test.ts
//
// Story rb1-3 — RED phase (Furiosa / TEA). The roll/pitch/yaw flight camera.
//
// CONTRACT for the GREEN phase (The Word Burgers / DEV): create
// `src/core/camera.ts`, the flight-attitude → camera-view bridge, exporting:
//
//   export interface Attitude {
//     readonly roll: number   // bank, radians — tilts the horizon (design brief: rotationZ)
//     readonly pitch: number  // climb/dive, radians (rotationX)
//     readonly yaw: number    // turn/heading, radians (rotationY)
//   }
//   export const LEVEL: Attitude              // { roll: 0, pitch: 0, yaw: 0 }
//   export function flightView(attitude: Attitude, eye: Vec3): Mat4
//
// WHY THIS SHAPE (cited):
//   * Design brief §3 pins the camera as
//     `rotationZ(roll) ∘ rotationX(pitch) ∘ rotationY(yaw) → viewMatrix`, built
//     on the SHARED Math Box (@arcade/shared/math3d) — "the horizon tilt falls
//     out of rotationZ in the view matrix." Red Baron is the first native
//     @arcade/shared consumer; it does NOT re-port math3d (scaffold guards that).
//   * Findings §8: Red Baron's model space has the nose at −Z ("Z = +behind /
//     −forward"), which ALREADY matches the shared Math Box ("looking down −Z").
//     So — unlike Battlezone, whose +Z-into-monitor world needed a heading+π
//     bridge — this camera needs NO sign bridge: forward = −Z, right = +X,
//     up = +Y (OpenGL, per math3d's own header).
//   * "The cockpit IS the camera" (findings §2): eye position is the pilot's
//     world placement; flightView translates by −eye then orients.
//
// SCOPE BOUNDARY (roadmap, design brief §4): rb1 is *foundation* — the camera.
// The authentic FLIGHT MODEL that DRIVES this attitude (PLDELX turn-rate inertia,
// the 11-step PLDELY pitch table, PFROTN = PLDELX×8 bank coupling clamped ≤0x100,
// I4YPOS altitude clamp 8*4..180*4, DISCHK feel — findings §2) is filed under
// **rb2** ("flight model"). rb1-3 builds the camera these later drive; it does
// NOT implement the dynamics. Testing them here would gold-plate rb2 into rb1.
//
// These tests pin the camera BEHAVIORALLY — where world points land in eye space
// (via the shared `transform`) — not as a specific matrix formula. Dev picks the
// composition, so long as roll banks about the forward axis, pitch about the
// right axis, yaw about the up axis, in that compose order.
//
// Loaded defensively (await import in beforeAll, the house pattern): during RED
// the module does not exist, so each test reports a clean assertion failure
// instead of a suite-collection crash.

import { describe, it, expect, beforeAll } from 'vitest'
import {
  multiply,
  rotationX,
  rotationY,
  rotationZ,
  viewMatrix,
  transform,
  type Mat4,
  type Vec3,
} from '@arcade/shared/math3d'

interface Attitude {
  readonly roll: number
  readonly pitch: number
  readonly yaw: number
}

interface CameraModule {
  LEVEL?: Attitude
  flightView?: (attitude: Attitude, eye: Vec3) => Mat4
}

let cam: CameraModule = {}

beforeAll(async () => {
  try {
    cam = (await import('../../src/core/camera')) as CameraModule
  } catch {
    cam = {}
  }
})

/** Fail loud-and-clear when a contract export is missing (RED-friendly). */
function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`src/core/camera.ts must export ${name} (rb1-3 RED contract)`)
  }
  return value
}

const ORIGIN: Vec3 = [0, 0, 0]

describe('camera — LEVEL attitude', () => {
  it('exports LEVEL = { roll: 0, pitch: 0, yaw: 0 } (no bank, no pitch, straight ahead)', () => {
    const level = need(cam.LEVEL, 'LEVEL')
    expect(level.roll).toBe(0)
    expect(level.pitch).toBe(0)
    expect(level.yaw).toBe(0)
  })

  it('a level camera at the origin is a no-op view (IDENTITY) — points map to themselves', () => {
    const view = need(cam.flightView, 'flightView')(need(cam.LEVEL, 'LEVEL'), ORIGIN)
    // math3d guarantees viewMatrix(origin, IDENTITY) === IDENTITY; a level cockpit
    // at world origin must not move, rotate, or scale anything.
    for (const p of [[3, 5, -9], [-2, 7, -1], [0, 0, -100]] as Vec3[]) {
      const eye = transform(view, p)
      expect(eye[0]).toBeCloseTo(p[0], 9)
      expect(eye[1]).toBeCloseTo(p[1], 9)
      expect(eye[2]).toBeCloseTo(p[2], 9)
    }
  })
})

describe('camera — roll banks about the forward axis (the tilting horizon)', () => {
  it('roll θ tilts world-up (0,1,0) to (sin θ, cos θ, 0) — the horizon banks by θ', () => {
    const flightView = need(cam.flightView, 'flightView')
    for (const roll of [0.2, 0.5, -0.35]) {
      const eye = transform(flightView({ roll, pitch: 0, yaw: 0 }, ORIGIN), [0, 1, 0])
      // Banking rotates the eye-space up-vector about the forward (−Z) axis by θ:
      // world "up" leans toward screen-right by exactly the bank angle.
      expect(eye[0]).toBeCloseTo(Math.sin(roll), 6)
      expect(eye[1]).toBeCloseTo(Math.cos(roll), 6)
      expect(eye[2]).toBeCloseTo(0, 6)
    }
  })

  it('roll leaves the point you are flying TOWARD fixed — roll is about the forward axis', () => {
    // A pure bank spins the world about the line of flight; the dead-ahead point
    // (on the roll axis) must not move. This discriminates roll (Z) from yaw/pitch.
    const eye = transform(need(cam.flightView, 'flightView')({ roll: 0.6, pitch: 0, yaw: 0 }, ORIGIN), [0, 0, -100])
    expect(eye[0]).toBeCloseTo(0, 6)
    expect(eye[1]).toBeCloseTo(0, 6)
    expect(eye[2]).toBeCloseTo(-100, 6)
  })
})

describe('camera — pitch climbs/dives about the right axis', () => {
  it('pitch φ swings the dead-ahead point to (0, −sin φ, −cos φ) — horizon moves vertically', () => {
    const flightView = need(cam.flightView, 'flightView')
    for (const pitch of [0.2, 0.45, -0.3]) {
      const eye = transform(flightView({ roll: 0, pitch, yaw: 0 }, ORIGIN), [0, 0, -1])
      // Rotation about the eye X (right) axis: x stays 0, the forward point rises
      // or sinks. Opposite pitches move it oppositely; magnitude = |φ|.
      expect(eye[0]).toBeCloseTo(0, 6)
      expect(eye[1]).toBeCloseTo(-Math.sin(pitch), 6)
      expect(eye[2]).toBeCloseTo(-Math.cos(pitch), 6)
    }
  })
})

describe('camera — yaw turns about the up axis (world pans, horizon holds level)', () => {
  it('yaw ψ swings the dead-ahead point to (sin ψ, 0, −cos ψ) — pans horizontally, no vertical move', () => {
    const flightView = need(cam.flightView, 'flightView')
    for (const yaw of [0.2, 0.5, -0.4]) {
      const eye = transform(flightView({ roll: 0, pitch: 0, yaw }, ORIGIN), [0, 0, -1])
      // Rotation about the eye Y (up) axis: the forward point slides sideways;
      // eye-y stays 0, which is WHY a pure turn never lifts or drops the horizon.
      expect(eye[0]).toBeCloseTo(Math.sin(yaw), 6)
      expect(eye[1]).toBeCloseTo(0, 6)
      expect(eye[2]).toBeCloseTo(-Math.cos(yaw), 6)
    }
  })

  it('yaw does NOT move world-up — a turn keeps "up" pointing up (no barrel-roll on turn)', () => {
    const eye = transform(need(cam.flightView, 'flightView')({ roll: 0, pitch: 0, yaw: 0.7 }, ORIGIN), [0, 1, 0])
    expect(eye[0]).toBeCloseTo(0, 6)
    expect(eye[1]).toBeCloseTo(1, 6)
    expect(eye[2]).toBeCloseTo(0, 6)
  })
})

describe('camera — composition order rotationZ(roll) ∘ rotationX(pitch) ∘ rotationY(yaw)', () => {
  it('a combined attitude matches the design-brief §3 compose order (rotations do not commute)', () => {
    const flightView = need(cam.flightView, 'flightView')
    const att = { roll: 0.3, pitch: -0.25, yaw: 0.4 }
    const eye: Vec3 = [12, 40, -8]
    // Expected = the shared Math Box composed in the brief's stated order. Building
    // the reference from @arcade/shared (not a hand-typed matrix) keeps the test
    // about ORDER, not internal representation.
    const orient = multiply(multiply(rotationZ(att.roll), rotationX(att.pitch)), rotationY(att.yaw))
    const reference = viewMatrix(eye, orient)
    const probes: Vec3[] = [[0, 0, -100], [30, 10, -60], [-15, -5, -120]]
    for (const p of probes) {
      const got = transform(need(cam.flightView, 'flightView')(att, eye), p)
      const want = transform(reference, p)
      expect(got[0]).toBeCloseTo(want[0], 6)
      expect(got[1]).toBeCloseTo(want[1], 6)
      expect(got[2]).toBeCloseTo(want[2], 6)
    }
    // silence unused-in-some-paths lint by referencing the direct build once
    expect(flightView(att, eye).length).toBe(16)
  })
})

describe('camera — eye position is the pilot (translation / altitude)', () => {
  it('the eye point itself maps to the origin (view translates by −eye)', () => {
    const eye: Vec3 = [50, 120, -30]
    const mapped = transform(need(cam.flightView, 'flightView')(need(cam.LEVEL, 'LEVEL'), eye), eye)
    expect(mapped[0]).toBeCloseTo(0, 6)
    expect(mapped[1]).toBeCloseTo(0, 6)
    expect(mapped[2]).toBeCloseTo(0, 6)
  })

  it('climbing (raising eye Y) drops a fixed ground point lower in view — you fly OVER the terrain', () => {
    const flightView = need(cam.flightView, 'flightView')
    const level = need(cam.LEVEL, 'LEVEL')
    const ground: Vec3 = [0, -40, -500] // a point on the ground ahead
    const low = transform(flightView(level, [0, 0, 0]), ground)
    const high = transform(flightView(level, [0, 80, 0]), ground)
    expect(high[1]).toBeLessThan(low[1]) // higher altitude ⇒ ground sits further below the eye
  })
})

describe('camera — purity & Math Box compatibility', () => {
  it('is pure — identical (attitude, eye) give a bit-identical matrix (determinism)', () => {
    const flightView = need(cam.flightView, 'flightView')
    const a = flightView({ roll: 0.12, pitch: 0.34, yaw: -0.56 }, [7, 8, 9])
    const b = flightView({ roll: 0.12, pitch: 0.34, yaw: -0.56 }, [7, 8, 9])
    expect(a.length).toBe(16)
    for (let i = 0; i < 16; i++) expect(a[i]).toBe(b[i])
  })

  it('returns a valid length-16, all-finite Mat4 that composes with multiply()', () => {
    const view = need(cam.flightView, 'flightView')({ roll: 0.4, pitch: 0.2, yaw: 1.0 }, [1, 2, 3])
    expect(view.length).toBe(16)
    const composed = multiply(view, view)
    expect(composed.length).toBe(16)
    for (const v of composed) expect(Number.isFinite(v)).toBe(true)
  })
})

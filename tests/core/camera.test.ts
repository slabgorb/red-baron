// tests/core/camera.test.ts
//
// Story rb1-3, REWRITTEN for rb4-5 — the flight camera is the WRONG SHAPE.
//
// rb1-3 built `flightView` as `rotationZ(roll) ∘ rotationX(pitch) ∘ rotationY(yaw)` —
// a full 3-D yaw+pitch camera. That is NOT Red Baron's camera. The 1980 ROM has NO
// yaw rotation (turning adds PLDELX to the linear UNIV4X and draws objects at X−UNIV4X)
// and NO pitch rotation (climb/dive adds PLDELY to the eye height I4YPOS, subtracted
// from every object's Y). The ONLY rotation is the bank — PFROTN, a single Z rotation
// (RBARON.MAC:3196-3262; RBGRND.MAC:269-322). rb4-5 rewrites this camera.
//
// CONTRACT for the GREEN phase (Yoda / DEV): `src/core/camera.ts` exports a
// TRANSLATION camera whose ONLY rotation is the bank:
//
//   export const LEVEL: Attitude                            // roll 0
//   export function flightView(attitude: Attitude, eye: Vec3): Mat4
//     //  = rotationZ(roll) then translate by −eye. The turn (UNIV4X) and altitude
//     //    (I4YPOS) arrive as the EYE translation (flight.ts toEye); the downstream
//     //    perspective divide makes that the ROM's (X−UNIV4X)/depth pan. NO
//     //    rotationX(pitch), NO rotationY(yaw) remain — pitch/yaw are NOT rotations.
//
// The camera is pinned BEHAVIOURALLY (where world points land in eye space, via the
// shared `transform`). The "no yaw/pitch rotation" block feeds a non-zero pitch/yaw
// and asserts it does NOTHING — RED against the current rotation camera.
//
// Loaded defensively (await import) so this file fails per-assertion during RED.

import { describe, it, expect, beforeAll } from 'vitest'
import { multiply, transform, type Mat4, type Vec3 } from '@arcade/shared/math3d'

// LOOSE local Attitude: roll is the only rotation. pitch/yaw are optional and, per the
// rewrite, IGNORED by the camera — they are carried here only to prove they do nothing.
interface Attitude {
  readonly roll: number
  readonly pitch?: number
  readonly yaw?: number
}

interface CameraModule {
  LEVEL?: Attitude
  flightView?: (attitude: Attitude, eye: Vec3) => Mat4
}

let cam: CameraModule = {}

beforeAll(async () => {
  try {
    cam = (await import('../../src/core/camera')) as unknown as CameraModule
  } catch {
    cam = {}
  }
})

function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`src/core/camera.ts must export ${name} (rb4-5 RED contract)`)
  return value
}

const ORIGIN: Vec3 = [0, 0, 0]
const view = (attitude: Attitude, eye: Vec3): Mat4 => need(cam.flightView, 'flightView')(attitude, eye)
const bank = (roll: number): Attitude => ({ roll, pitch: 0, yaw: 0 })

describe('camera — LEVEL is wings-level', () => {
  it('exports LEVEL with roll 0 — no bank', () => {
    expect(need(cam.LEVEL, 'LEVEL').roll).toBe(0)
  })

  it('a level camera at the origin is a no-op view (IDENTITY) — points map to themselves', () => {
    const v = view(need(cam.LEVEL, 'LEVEL'), ORIGIN)
    for (const p of [[3, 5, -9], [-2, 7, -1], [0, 0, -100]] as Vec3[]) {
      const eye = transform(v, p)
      expect(eye[0]).toBeCloseTo(p[0], 9)
      expect(eye[1]).toBeCloseTo(p[1], 9)
      expect(eye[2]).toBeCloseTo(p[2], 9)
    }
  })
})

describe('camera — the ONE rotation: roll banks about the forward axis (the tilting horizon)', () => {
  it('roll θ tilts world-up (0,1,0) to (sin θ, cos θ, 0) — the horizon banks by θ', () => {
    for (const roll of [0.2, 0.5, -0.35]) {
      const eye = transform(view(bank(roll), ORIGIN), [0, 1, 0])
      expect(eye[0]).toBeCloseTo(Math.sin(roll), 6)
      expect(eye[1]).toBeCloseTo(Math.cos(roll), 6)
      expect(eye[2]).toBeCloseTo(0, 6)
    }
  })

  it('roll leaves the point you are flying TOWARD fixed — roll is about the forward axis', () => {
    const eye = transform(view(bank(0.6), ORIGIN), [0, 0, -100])
    expect(eye[0]).toBeCloseTo(0, 6)
    expect(eye[1]).toBeCloseTo(0, 6)
    expect(eye[2]).toBeCloseTo(-100, 6)
  })
})

describe('camera — NO yaw rotation, NO pitch rotation remain (the rb4-5 fix)', () => {
  // Feed a large pitch/yaw with zero roll: a faithful camera does NOTHING (turning and
  // climbing are eye translations, applied elsewhere). The current rotationX(pitch) /
  // rotationY(yaw) camera swings the forward point — that is the bug this refutes.
  const AHEAD: Vec3 = [0, 0, -100]

  it('a non-zero YAW does not rotate the view — the forward point stays dead ahead', () => {
    const eye = transform(view({ roll: 0, pitch: 0, yaw: 0.6 }, ORIGIN), AHEAD)
    expect(eye[0]).toBeCloseTo(0, 6) // a yaw ROTATION would swing it to (sin·d, 0, −cos·d)
    expect(eye[1]).toBeCloseTo(0, 6)
    expect(eye[2]).toBeCloseTo(-100, 6)
  })

  it('a non-zero PITCH does not rotate the view — the forward point does not rise or sink', () => {
    const eye = transform(view({ roll: 0, pitch: 0.5, yaw: 0 }, ORIGIN), AHEAD)
    expect(eye[0]).toBeCloseTo(0, 6)
    expect(eye[1]).toBeCloseTo(0, 6) // a pitch ROTATION would move it to (0, sin·d, −cos·d)
    expect(eye[2]).toBeCloseTo(-100, 6)
  })

  it('only ROLL rotates: pitch+yaw set with roll 0 leaves the view an identity rotation', () => {
    const eye = transform(view({ roll: 0, pitch: 0.4, yaw: -0.5 }, ORIGIN), [10, -20, -100])
    expect(eye[0]).toBeCloseTo(10, 6)
    expect(eye[1]).toBeCloseTo(-20, 6)
    expect(eye[2]).toBeCloseTo(-100, 6)
  })
})

describe('camera — the world is TRANSLATED: pan & altitude come through the eye', () => {
  it('the eye point itself maps to the origin (view translates by −eye)', () => {
    const eye: Vec3 = [50, 120, -30]
    const mapped = transform(view(need(cam.LEVEL, 'LEVEL'), eye), eye)
    expect(mapped[0]).toBeCloseTo(0, 6)
    expect(mapped[1]).toBeCloseTo(0, 6)
    expect(mapped[2]).toBeCloseTo(0, 6)
  })

  it('a lateral eye pan (the UNIV4X turn) slides a forward object sideways WITHOUT changing its depth', () => {
    const ahead: Vec3 = [0, 0, -1000]
    const centred = transform(view(need(cam.LEVEL, 'LEVEL'), ORIGIN), ahead)
    const panned = transform(view(need(cam.LEVEL, 'LEVEL'), [300, 0, 0]), ahead)
    expect(panned[0]).not.toBeCloseTo(centred[0], 3) // it panned horizontally…
    expect(panned[2]).toBeCloseTo(centred[2], 6) // …but the depth is unchanged (translation, not rotation)
    expect(panned[1]).toBeCloseTo(centred[1], 6) // …and a level pan never lifts it
  })

  it('a vertical eye rise (climbing, I4YPOS) drops a fixed ground point WITHOUT changing its depth', () => {
    const ground: Vec3 = [0, -40, -500]
    const low = transform(view(need(cam.LEVEL, 'LEVEL'), [0, 0, 0]), ground)
    const high = transform(view(need(cam.LEVEL, 'LEVEL'), [0, 80, 0]), ground)
    expect(high[1]).toBeLessThan(low[1]) // higher eye ⇒ ground sits further below…
    expect(high[2]).toBeCloseTo(low[2], 6) // …with its depth unchanged (an eye translation, not a pitch)
  })
})

describe('camera — purity & Math Box compatibility', () => {
  it('is pure — identical (attitude, eye) give a bit-identical matrix (determinism)', () => {
    const a = view(bank(0.12), [7, 8, 9])
    const b = view(bank(0.12), [7, 8, 9])
    expect(a.length).toBe(16)
    for (let i = 0; i < 16; i++) expect(a[i]).toBe(b[i])
  })

  it('returns a valid length-16, all-finite Mat4 that composes with multiply()', () => {
    const v = view(bank(0.4), [1, 2, 3])
    expect(v.length).toBe(16)
    const composed = multiply(v, v)
    expect(composed.length).toBe(16)
    for (const x of composed) expect(Number.isFinite(x)).toBe(true)
  })
})

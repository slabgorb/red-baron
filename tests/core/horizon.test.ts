// tests/core/horizon.test.ts
//
// Story rb1-3 — RED phase (Furiosa / TEA). THE tilting horizon — the signature
// piece. Battlezone (Red Baron's Math Box/AVG hardware twin) had only yaw, so
// its horizon never banked; Red Baron's does. "The horizon tilt falls out of
// rotationZ in the view matrix" (design brief §3); "banking tilts the entire
// horizon/scene" (findings §2, PFROTN roll).
//
// CONTRACT for GREEN (DEV): create `src/core/horizon.ts` exporting:
//
//   export function horizonSegments(
//     attitude: Attitude,       // from ./camera — { roll, pitch, yaw } radians
//     aspect: number,
//   ): readonly SceneSegment[]  // NDC segments (./scene), stroked by the shell
//
// The horizon sits at infinity, so it depends ONLY on ATTITUDE (not eye
// position/altitude — altitude moves terrain, never the horizon-at-infinity).
// It runs across the full view width. Behaviourally:
//   * LEVEL          → a flat line at the vertical centre (tilt ≈ 0, midY ≈ 0)
//   * ROLL θ (bank)  → tilts by the bank angle |θ|; +θ and −θ tilt oppositely
//   * PITCH φ        → slides vertically (climb vs dive move it opposite ways)
//   * YAW ψ (turn)   → INVARIANT (a level turn never lifts/drops/tilts the line)
//
// These pin the four observable degrees of freedom BEHAVIOURALLY. The ABSOLUTE
// bank DIRECTION (does banking right drop the right wing or the left?) is left to
// visual/live-playtest calibration — the epic closes on a playtest gate — so this
// suite asserts tilt MAGNITUDE + sign anti-symmetry, not a hard-coded direction.
//
// SCOPE: the horizon LINE (+ later mountains) — foundation. The HORIZN=$40 screen
// offset and authentic SCAPE mountain silhouettes (findings §4/§7) are rb2 ground
// wave; not pinned here.

import { describe, it, expect, beforeAll } from 'vitest'

interface Attitude {
  readonly roll: number
  readonly pitch: number
  readonly yaw: number
}

interface SceneSegment {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

interface HorizonModule {
  horizonSegments?: (attitude: Attitude, aspect: number) => readonly SceneSegment[]
}

let horizon: HorizonModule = {}

beforeAll(async () => {
  try {
    horizon = (await import('../../src/core/horizon')) as HorizonModule
  } catch {
    horizon = {}
  }
})

function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`src/core/horizon.ts must export ${name} (rb1-3 RED contract)`)
  }
  return value
}

const ASPECT = 16 / 9
const LEVEL: Attitude = { roll: 0, pitch: 0, yaw: 0 }

/** Reduce the horizon's NDC segments to a single line: its ON-SCREEN tilt +
 *  centre height, taken between the left-most and right-most endpoints.
 *
 *  NDC is ANISOTROPIC — x ∈ [-1,1] maps to the full pixel WIDTH, y ∈ [-1,1] to the
 *  full HEIGHT — so a horizon rolled by θ (which tilts by exactly θ on the square-
 *  pixel screen) reads as atan(aspect·tanθ) in raw NDC. To recover the physical
 *  on-screen tilt we scale the x-delta by aspect (dev correction — see the Dev
 *  design-deviation note in the session file). */
function line(
  segs: readonly SceneSegment[],
  aspect: number,
): { tilt: number; midY: number; leftX: number; rightX: number } {
  expect(segs.length).toBeGreaterThan(0)
  const pts = segs.flatMap((s) => [
    { x: s.x1, y: s.y1 },
    { x: s.x2, y: s.y2 },
  ])
  let left = pts[0]
  let right = pts[0]
  for (const p of pts) {
    if (p.x < left.x) left = p
    if (p.x > right.x) right = p
  }
  return {
    tilt: Math.atan2(right.y - left.y, (right.x - left.x) * aspect),
    midY: (left.y + right.y) / 2,
    leftX: left.x,
    rightX: right.x,
  }
}

describe('horizon — level flight', () => {
  it('draws at least one NDC segment', () => {
    const segs = need(horizon.horizonSegments, 'horizonSegments')(LEVEL, ASPECT)
    expect(segs.length).toBeGreaterThan(0)
  })

  it('is a FLAT line across the full view width, at the vertical centre', () => {
    const l = line(need(horizon.horizonSegments, 'horizonSegments')(LEVEL, ASPECT), ASPECT)
    expect(l.tilt).toBeCloseTo(0, 2) // horizontal
    expect(l.midY).toBeCloseTo(0, 2) // vertical centre
    expect(l.leftX).toBeLessThan(-0.5) // spans left…
    expect(l.rightX).toBeGreaterThan(0.5) // …to right — a real horizon, not a stub
  })
})

describe('horizon — roll banks the line (the tilting horizon)', () => {
  it('rolling tilts the horizon by the bank angle (|tilt| ≈ |roll|)', () => {
    const horizonSegments = need(horizon.horizonSegments, 'horizonSegments')
    for (const roll of [0.2, 0.4]) {
      const l = line(horizonSegments({ roll, pitch: 0, yaw: 0 }, ASPECT), ASPECT)
      expect(Math.abs(l.tilt)).toBeCloseTo(roll, 1) // within ~0.05 rad
    }
  })

  it('opposite banks tilt the horizon opposite ways (sign anti-symmetry)', () => {
    const horizonSegments = need(horizon.horizonSegments, 'horizonSegments')
    const rightBank = line(horizonSegments({ roll: 0.3, pitch: 0, yaw: 0 }, ASPECT), ASPECT).tilt
    const leftBank = line(horizonSegments({ roll: -0.3, pitch: 0, yaw: 0 }, ASPECT), ASPECT).tilt
    expect(Math.sign(rightBank)).toBe(-Math.sign(leftBank))
    expect(Math.abs(rightBank)).toBeGreaterThan(0.1) // a real tilt, not noise
  })
})

describe('horizon — pitch slides it vertically, yaw leaves it alone', () => {
  it('climb and dive move the horizon in opposite vertical directions, level between', () => {
    const horizonSegments = need(horizon.horizonSegments, 'horizonSegments')
    const up = line(horizonSegments({ roll: 0, pitch: 0.3, yaw: 0 }, ASPECT), ASPECT).midY
    const down = line(horizonSegments({ roll: 0, pitch: -0.3, yaw: 0 }, ASPECT), ASPECT).midY
    const level = line(horizonSegments(LEVEL, ASPECT), ASPECT).midY
    expect(Math.sign(up - level)).toBe(-Math.sign(down - level)) // opposite sides of level
    expect(Math.abs(up - down)).toBeGreaterThan(0.05) // pitch actually moves it
  })

  it('a level TURN (yaw only) does NOT lift, drop, or tilt the horizon (yaw-invariant)', () => {
    const horizonSegments = need(horizon.horizonSegments, 'horizonSegments')
    const turned = line(horizonSegments({ roll: 0, pitch: 0, yaw: 0.6 }, ASPECT), ASPECT)
    expect(turned.tilt).toBeCloseTo(0, 2)
    expect(turned.midY).toBeCloseTo(0, 2)
  })
})

describe('horizon — purity', () => {
  it('is deterministic — the same attitude yields a bit-identical segment list', () => {
    const horizonSegments = need(horizon.horizonSegments, 'horizonSegments')
    const att: Attitude = { roll: 0.15, pitch: -0.1, yaw: 0.25 }
    const a = horizonSegments(att, ASPECT)
    const b = horizonSegments(att, ASPECT)
    expect(a.length).toBe(b.length)
    for (let i = 0; i < a.length; i++) {
      expect(a[i].x1).toBe(b[i].x1)
      expect(a[i].y1).toBe(b[i].y1)
      expect(a[i].x2).toBe(b[i].x2)
      expect(a[i].y2).toBe(b[i].y2)
    }
  })
})

// tests/core/horizon.test.ts
//
// Story rb1-3, REWRITTEN for rb4-5 — the horizon was the WRONG SHAPE too.
//
// rb1-3 seated the horizon "at infinity" (HORIZON_DISTANCE=10000, EYE_AT_ORIGIN) so it
// depended ONLY on attitude and NEVER on altitude, and it slid vertically via a
// rotationX(pitch). Red Baron's ROM horizon is NOT at infinity: it sits at the FINITE
// depth HORZ=$1000=4096 (RBARON.MAC:451) and MOVES WITH ALTITUDE — climbing (raising
// I4YPOS) drops it, diving raises it. The only ROTATION is the bank (PFROTN, rotationZ).
// There is no pitch rotation; the vertical slide falls out of the eye-height translation.
//
// CONTRACT for GREEN (Yoda / DEV): `src/core/horizon.ts` exports
//
//   export function horizonSegments(
//     view: { readonly roll: number; readonly altitude: number },  // bank + I4YPOS eye height
//     aspect: number,
//   ): readonly SceneSegment[]                                      // NDC segments (./scene)
//
// Behaviourally:
//   * a FLAT line across the full view width (level ⇒ tilt ≈ 0)
//   * ROLL θ (bank)   → tilts by |θ|; +θ and −θ tilt oppositely
//   * ALTITUDE (climb)→ slides the line vertically; climb vs dive move it opposite ways
//     (it is NOT altitude-invariant — that is the rb4-5 fix)
//
// The horizon is pinned BEHAVIOURALLY. The absolute bank DIRECTION and the exact
// altitude→screen scale are Dev's (a playtest gate closes the epic) — so this suite
// asserts tilt sign anti-symmetry and altitude-dependence, not hard-coded pixels.
//
// Loaded defensively (await import) so the RED failures are per-assertion.

import { describe, it, expect, beforeAll } from 'vitest'

interface SceneSegment {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

/** The rb4-5 horizon view: the bank (roll) and the eye height (altitude / I4YPOS).
 *  pitch/yaw are carried as 0 only so the CURRENT (pre-rewrite) horizon — which still
 *  reads roll/pitch/yaw — yields a finite horizon during RED; the rewrite reads
 *  roll + altitude. */
interface HorizonView {
  readonly roll: number
  readonly altitude: number
  readonly pitch?: number
  readonly yaw?: number
}

interface HorizonModule {
  horizonSegments?: (view: HorizonView, aspect: number) => readonly SceneSegment[]
}

let horizon: HorizonModule = {}

beforeAll(async () => {
  try {
    horizon = (await import('../../src/core/horizon')) as unknown as HorizonModule
  } catch {
    horizon = {}
  }
})

function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`src/core/horizon.ts must export ${name} (rb4-5 RED contract)`)
  return value
}

const ASPECT = 16 / 9
const LEVEL_ALT = 528 // I4YPOS spawn altitude (findings §5)
const view = (roll: number, altitude: number): HorizonView => ({ roll, altitude, pitch: 0, yaw: 0 })

/** Reduce the horizon's NDC segments to a single line: its ON-SCREEN tilt + centre
 *  height, taken between the left-most and right-most endpoints. NDC x is aspect-
 *  scaled to recover the physical on-screen tilt. */
function line(segs: readonly SceneSegment[], aspect: number): { tilt: number; midY: number; leftX: number; rightX: number } {
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

const segsAt = (roll: number, altitude: number): readonly SceneSegment[] =>
  need(horizon.horizonSegments, 'horizonSegments')(view(roll, altitude), ASPECT)

describe('horizon — level flight draws a flat line across the view', () => {
  it('draws at least one NDC segment', () => {
    expect(segsAt(0, LEVEL_ALT).length).toBeGreaterThan(0)
  })

  it('is a FLAT line across the full view width (level ⇒ no tilt)', () => {
    const l = line(segsAt(0, LEVEL_ALT), ASPECT)
    expect(l.tilt).toBeCloseTo(0, 2) // horizontal
    expect(l.leftX).toBeLessThan(-0.5) // spans left…
    expect(l.rightX).toBeGreaterThan(0.5) // …to right — a real horizon, not a stub
  })
})

describe('horizon — roll banks the line (the tilting horizon, the ONE rotation)', () => {
  it('rolling tilts the horizon, more roll ⇒ more tilt', () => {
    const small = Math.abs(line(segsAt(0.2, LEVEL_ALT), ASPECT).tilt)
    const large = Math.abs(line(segsAt(0.4, LEVEL_ALT), ASPECT).tilt)
    expect(small).toBeGreaterThan(0.05) // a real tilt…
    expect(large).toBeGreaterThan(small) // …that grows with the bank
  })

  it('opposite banks tilt the horizon opposite ways (sign anti-symmetry)', () => {
    const rightBank = line(segsAt(0.3, LEVEL_ALT), ASPECT).tilt
    const leftBank = line(segsAt(-0.3, LEVEL_ALT), ASPECT).tilt
    expect(Math.sign(rightBank)).toBe(-Math.sign(leftBank))
    expect(Math.abs(rightBank)).toBeGreaterThan(0.1) // a real tilt, not noise
  })
})

describe('horizon — MOVES WITH ALTITUDE (finite HORZ, not at infinity) — the rb4-5 fix', () => {
  it('climbing and diving move the horizon vertically (it is NOT altitude-invariant)', () => {
    const low = line(segsAt(0, 100), ASPECT).midY
    const high = line(segsAt(0, 1400), ASPECT).midY
    // The rb1 horizon-at-infinity left this dead still; a finite-HORZ horizon slides.
    expect(Math.abs(high - low)).toBeGreaterThan(1e-3)
  })

  it('climb and dive move the horizon OPPOSITE ways from level', () => {
    const level = line(segsAt(0, LEVEL_ALT), ASPECT).midY
    const climb = line(segsAt(0, 1400), ASPECT).midY
    const dive = line(segsAt(0, 100), ASPECT).midY
    expect(Math.sign(climb - level)).toBe(-Math.sign(dive - level))
  })
})

describe('horizon — purity', () => {
  it('is deterministic — the same (roll, altitude) yields a bit-identical segment list', () => {
    const a = segsAt(0.15, 400)
    const b = segsAt(0.15, 400)
    expect(a.length).toBe(b.length)
    for (let i = 0; i < a.length; i++) {
      expect(a[i].x1).toBe(b[i].x1)
      expect(a[i].y1).toBe(b[i].y1)
      expect(a[i].x2).toBe(b[i].x2)
      expect(a[i].y2).toBe(b[i].y2)
    }
  })
})

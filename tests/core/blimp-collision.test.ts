// tests/core/blimp-collision.test.ts
//
// Story rb4-11 — RED phase (Imperator Furiosa / TEA). AC-4: BLCOLL is transcribed and
// USED for the blimp hit test.
//
// TODAY the airship rides the shared kill pipeline (rb2-13 AC-7) as a plain Enemy, so
// `collides` judges it with the PLANE's COLLD picture-plate window — ±48 in x,
// −64..+80 in y (guns.ts, rb4-17). The ROM gives the blimp its OWN collision body:
// BLCOLL (RBARON.MAC:6270-6277), an 8-corner box ±16 × ±16 × ±40 — the last PLNDB
// master-table member (:6285-6287) missing from topology.ts. The box is exactly the
// envelope's model extents, and blimpSegments poses that model BROADSIDE (BLIMP_YAW
// quarter-turn), so ON SCREEN the airship spans ±40 wide (model z) and ±16 tall
// (model y). WYSIWYG: the hit test must match what is drawn —
//
//     plane window (today)          BLCOLL broadside (required)
//     x: |dx| <= 48                 x: |dx| <= 40
//     y: -64 <= dy <= +80           y: |dy| <= 16   (SYMMETRIC — no plane belly/top bias)
//
// The seam STAYS the shared `collides` (rb2-13's "not a bespoke blimp collision" pin,
// tests/blimp-wiring.test.ts): the TARGET carries its window. Contract for Dev:
//
//   • Enemy gains an optional collision window `window?: { x: number; yMin: number; yMax: number }`
//     (absent -> the plane COLLD window, exactly as today — no plane behaviour changes);
//   • blimpTarget() carries a window DERIVED from BLCOLL_POINTS (topology.ts) + the
//     broadside pose — never re-typed literals;
//   • the DEPTH extent of the box (model x ±16 through the depth→shell-z projection) is
//     NOT pinned here — routed as a Delivery Finding (the projection seam owns it).

import { describe, it, expect, beforeAll } from 'vitest'
import { collides, S_MAXZ, type Shell } from '../../src/core/guns'
import { blimpTarget, type Blimp } from '../../src/core/blimp'
import { spawn, type Enemy } from '../../src/core/enemy'
import { createRng } from '@arcade/shared/rng'
import type { Point3 } from '../../src/core/topology'

interface CollisionWindow {
  readonly x?: number
  readonly yMin?: number
  readonly yMax?: number
}

interface GroundTargetTopology {
  BLCOLL_POINTS?: readonly Point3[]
}

let topo: GroundTargetTopology = {}
beforeAll(async () => {
  // `as unknown as`: RED mid-migration mirror — topology.ts does not export BLCOLL_POINTS
  // until this story's transcription lands (house pattern, mission-clock.test.ts).
  topo = (await import('../../src/core/topology')) as unknown as GroundTargetTopology
})

function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} is not provided yet (rb4-11 RED)`)
  return value
}

/** A level airship dead ahead at a comfortable range. */
const cruiser = (): Blimp => ({
  x: 0,
  y: 0,
  depth: 2000,
  deltaX: 6,
  bank: 0,
  side: -1,
  active: true,
})

/** A plane at the same pose (real spawn geometry, fixed position) — the control target. */
const planeAt = (x: number, y: number, depth: number): Enemy => ({
  ...spawn(createRng(1), 0),
  x,
  y,
  depth,
  bank: 0,
})

/**
 * Does ANY shell range connect at screen offset (dx, dy) from the target? Sweeping the
 * shell z avoids depending on the private depth→z projection (the blimp.test.ts idiom)
 * while still driving the REAL collides.
 */
function hitsAt(target: Enemy, dx: number, dy: number): boolean {
  for (let z = 0; z <= S_MAXZ; z += 0.25) {
    const shell: Shell = { x: target.x + dx, y: target.y + dy, z, gun: 'left', active: true }
    if (collides(shell, target)) return true
  }
  return false
}

// ─── the box replaces the plane window on the AIRSHIP ─────────────────────────────────

describe('rb4-11 AC-4 — the blimp is hit through BLCOLL, not the plane COLLD window', () => {
  it('a shell 40 above the envelope centre MISSES — the box top is +16, not the plane’s +80', () => {
    // RED today: dy=40 sits inside the plane window (-64..+80) and kills the airship from
    // empty sky well clear of the drawn hull (the envelope tops out at +16 on screen).
    expect(hitsAt(blimpTarget(cruiser()), 0, 40)).toBe(false)
  })

  it('a shell 40 below MISSES too — BLCOLL is SYMMETRIC, no −64 belly band', () => {
    expect(hitsAt(blimpTarget(cruiser()), 0, -40)).toBe(false)
  })

  it('a shell 44 to the side MISSES — the broadside envelope ends at ±40, not the plane’s ±48', () => {
    expect(hitsAt(blimpTarget(cruiser()), 44, 0)).toBe(false)
  })

  it('KEEP: dead-centre still kills', () => {
    expect(hitsAt(blimpTarget(cruiser()), 0, 0)).toBe(true)
  })

  it('KEEP: 36 to the side still kills — the box is the BROADSIDE pose (model z spans screen x)', () => {
    // 36 is outside the RAW ±16 model-x column but inside the drawn ±40 broadside span.
    // This is the orientation guard: an un-yawed box (±16 wide) would wrongly miss here.
    expect(hitsAt(blimpTarget(cruiser()), 36, 0)).toBe(true)
  })

  it('KEEP: 12 above still kills — inside the ±16 envelope', () => {
    expect(hitsAt(blimpTarget(cruiser()), 0, 12)).toBe(true)
  })

  it('KEEP: far off to the side never hits (the rb2-13 aim guard, restated)', () => {
    expect(hitsAt(blimpTarget(cruiser()), 400, 0)).toBe(false)
  })
})

// ─── the window rides the target and derives from the transcription ───────────────────

describe('rb4-11 AC-4 — blimpTarget carries a BLCOLL-derived window', () => {
  it('the adapted target exposes a collision window', () => {
    // `as unknown as`: Enemy does not declare `window` until Dev lands the seam — the
    // mirror is the target contract, verified at runtime (RED: undefined).
    const target = blimpTarget(cruiser()) as unknown as { window?: CollisionWindow }
    expect(target.window, 'blimpTarget().window (rb4-11 AC-4 seam)').toBeDefined()
  })

  it('the window IS the box, posed broadside: x = max|z| = 40, y = ±16 — derived from BLCOLL_POINTS', () => {
    const target = blimpTarget(cruiser()) as unknown as { window?: CollisionWindow }
    const w = need(target.window, 'blimpTarget().window')
    const box = need(topo.BLCOLL_POINTS, 'topology.BLCOLL_POINTS')
    // Recomputed from the transcription, so the window can never drift from the box.
    // (That the source DERIVES rather than re-types the values is the Reviewer's diff trace.)
    expect(w.x).toBe(Math.max(...box.map((p) => Math.abs(p[2])))) // 40 — broadside width
    expect(w.yMax).toBe(Math.max(...box.map((p) => p[1]))) //         16
    expect(w.yMin).toBe(Math.min(...box.map((p) => p[1]))) //        -16
    expect(w.yMin).toBe(-(w.yMax as number)) // symmetric — unlike the plane's belly/top band
  })
})

// ─── the PLANE keeps its COLLD window — no regression through the shared seam ─────────

describe('rb4-11 AC-4 — planes still collide through the COLLD plate (rb4-17 window intact)', () => {
  it('a plane target still takes the wide plate: 44 to the side hits (±48), 70 above hits (+80)', () => {
    expect(hitsAt(planeAt(0, 0, 2000), 44, 0)).toBe(true)
    expect(hitsAt(planeAt(0, 0, 2000), 0, 70)).toBe(true)
  })

  it('and the plate still ENDS where rb4-17 pinned it: 90 above misses', () => {
    expect(hitsAt(planeAt(0, 0, 2000), 0, 90)).toBe(false)
  })
})

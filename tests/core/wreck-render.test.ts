// tests/core/wreck-render.test.ts
//
// rb4-13 REWORK (review finding, MEDIUM): `wreckSegments` claimed "the falling wreck
// keeps drawing the model the plane died wearing" and NOTHING tested it — hardcoding
// `biplaneLOD(true)` in the falling branch survived all 1023 tests (mutation-proven
// by the review). This suite pins the claim the same way biplane.test.ts pins the
// live plane: same pose, two bits, two models — at depths spanning the whole flight
// band, so no depth rule can impersonate the bit here either.
//
// (The wreck's kinematics — fall, spin, phase timers — are explosion.test.ts's;
// the debris burst's screen size is screen-scale.test.ts's. This file owns only
// the orientation → picture seam.)

import { describe, it, expect } from 'vitest'
import { wreckSegments } from '../../src/core/wreck-render'
import { EXPL1_FRAMES, EXPL2_FRAMES, type Wreck } from '../../src/core/explosion'
import { sceneProjection } from '../../src/core/scene'

const PROJ = sceneProjection(1)

/** A freshly-fallen wreck at a chosen depth, carrying a chosen D4 bit. */
const wreckAt = (depth: number, facingAway: boolean, phase: Wreck['phase'] = 'falling'): Wreck => ({
  x: 0,
  y: 0,
  depth,
  vy: 0,
  spin: 0,
  phase,
  timer: phase === 'falling' ? EXPL1_FRAMES : EXPL2_FRAMES,
  facingAway,
})

describe('wreck-render — the falling wreck draws the model it died wearing (rb4-13)', () => {
  it('same pose, two bits, two models: 30 drone segments facing away, 54 full toward', () => {
    // P.MNDP floor (0x140 = 320), the retired invented threshold (≈1732), P.INDP spawn
    // (0x1080 = 4224): the drawn model must follow the BIT at every one of them. A
    // wreckSegments that ignores wreck.facingAway — or re-derives it from wreck.depth —
    // fails at least one row of this table.
    for (const depth of [320, 1732, 4224]) {
      expect(
        wreckSegments(wreckAt(depth, true), PROJ),
        `facing away at depth ${depth} → the 30-segment drone wreck`,
      ).toHaveLength(30)
      expect(
        wreckSegments(wreckAt(depth, false), PROJ),
        `rotated toward at depth ${depth} → the 54-segment full wreck`,
      ).toHaveLength(54)
    }
  })

  it('the bit only picks the FALLING picture — the debris burst is bit-blind', () => {
    // Exploding wrecks draw the four PIECE0-3 debris models regardless of orientation;
    // the D4 bit must not leak into the burst. Segment counts match across bits.
    const away = wreckSegments(wreckAt(1000, true, 'exploding'), PROJ)
    const toward = wreckSegments(wreckAt(1000, false, 'exploding'), PROJ)
    expect(away.length).toBeGreaterThan(0)
    expect(away.length).toBe(toward.length)
  })
})

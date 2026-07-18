// tests/core/shell-dot.test.ts
//
// Story rb4-9 — RED phase (Furiosa / TEA). AC-5 (the shell half).
//
// THE ROM DRAWS SHELLS AS DOTS. `JSR VGDOT ;DISPLAY DOT (Z REG)` (RBARON.MAC:5258,
// VGUT.MAC:305 "VGDOT - DRAW A DOT AT THE CURRENT POSITION"). The clone draws a
// line STREAK — a deliberate readability choice (guns.ts:312, "reads as motion and
// not as a dot") that this ROM-fidelity story overturns. `shellSegments` must
// project the shell to a single POINT at the depth it kills at, not a trailing streak.
//
// ⚠ CROSS-IMPACT for DEV (flagged as a Delivery Finding): the OLD streak is asserted
// by tests/core/tracer-seam.test.ts (":266 …it is a streak, not a dot", the
// ONE_Z_COUNT trail checks) and by tests/shell/cockpit-draw-path.test.ts INVARIANT 1
// (the "trails by exactly one Z count" checks). Converting to a dot REQUIRES updating
// those to expect a dot — while KEEPING their depth-truth (the dot must still sit at
// shellDepth(z), the whole point of rb4-1). Preserve the depth pin; drop only the trail.

import { describe, it, expect } from 'vitest'
import { sceneProjection, projectSegment, type SceneSegment } from '../../src/core/scene'
import { shellSegments, shellDepth, type Shell } from '../../src/core/guns'
import { multiply, translation, type Mat4, type Vec3 } from '@arcade/shared/math3d'

const PROJ = sceneProjection(1)
/** A view that keeps a shell fired near the boresight in front of the eye. */
const mvp: Mat4 = multiply(PROJ, translation(0, 0, 0))
/** Only x/y/z are read by shellSegments; gun/active are supplied to build a full Shell literal
 * (the convention in tracer-seam.test.ts), so no `as unknown as` bypass is needed. */
const shellAt = (x: number, y: number, z: number): Shell => ({ x, y, z, gun: 'left', active: true } as Shell)

describe('rb4-9 AC-5 — a shell is a DOT (VGDOT), not a streak', () => {
  it('projects to exactly one segment', () => {
    const segs = shellSegments(shellAt(20, 10, 5), mvp)
    expect(segs).toHaveLength(1)
  })

  it('that segment is a POINT — both endpoints coincide (zero-length)', () => {
    const [seg] = shellSegments(shellAt(20, 10, 5), mvp)
    expect(seg.x1, 'a dot has no trail: x1 must equal x2').toBe(seg.x2)
    expect(seg.y1, 'a dot has no trail: y1 must equal y2').toBe(seg.y2)
  })

  it('the dot sits at shellDepth(z) — the depth the bullet KILLS at (rb4-1 preserved)', () => {
    // The whole hard-won lesson of rb4-1 is that the light must be where the kill is. A dot does
    // NOT relax that — it just removes the trail. The point must project the shell at shellDepth(z).
    const shell = shellAt(20, 10, 5)
    const [seg] = shellSegments(shell, mvp)
    const atKill: SceneSegment | null = projectSegment(
      [shell.x, shell.y, -shellDepth(shell.z)] as Vec3,
      [shell.x, shell.y, -shellDepth(shell.z)] as Vec3,
      mvp,
    )
    expect(atKill).not.toBeNull()
    expect(seg.x1).toBeCloseTo(atKill!.x1, 9)
    expect(seg.y1).toBeCloseTo(atKill!.y1, 9)
  })

  it('is culled behind the eye — no perspective-mirrored ghost dot', () => {
    // z small enough that shellDepth(z) puts the dot behind a pushed-back eye.
    const behind: Mat4 = multiply(PROJ, translation(0, 0, +4096))
    expect(shellSegments(shellAt(20, 10, 5), behind)).toHaveLength(0)
  })
})

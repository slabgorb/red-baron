// src/core/scene.ts
//
// The pure world → NDC vector render substrate. Projection stays in CORE; the
// shell only maps NDC → pixels and strokes glowing vectors (epic ruling, mirrored
// from battlezone/src/core/scene.ts). The horizon (horizon.ts) and, later, terrain
// and enemies are all carried to the screen through this.
//
// NDC CONVENTION (math3d header): the visible square is [-1, 1]; +x is
// screen-right, +y is screen-up, the camera looks down −Z.
//
// BEHIND-EYE CULL (findings §8 divide-by-depth): a perspective divide mirrors a
// point behind the camera back INTO view with a flipped sign. A faithful
// projector drops a segment whose endpoints are both behind the eye (clip w ≤ 0)
// rather than stroking a ghost.
//
// PURE and deterministic. No DOM, no time, no randomness.

import { perspective, type Mat4, type Vec3 } from '@arcade/shared/math3d'

/** One projected edge in NDC space ([-1, 1] is the visible square). */
export interface SceneSegment {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

/** Vertical field of view of the cockpit — a 60° window over the vector world. */
const VERTICAL_FOV = Math.PI / 3
/** Near clip: just in front of the eye. */
const NEAR = 1
/** Far clip: past the horizon distance (findings §7 HORZ = 1000, with headroom). */
const FAR = 20000

/** The one perspective matrix of the game, for a given viewport aspect ratio. */
export function sceneProjection(aspect: number): Mat4 {
  return perspective(VERTICAL_FOV, aspect, NEAR, FAR)
}

/** Homogeneous clip coordinates of a world point under an MVP (no divide yet). */
function toClip(mvp: Mat4, v: Vec3): { x: number; y: number; w: number } {
  const [x, y, z] = v
  return {
    x: mvp[0] * x + mvp[1] * y + mvp[2] * z + mvp[3],
    y: mvp[4] * x + mvp[5] * y + mvp[6] * z + mvp[7],
    w: mvp[12] * x + mvp[13] * y + mvp[14] * z + mvp[15],
  }
}

/**
 * Project a world-space segment through an MVP into an NDC `SceneSegment`.
 * Returns null when both endpoints are behind the eye (clip w ≤ 0) — the
 * substrate never strokes a perspective-mirrored ghost.
 */
export function projectSegment(a: Vec3, b: Vec3, mvp: Mat4): SceneSegment | null {
  const ca = toClip(mvp, a)
  const cb = toClip(mvp, b)
  if (ca.w <= 0 && cb.w <= 0) return null
  return { x1: ca.x / ca.w, y1: ca.y / ca.w, x2: cb.x / cb.w, y2: cb.y / cb.w }
}

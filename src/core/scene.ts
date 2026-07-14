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
import { HORIZN } from './topology'

/** One projected edge in NDC space ([-1, 1] is the visible square). */
export interface SceneSegment {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

/**
 * ROM screen half-height, in the VG screen units HORIZN is expressed in. The ROM adds
 * HORIZN = $40 = 64 to the divided screen-Y of EVERY object (POSITH, RBGRND.MAC:303);
 * our screen is NDC [-1, 1], so the offset is HORIZN / ROM_SCREEN_HALF. The exact
 * ROM-unit → NDC scale is not byte-pinned (rb4-5 Dev seam) — 512 keeps the horizon a
 * short lift above centre, matching the ROM's low-altitude look.
 */
const ROM_SCREEN_HALF = 512
/** HORIZN as an NDC screen-Y offset added to every projected point (rb4-5 AC5). */
const HORIZN_NDC = HORIZN / ROM_SCREEN_HALF

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
 * Project a world-space segment through an MVP into an NDC `SceneSegment`. After the
 * perspective divide the constant HORIZN screen offset is added to Y — the ROM's
 * `ADC I,HORIZN` in POSITH (RBGRND.MAC:303), a depth-independent lift applied to every
 * object. Returns null when both endpoints are behind the eye (clip w ≤ 0) — the
 * substrate never strokes a perspective-mirrored ghost.
 */
export function projectSegment(a: Vec3, b: Vec3, mvp: Mat4): SceneSegment | null {
  const ca = toClip(mvp, a)
  const cb = toClip(mvp, b)
  if (ca.w <= 0 && cb.w <= 0) return null
  return {
    x1: ca.x / ca.w,
    y1: ca.y / ca.w + HORIZN_NDC,
    x2: cb.x / cb.w,
    y2: cb.y / cb.w + HORIZN_NDC,
  }
}

// src/core/horizon.ts
//
// THE tilting horizon — Red Baron's signature over its Battlezone hardware twin.
// rb4-5 REWRITE: the ROM horizon is NOT "at infinity". It sits at the FINITE depth
// HORZ = $1000 = 4096 (RBARON.MAC:451, "HORIZON DEPTH") on the ground plane, and it
// MOVES WITH ALTITUDE — climbing (raising the I4YPOS eye height) drops it, diving
// raises it. The only ROTATION is the bank (PFROTN, rotationZ). There is no pitch
// rotation; the vertical slide falls out of the eye-height translation.
//
// It is drawn as a horizontal line on the ground plane (world Y = 0) at depth HORZ,
// spanning far enough in world-X to cross the whole view, then carried through the
// shared camera + scene substrate (which applies the perspective divide and the
// HORIZN screen offset). level → flat, roll → tilts by the bank, altitude → slides.
//
// PURE and deterministic. No DOM, no time, no randomness.

import { multiply, type Vec3 } from '@arcade/shared/math3d'
import { flightView } from './camera'
import { projectSegment, sceneProjection, type SceneSegment } from './scene'
import { HORZ } from './topology'
import { ALT_TO_Y } from './flight'

/** Half the horizontal extent of the drawn horizon line, in world-X at depth HORZ —
 *  wide enough that both endpoints project well past the screen edges at any aspect. */
const HORIZON_HALF_WIDTH = HORZ * 2

/** The rb4-5 horizon view: the bank (roll) and the eye height (altitude / I4YPOS). */
export interface HorizonView {
  readonly roll: number
  readonly altitude: number
}

/** The tilting horizon as NDC segments for the shell to stroke. */
export function horizonSegments(view: HorizonView, aspect: number): readonly SceneSegment[] {
  // the eye rises with altitude (I4YPOS); the horizon lies on the ground plane (Y=0)
  // at the finite depth HORZ, so a higher eye sees it lower on screen.
  const eye: Vec3 = [0, view.altitude * ALT_TO_Y, 0]
  const mvp = multiply(sceneProjection(aspect), flightView({ roll: view.roll }, eye))
  const left: Vec3 = [-HORIZON_HALF_WIDTH, 0, -HORZ]
  const right: Vec3 = [HORIZON_HALF_WIDTH, 0, -HORZ]
  const seg = projectSegment(left, right, mvp)
  return seg ? [seg] : []
}

// src/core/horizon.ts
//
// THE tilting horizon — Red Baron's signature over its Battlezone hardware twin
// (Battlezone had only yaw, so its horizon never banked). "Banking tilts the
// entire horizon/scene" (findings §2, PFROTN roll); "the horizon tilt falls out
// of rotationZ in the view matrix" (design brief §3).
//
// The horizon sits at infinity, so it depends only on ATTITUDE (never on eye
// position/altitude — altitude moves terrain, not the horizon). It is built as a
// pair of points on the horizon circle at screen-azimuths ±HALF_SPAN, centred on
// the current heading so the line spans the view at any yaw, then projected
// through the shared camera + scene substrate. Under perspective the image of a
// plane-at-infinity is a straight line, so two endpoints define it exactly:
// level → flat & centred, roll → tilts by the bank angle, pitch → slides
// vertically, yaw → pans but stays level.
//
// SCOPE: the horizon LINE — foundation. The HORIZN=$40 screen offset and the
// SCAPE mountain silhouettes (findings §4/§7) are rb2's ground wave.
//
// PURE and deterministic. No DOM, no time, no randomness.

import { multiply, type Vec3 } from '@arcade/shared/math3d'
import { flightView, type Attitude } from './camera'
import { projectSegment, sceneProjection, type SceneSegment } from './scene'

/** How far out the horizon points sit — effectively "at infinity" for projection. */
const HORIZON_DISTANCE = 10000
/** Azimuth half-width of the drawn horizon, centred on the heading (±40°). */
const HORIZON_HALF_SPAN = (40 * Math.PI) / 180

const EYE_AT_ORIGIN: Vec3 = [0, 0, 0]

/** The tilting horizon as NDC segments for the shell to stroke. */
export function horizonSegments(attitude: Attitude, aspect: number): readonly SceneSegment[] {
  const mvp = multiply(sceneProjection(aspect), flightView(attitude, EYE_AT_ORIGIN))
  // A horizon point at a given SCREEN azimuth: subtract the heading so the drawn
  // span stays centred on where the pilot is looking, whatever the yaw.
  const point = (screenAz: number): Vec3 => {
    const a = screenAz - attitude.yaw
    return [Math.sin(a) * HORIZON_DISTANCE, 0, -Math.cos(a) * HORIZON_DISTANCE]
  }
  const seg = projectSegment(point(-HORIZON_HALF_SPAN), point(HORIZON_HALF_SPAN), mvp)
  return seg ? [seg] : []
}

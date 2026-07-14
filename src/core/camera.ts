// src/core/camera.ts
//
// The flight camera — "the cockpit IS the camera" (findings §2). rb4-5 REWRITE:
// the 1980 Red Baron ROM has NO YAW ROTATION and NO PITCH ROTATION. Turning adds
// PLDELX to the linear universe-X UNIV4X and draws objects at (X − UNIV4X);
// climb/dive adds PLDELY to the eye height I4YPOS, subtracted from every object's Y.
// Both are TRANSLATIONS of the world about a fixed eye, not rotations of the camera.
// The ONLY rotation is the bank — PFROTN, a single Z rotation (RBARON.MAC:3196-3262).
//
// So this camera composes ONLY `rotationZ(roll)` and translates by −eye. The pilot's
// turn (UNIV4X) and altitude (I4YPOS) arrive as the EYE position (flight.ts toEye);
// the downstream perspective divide (scene.ts) turns that eye translation into the
// ROM's (X − UNIV4X)/depth pan. No rotationX(pitch), no rotationY(yaw) remain.
//
// Built on the SHARED Math Box (@arcade/shared/math3d): Red Baron does NOT re-port
// math3d (epic ruling). Model space already puts the nose at −Z (findings §8), which
// matches the shared eye space, so no sign bridge is applied.
//
// PURE and deterministic. No DOM, no time, no randomness.

import { rotationZ, viewMatrix, type Mat4, type Vec3 } from '@arcade/shared/math3d'

/** The pilot's flight attitude. The bank (roll) is the ONLY rotation — turning and
 *  climbing are eye translations, not rotations (rb4-5). Radians. */
export interface Attitude {
  /** Bank. Tilts the horizon about the line of flight (rotationZ, PFROTN). */
  readonly roll: number
}

/** Straight, level flight: no bank. */
export const LEVEL: Attitude = { roll: 0 }

/**
 * The camera view matrix for a flight attitude at an eye position, on the shared
 * Math Box. Orientation is `rotationZ(roll)` ONLY — the single Z bank; `viewMatrix`
 * inverts the camera's world placement (translate by −eye). LEVEL at the origin
 * yields IDENTITY. Turning and climbing move the `eye`, never the rotation.
 */
export function flightView(attitude: Attitude, eye: Vec3): Mat4 {
  return viewMatrix(eye, rotationZ(attitude.roll))
}

// src/core/camera.ts
//
// The roll/pitch/yaw flight camera — "the cockpit IS the camera" (findings §2).
//
// Built on the SHARED Math Box (@arcade/shared/math3d): Red Baron is the first
// native @arcade/shared consumer and does NOT re-port math3d (epic ruling). The
// camera composes `rotationZ(roll) ∘ rotationX(pitch) ∘ rotationY(yaw)` into the
// shared `viewMatrix` (design brief §3) — "the horizon tilt falls out of
// rotationZ." Unlike Battlezone's `tankView` (whose +Z-into-monitor ROM world
// needed a heading+π bridge), Red Baron's model space already puts the nose at
// −Z (findings §8), which MATCHES the shared Math Box's −Z-forward eye space — so
// no sign bridge is applied: forward = −Z, right = +X, up = +Y.
//
// SCOPE: this is the camera the flight model DRIVES. The authentic dynamics that
// produce the attitude (PLDELX turn-rate inertia, the 11-step PLDELY pitch table,
// PFROTN = PLDELX×8 bank coupling, the I4YPOS altitude clamp — findings §2) are
// rb2's "flight model", not the rb1 foundation.
//
// PURE and deterministic. No DOM, no time, no randomness.

import { multiply, rotationX, rotationY, rotationZ, viewMatrix, type Mat4, type Vec3 } from '@arcade/shared/math3d'

/** The pilot's flight attitude — the three rotation angles of the cockpit. Radians. */
export interface Attitude {
  /** Bank. Tilts the horizon about the line of flight (rotationZ). */
  readonly roll: number
  /** Climb/dive. Swings the horizon vertically (rotationX). */
  readonly pitch: number
  /** Turn/heading. Pans the world horizontally (rotationY). */
  readonly yaw: number
}

/** Straight, level flight: no bank, no pitch, dead ahead. */
export const LEVEL: Attitude = { roll: 0, pitch: 0, yaw: 0 }

/**
 * The camera view matrix for a flight attitude at an eye position, on the shared
 * Math Box. Orientation is `rotationZ(roll) ∘ rotationX(pitch) ∘ rotationY(yaw)`;
 * `viewMatrix` inverts the camera's world placement. LEVEL at the origin yields
 * IDENTITY — a cockpit that isn't moving is a no-op view.
 */
export function flightView(attitude: Attitude, eye: Vec3): Mat4 {
  const orientation = multiply(
    multiply(rotationZ(attitude.roll), rotationX(attitude.pitch)),
    rotationY(attitude.yaw),
  )
  return viewMatrix(eye, orientation)
}

// src/core/biplane.ts
//
// The enemy biplane: its authentic 3-D model, the near/far model switch, the
// bank-∝-turn-rate coupling, and the pen-turtle render onto the rb1 scene
// substrate (scene.ts). Story rb2-3.
//
// THE DATA HALF. rb2-2 transcribed the plane's CONNECT-lists (DB.MAP back-face,
// DB.MAR front-face, DB.LNS wing struts) from the picture ROM into topology.ts —
// but the VERTICES those lists index live in the PROGRAM ROM `RBARON.MAC` and are
// transcribed HERE, byte-for-byte from `RBARON.MAC:6206-6259` ("PLANE POINTS DB").
// Each source line is `POINTP .X,.Y,.Z` (RBARON.MAC:57); we keep the logical
// coordinate its arguments name — [x, y, z] — matching topology.ts's Point3.
//
// THE LOD. The ROM ships two levels of detail in ONE point-set (RBARON.MAC:6258):
//   • `.PLPNT` = the full 42-vertex plane (DB.PLN, indices 0-41).
//   • `.DRPNT` = the 29-vertex distant/drone plane (`P.BACK-DB.PLN` → indices
//     0-28 only, i.e. the front faces; the back-face vertices 29-41 are dropped).
// So the drone is exactly the first 29 of the 42, and its front-only connect-list
// DB.MAR never references a vertex past 28. The near plane draws all 42 + the
// back-face list (DB.MAP, which falls through to DB.MAR) + the struts (DB.LNS);
// the far drone draws 29 + DB.MAR alone (topology.ts LOD note).
//
// THE BANK. Enemy planes bank into their turns with the SAME coupling as the
// player horizon (findings §2): PFROTN = PLDELX×8 clamped ±0x100, mapped to a
// roll angle. We reuse flight.ts's `toAttitude` so the enemy and the world share
// one source of truth — no duplicated ROLL_SCALE.
//
// PURE and deterministic. No DOM, no time, no randomness.

import { type Point3, type ConnectOp, DB_MAP, DB_MAR, DB_LNS } from './topology'
import { type SceneSegment, projectSegment } from './scene'
import { frustumHalfHeight } from './screen'
import { toAttitude } from './flight'
import type { Mat4 } from '@arcade/shared/math3d'

// ─────────────────────────────────────────────────────────────────────────────
// PLANE POINTS DB — the 42 biplane vertices (RBARON.MAC:6212-6256).
// Indices 0-28 are the front/main body (`DB.PLN`); 29-41 are the back faces
// (`P.BACK`). Comments echo the source's own vertex labels.
// ─────────────────────────────────────────────────────────────────────────────

/** `.PLPNT` — the full 42-vertex biplane model (RBARON.MAC:6212-6256). */
export const PLANE_POINTS: readonly Point3[] = [
  // DB.PLN — front faces / main body (indices 0-28), also the `.DRPNT` drone set.
  [0, 0, 40], //     0  BACK TAILS
  [-16, 0, 40], //   1
  [16, 0, 40], //    2
  [0, 16, 40], //    3
  [-4, 8, -36], //   4  FUSELAGE FRONT
  [-8, 4, -36], //   5
  [-8, -4, -36], //  6
  [-4, -8, -36], //  7
  [4, -8, -36], //   8
  [8, -4, -36], //   9
  [8, 4, -36], //    10
  [4, 8, -36], //    11
  [-40, 20, -40], // 12 TOP WING
  [40, 20, -40], //  13
  [-40, -8, -36], // 14 LOWER WING (FRONT EDGE)
  [40, -8, -36], //  15
  [0, 0, 18], //     16 TAIL JOINT
  [-6, 20, -28], //  17 WING STRUTS (FRONT EDGE)
  [-3, 7, -24], //   18
  [6, 20, -28], //   19
  [3, 7, -24], //    20
  [4, -8, -24], //   21
  [8, -16, -20], //  22
  [-4, -8, -24], //  23
  [-8, -16, -20], // 24
  [7, -20, -24], //  25 WHEELS
  [9, -12, -24], //  26
  [-7, -20, -24], // 27
  [-9, -12, -24], // 28
  // P.BACK — back faces (indices 29-41); dropped by the drone LOD.
  [-40, 20, -8], //  29 UPPER WING
  [40, 20, -8], //   30
  [-40, -8, -4], //  31 LOWER WING
  [40, -8, -4], //   32
  [-6, 20, -20], //  33
  [6, 20, -20], //   34
  [4, -8, -16], //   35 WHEEL STRUTS
  [-4, -8, -16], //  36
  [7, -20, -16], //  37 WHEELS
  [9, -12, -16], //  38
  [-7, -20, -16], // 39
  [-9, -12, -16], // 40
  [0, 0, -36], //    41
]

/**
 * `.DRPNT` — the 29-vertex distant/drone plane (RBARON.MAC:6259,
 * `P.BACK-DB.PLN`): the first 29 of {@link PLANE_POINTS}, front faces only.
 */
export const DRONE_POINTS: readonly Point3[] = PLANE_POINTS.slice(0, 29)

// ─────────────────────────────────────────────────────────────────────────────
// NEAR / FAR MODEL SWITCH
//
// ⚠ NOT THE ROM'S RULE. The ROM does not test distance anywhere in the picture
// path: `DRNPIC` (RBARON.MAC:4961, .RADIX 16) selects the 29-point `.DRPNT` set
// on `PLSTAT+6` bit 0x10 — "PLANE ROTATED" / "FACING AWAY" — an ORIENTATION bit.
// The depth threshold below is ours, invented from a mis-reading of the findings
// doc that rb4-2 has since retracted. Replacing it with the orientation bit is
// rb4-13; until then this is a deliberate, documented divergence, not a citation.
// ─────────────────────────────────────────────────────────────────────────────

/** A resolved biplane at one level of detail: its vertex set + the list to draw. */
export interface BiplaneModel {
  readonly points: readonly Point3[]
  readonly connect: readonly ConnectOp[]
}

/**
 * The plane's WINGSPAN in world units, read off its own vertices (top wing, x = ±40 → 80).
 * Derived, never typed: it is the ruler the LOD threshold is a fraction of, and a ruler that
 * can disagree with the model it measures is worthless.
 */
export const PLANE_SPAN = Math.max(...PLANE_POINTS.map((p) => Math.abs(p[0]))) * 2 // 80

/**
 * THE LOD THRESHOLD — and the only unit an LOD can honestly be written in: APPARENT SIZE.
 *
 * The drone model exists to drop 13 back-face vertices and 24 strokes once the plane is too
 * small on screen for them to read. That is a statement about the SCREEN, not about the depth
 * axis. So it is written as one: the far/drone LOD takes over once the plane's projected
 * wingspan falls below this fraction of the frame's HALF-HEIGHT — i.e. below 4% of the
 * screen's height. (Half-height, not half-width, because {@link frustumHalfHeight} does not
 * depend on the aspect: the LOD must not change when the player widens the window.)
 *
 * rb4-1 REWORK 3, and this is Reviewer finding 4. The old constant was `LOD_DISTANCE =
 * P_INDP * 3 / 8 = 1584` — it referenced the axis, it passed the "not a bare decimal" regex,
 * and it was still worth nothing, because the guard was the ONLY thing looking at it. The
 * Reviewer's proof: `LOD_DISTANCE = 1500 + 0 * P_INDP` restores the pre-sweep value, satisfies
 * every assertion in the registry, and ships 799/799 green. Its behavioural tests passed
 * IDENTICALLY at 1500 and at 1584 — they only ever asked that the switch land somewhere inside
 * the flight band, and both do.
 *
 * The fix is not a tighter regex. It is to give the number a MEANING, so that the value can be
 * measured instead of merely bounded. Ask what an LOD switch is actually FOR, denominate it in
 * that, and derive the depth. Now 1500 genuinely fails: at 1500 the plane's projected wingspan
 * is 0.0924 of the half-height, not 0.08, and tests/core/depth-scale.test.ts REGISTRY 6/7
 * measures that span through the REAL projection of the REAL PLANE_POINTS. There is a number
 * to be wrong about at last.
 *
 * HONEST: 0.08 is a PLAYTEST choice, not a ROM byte — the ROM ships both models but does not
 * pin the switch (findings §7). What the suite pins is the RELATION (the switch happens at a
 * known apparent size), not the value. Retuning it is legitimate and must be done HERE, in
 * screen units; the depth follows. What is no longer possible is for the depth axis to move
 * underneath it and change what the player sees while every test stays green.
 */
export const LOD_APPARENT_SPAN = 0.08

/**
 * Camera depth at/beyond which the far drone LOD is used — DERIVED from the apparent-size
 * threshold above, not chosen. `apparentSpan(d) = PLANE_SPAN / frustumHalfHeight(d)`, so the
 * switch depth is where that equals LOD_APPARENT_SPAN. ≈ 1732.
 *
 * (Pre-sweep it was a bare 1500 and it was quietly DEAD: the plane spawned at the misread 1080
 * — inside the switch — so `biplaneLOD` returned the 42-vertex model for the plane's entire
 * flight and the 29-vertex drone had never once rendered in the shipped game. The radix sweep
 * switched it on by accident. It is now switched on ON PURPOSE, at a chosen apparent size, and
 * REGISTRY 6/7 proves the drone actually draws at spawn and the full plane at the floor.)
 */
export const LOD_DISTANCE = PLANE_SPAN / LOD_APPARENT_SPAN / frustumHalfHeight(1)

/**
 * The plane's projected wingspan at `depth`, as a fraction of the frame's half-height — the
 * quantity {@link LOD_DISTANCE} is defined by. Exported so the suite can measure the switch in
 * the unit it is written in, rather than re-deriving the arithmetic it is checking.
 */
export function apparentSpan(depth: number): number {
  return PLANE_SPAN / frustumHalfHeight(depth)
}

/** Near/full plane: all 42 vertices, back faces (DB.MAP→DB.MAR fall-through) + struts. */
const NEAR_MODEL: BiplaneModel = {
  points: PLANE_POINTS,
  connect: [...DB_MAP, ...DB_MAR, ...DB_LNS],
}

/** Far/drone plane: the 29 front-face vertices, front list only. */
const FAR_MODEL: BiplaneModel = {
  points: DRONE_POINTS,
  connect: DB_MAR,
}

/**
 * Pick the LOD model for a camera-space depth: closer than {@link LOD_DISTANCE}
 * draws the full plane, at or beyond it draws the drone. Total over every finite
 * or non-finite input — a plane at/behind the eye (depth ≤ 0) is full detail, and
 * a NaN depth falls to the drone rather than crashing.
 */
export function biplaneLOD(depth: number): BiplaneModel {
  return depth < LOD_DISTANCE ? NEAR_MODEL : FAR_MODEL
}

// ─────────────────────────────────────────────────────────────────────────────
// BANK ∝ TURN-RATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The bank (roll, radians) an enemy flies for a given turn rate — the SAME
 * PFROTN = PLDELX×8 coupling, clamped ±0x100 → ±45°, that banks the player's
 * horizon (findings §2). Reuses flight.ts's `toAttitude` so there is one source
 * of truth for the coupling; pitch/altitude/heading don't affect roll.
 */
export function biplaneBank(turnRate: number): number {
  return toAttitude({ turnRate, pitchRate: 0, altitude: 0, heading: 0 }).roll
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDER — walk a connect-list as a pen turtle through the projection substrate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render a resolved {@link BiplaneModel} to NDC segments through a composed MVP.
 * The connect-list is a pen turtle: a BLANKV op (`draw: false`) moves the pen
 * dark to its vertex; a VSBLEV op (`draw: true`) draws a visible line from the
 * pen's current vertex to its own. Edges with both endpoints behind the eye are
 * dropped by scene.ts's `projectSegment` (never mirrored). Pure — the model is
 * read, never mutated.
 */
export function renderModel(model: BiplaneModel, mvp: Mat4): readonly SceneSegment[] {
  const segments: SceneSegment[] = []
  let current: Point3 | null = null
  for (const op of model.connect) {
    const vertex = model.points[op.point]
    if (op.draw && current !== null) {
      const segment = projectSegment(current, vertex, mvp)
      if (segment !== null) segments.push(segment)
    }
    current = vertex
  }
  return segments
}

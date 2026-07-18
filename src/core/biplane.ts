// src/core/biplane.ts
//
// The enemy biplane: its authentic 3-D model, the D4 orientation model switch,
// the bank-∝-turn-rate coupling, and the pen-turtle render onto the rb1 scene
// substrate (scene.ts). Story rb2-3; switch corrected to the ROM's rule by rb4-13.
//
// THE DATA HALF. rb2-2 transcribed the plane's CONNECT-lists (DB.MAP back-face,
// DB.MAR front-face, DB.LNS wing struts) from the picture ROM into topology.ts —
// but the VERTICES those lists index live in the PROGRAM ROM `RBARON.MAC` and are
// transcribed HERE, byte-for-byte from `RBARON.MAC:6206-6259` ("PLANE POINTS DB").
// Each source line is `POINTP .X,.Y,.Z` (RBARON.MAC:57); we keep the logical
// coordinate its arguments name — [x, y, z] — matching topology.ts's Point3.
//
// THE TWO MODELS. The ROM ships both in ONE point-set (the `.PLPNT`/`.DRPNT`
// equates, RBARON.MAC:6267-6268 in the citable copy):
//   • `.PLPNT` = the full 42-vertex plane (DB.PLN, indices 0-41).
//   • `.DRPNT` = the 29-vertex drone plane (`P.BACK-DB.PLN` → indices 0-28
//     only, i.e. the front faces; the back-face vertices 29-41 are dropped).
// So the drone is exactly the first 29 of the 42, and its front-only connect-list
// DB.MAR never references a vertex past 28. Which one draws is an ORIENTATION
// decision — PLSTAT+6 bit 0x10, D4 (DRNPIC, RBARON.MAC:4961-4970) — never a
// distance: rotated-toward (D4=1) draws all 42 + the back-face list (DB.MAP,
// which falls through to DB.MAR) + the struts (DB.LNS); facing-away (D4=0)
// draws 29 + DB.MAR alone (topology.ts LOD note).
//
// THE BANK. Enemy planes bank into their turns with the SAME coupling as the
// player horizon (findings §2): PFROTN = PLDELX×8 clamped ±0x100, mapped to a
// roll angle. We reuse flight.ts's `toAttitude` so the enemy and the world share
// one source of truth — no duplicated ROLL_SCALE.
//
// PURE and deterministic. No DOM, no time, no randomness.

import { type Point3, type ConnectOp, DB_MAP, DB_MAR, DB_LNS } from './topology'
import { type SceneSegment, projectSegment } from './scene'
import { toAttitude } from './flight'
import { multiply, rotationZ, scaling, translation, type Mat4, type Vec3 } from '@arcade/shared/math3d'
// DELIBERATE FUNCTION-ONLY CYCLE (rb4-17): enemy.ts imports `biplaneBank` from this module, and
// this module imports `displayPos` back — both are hoisted function declarations called only
// after init, which ESM resolves cleanly. It exists so the plane is DRAWN through the identical
// pan the gun KILLS it with (one seam, no second copy to rot — the guns.ts shellDepth lesson).
// Do NOT initialize a module-level `const` in either file from the other's exports: a top-level
// cross-call hits the TDZ and throws at load (the returning-ace.ts P_INDP precedent).
import { displayPos, type Enemy } from './enemy'

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

/**
 * PICTURE_SCALE — the ROM's composite vertex lift, relative to the LOGICAL `POINTP .X,.Y,.Z`
 * arguments transcribed above: X×4, Y×4, Z×1. Derived, not invented (rb4-17 AC-1):
 *
 *   • STORAGE — the POINTP macro assembles `.BYTE .Z,.X*2,.Y*4` (RBARON.MAC's macro; the
 *     picture source 037007.XXX:6-8 defines the identical one): X held ×2, Y held ×4, Z ×1.
 *   • ROTATE — ZAXIS (the full-plane 3-D path, PLTEST:4984 → PLNABZ, RBGRND.MAC:469-495)
 *     loads X `;X (*2)`, gives it ONE more ASL, and stores it `;X LSB (*4)`; Y is loaded
 *     `;Y (*4)` and stored with NO shift; Z enters unshifted (:474-478).
 *
 * So the wingspan enters the Math Box ISOTROPICALLY ×4 while fore/aft stays ×1 — a uniform
 * scale(4, 4, 1), never scale(4, 4, 4). Injecting the logical bytes at ×1 is the rb4-17 bug:
 * a quarter-size plane, the ~15px speck at spawn. (PROJECT's ×16/×4 pre-shifts are the GROUND
 * path, RBGRND.MAC:374-381, composing with the ground tables' own PFPNTS `.X/2,.Y*2` storage,
 * 037007.XXX:10-12 — a different routine over different tables; AC-5's reconciliation.)
 *
 * Classified in tests/core/depth-scale.test.ts's registry: a DIMENSIONLESS vertex scale that
 * legitimately appears beside a depth in planeModel's arithmetic — not a position on the axis.
 */
export const PICTURE_SCALE = 4

// ─────────────────────────────────────────────────────────────────────────────
// THE MODEL SWITCH — an ORIENTATION bit, not a distance (rb4-13)
//
// THE ROM'S RULE, verbatim: `DRNPIC` (RBARON.MAC:4961-4970, `.RADIX 16` region
// set at :74) reads `LDA PLSTAT+6 ;PLANE ROTATED` / `AND I,10` — bit 0x10, D4 —
// and branches on it alone. D4 is cleared at :2652 `;D4=0 (PLANE FACING AWAY)`,
// only once the entry rotation has ramped to zero (:2620-2652). Bit CLEAR →
// `20$`: the 29-point `.DRPNT` drone set + the DB.MAR front list. Bit SET →
// fall-through: the full model + the DB.MAP back faces (with a DRNTST
// scale-down — projection scale, which our real perspective divide supplies).
// No depth compare exists anywhere in the picture path.
//
// The depth threshold that used to live here (a switch distance, then an
// apparent-size derivation of it) was OUR invention, grown from a findings-doc
// misreading rb4-2 retracted. `facingAway === true` mirrors D4=0.
// ─────────────────────────────────────────────────────────────────────────────

/** A resolved biplane at one level of detail: its vertex set + the list to draw. */
export interface BiplaneModel {
  readonly points: readonly Point3[]
  readonly connect: readonly ConnectOp[]
}

/** D4=1, plane rotated toward the viewer: all 42 vertices, back faces (DB.MAP→DB.MAR fall-through) + struts. */
const FULL_MODEL: BiplaneModel = {
  points: PLANE_POINTS,
  connect: [...DB_MAP, ...DB_MAR, ...DB_LNS],
}

/** D4=0, plane facing away: the 29 front-face `.DRPNT` vertices, DB.MAR front list only. */
const DRONE_MODEL: BiplaneModel = {
  points: DRONE_POINTS,
  connect: DB_MAR,
}

/**
 * Pick the biplane model on the PLSTAT+6 D4 orientation bit, exactly as DRNPIC
 * does (RBARON.MAC:4961-4970): `facingAway` (D4=0) draws the 29-point drone with
 * the front list; rotated toward the viewer (D4=1) draws the full plane with the
 * back faces. The two models are module constants — the switch selects, it never
 * rebuilds. ("LOD" survives in the name only as history: the choice is
 * orientation, not level-of-detail-by-distance.)
 */
export function biplaneLOD(facingAway: boolean): BiplaneModel {
  return facingAway ? DRONE_MODEL : FULL_MODEL
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

/**
 * The plane's MODEL matrix — the testable core seam rb4-17 extracts from main.ts's inline
 * `translation(...)·rotationZ(...)` (which lived in the one file no test can import). main.ts
 * composes `renderModel(biplaneLOD(enemy.facingAway), multiply(projView, planeModel(enemy, eye)))`,
 * exactly as guns.ts put `shellSegments` beside `shellDepth`. Two ROM mechanisms live here:
 *
 *  • THE VERTEX PRE-SCALE — {@link PICTURE_SCALE}: the wingspan is lifted isotropically ×4
 *    (POINTP storage + ZAXIS's one ASL) while Z stays ×1 (ZAXIS reads it unshifted,
 *    RBGRND.MAC:474-478). scale(4, 4, 1), never scale(4, 4, 4).
 *
 *  • DUAL-Z — PLNLBS places the CENTRE by POSITION Z (RBARON.MAC:4817-4822 → POSITP), then
 *    reloads O.DPTH from PICTURE Z for the vertex divide (:4848-4850). In matrix form: the
 *    translation sits at −positionZ (so the perspective divide places the centre there), and
 *    the vertex scale takes an extra ×(positionZ / depth) so that same divide renders the
 *    picture at PICTURE-Z size. When the two Zs agree (every spawned plane — both step at
 *    PLPOSZ today) this is exactly translation(·, ·, −depth)·rotationZ·scale(4, 4, 1).
 *    One honest seam: the picture's INTERNAL foreshortening (a vertex's own z against the
 *    divide) rides positionZ here where the ROM's rides O.DPTH — indistinguishable while the
 *    Zs agree, and a ±40 model-z detail against a ≥320 depth when they don't.
 *
 * The display position enters through the SAME `displayPos` the gun kills with (rb4-6: one
 * pan, no second copy to rot). `?? depth`, never `||` — a hand-set small position Z is drawn
 * there, not defaulted away (the P_IIDL[0] lesson).
 */
export function planeModel(enemy: Enemy, eye: Vec3): Mat4 {
  const screen = displayPos(enemy, eye)
  const positionZ = enemy.positionZ ?? enemy.depth
  const s = PICTURE_SCALE * (positionZ / enemy.depth)
  return multiply(translation(screen.x, screen.y, -positionZ), multiply(rotationZ(enemy.bank), scaling(s, s, 1)))
}

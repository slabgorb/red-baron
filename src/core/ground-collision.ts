// src/core/ground-collision.ts
//
// GROUND COLLISION (GREND / PLYCOL) — story rb4-4 (AC-3). The ROM makes flying
// into a mountain lethal, and gates the whole playfield update on the flag:
// `BIT GREND / BVS 20$ ;PLAYER RAN INTO GROUND` runs BEFORE `JSR PFMOTN`
// (RBARON.MAC:783-785) — so the check is consulted every calc frame, ahead of
// motion, and death freezes the world for the pilot.
//
// THE TEST (PLYCOL, ";STANDARD PLAYER COLLISION DETECT", :3946-3991): the
// mountain's decoded silhouette POINTS are walked and each is tested against a
// window around the player's position — X within PCDX = 0xC1 (";PF CD X MIN",
// :457), and the Y half asks whether the point sits at/above the screen centre,
// i.e. whether the silhouette reaches the pilot's eye line. It is only consulted
// at all once the mountain is CLOSE: the caller gates on the object's 16-bit
// depth (`LDA OBJECT+4 / CMP I,1 / LDA OBJECT+5 / SBC I,2 / BCS 29$`,
// :4634-4638 — the two-byte idiom again, landscape.ts's MIN_DEPTH lesson) before
// `JSR PLYCOL` (:4641); a hit stores `D6=GROUND COLLISION` (:4643-4645).
//
// UNITS (session Delivery Finding — the rb4-5 conflict): the SCAPE silhouettes
// peak at ~24 picture units while the live eye is I4YPOS/4 ≈ 132; the ROM
// reconciles the two through the projection (I4YPOS is subtracted from object Y
// before the divide, RBGRND.MAC:277-283), which story rb4-5 is rewriting. This
// predicate therefore pins the ROM's RELATIONS — the depth gate, the lateral
// window, the altitude escape, slot activity — in the silhouette's own units;
// the live-unit bridge lands with rb4-5's translation-based pipeline.
//
// PURE and deterministic. No DOM, no time, no randomness.

import type { Mountain } from './landscape'
import { SCAPES } from './topology'

// ─── ROM-exact constants (RBARON.MAC, .RADIX 16 region — HEX) ─────────────────

/**
 * The 16-bit depth gate (:4634-4638): collision is only tested at depths BELOW
 * this — `CMP I,1` against the LSB, `SBC I,2` against the MSB, carry-set skips.
 * (0x02 << 8) | 0x01 = 0x0201; NOT the CMP operand 0x01 or the SBC operand 0x02
 * alone (the exact staircase landscape.ts's MIN_DEPTH was once mis-read through).
 */
export const PLAYER_COLLISION_DEPTH = 0x0201

/** PCDX = 0xC1 — ";PF CD X MIN" (:457): the lateral half-window of PLYCOL's point test. */
export const PCDX = 0xc1

// ─── the predicate ────────────────────────────────────────────────────────────

/** Does this one mountain put silhouette geometry over the pilot? (PLYCOL's walk.) */
function mountainCollides(eyeHeight: number, m: Mountain): boolean {
  if (!m.active) return false // a dead PFOBJ slot is not geometry
  if (!Number.isFinite(m.depth) || m.depth >= PLAYER_COLLISION_DEPTH) return false // the :4634-4638 gate
  const points = SCAPES[m.scape]
  if (points === undefined) return false
  // The point walk: laterally within the PCDX window of the player (the player is
  // the window centre — the world offsets by m.x), and vertically reaching the eye.
  return points.some(([px, py]) => Math.abs(m.x + px) <= PCDX && py >= eyeHeight)
}

/**
 * One calc frame of the GREND test, over every PF-object slot (the ROM loops all
 * four). Total: an empty sky, a NaN eye, a NaN depth, and an inactive slot all
 * read as "no collision" rather than throwing.
 */
export function groundCollision(eyeHeight: number, mountains: readonly Mountain[]): boolean {
  if (!Number.isFinite(eyeHeight)) return false
  return mountains.some((m) => mountainCollides(eyeHeight, m))
}

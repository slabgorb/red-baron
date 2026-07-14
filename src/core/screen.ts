// src/core/screen.ts
//
// THE SCREEN AXIS — the SECOND denominator, and the one nobody enumerated.
//
// ─── WHY THIS MODULE EXISTS ─────────────────────────────────────────────────────
//
// rb4-1 grew the DEPTH axis 3.91x (P.INDP 1080 -> 0x1080 = 4224). TEA then enumerated
// every constant denominated IN DEPTH (tests/core/depth-scale.test.ts) and the story was
// declared closed. It was not, because there is a second class of constant that the same
// 3.91x silently invalidated, and nobody had a ruler for it:
//
//     A SCREEN-SPACE X OR Y IS MEANINGLESS WITHOUT THE DEPTH IT IS SEEN AT.
//
// The perspective divide is the whole reason. Under sceneProjection(), a world-window x at
// depth d lands at
//
//     ndc.x  =  (f / aspect) * x / d        f = 1 / tan(VERTICAL_FOV / 2)
//     ndc.y  =  f * y / d
//
// so a number typed as "640 window units" is not a position on the screen at all. It is a
// position on the screen ONLY ONCE you say at what depth. Move the depth axis and every one
// of those numbers means something different, silently, with no test to notice.
//
// It happened exactly like that. main.ts's BLIMP_DESPAWN_X = 640 carried the comment "past
// which the drifting blimp has left the frame". At the blimp's old 600 cruise depth that was
// TRUE (ndc 1.04 — just outside). When CRUISE_DEPTH moved to 2112 to satisfy a depth-range
// test, 640 became ndc 0.295 — and the airship was DELETED IN THE MIDDLE OF THE SCREEN,
// while the depth suite stayed green, because the depth suite was looking at the other axis.
//
// ─── THE RULE ───────────────────────────────────────────────────────────────────
//
//     A constant that describes WHERE SOMETHING IS ON THE SCREEN must be denominated in
//     the PROJECTED frame (NDC / a fraction of the frame), not in world-window units —
//     and it must be converted to world units THROUGH THE DEPTH IT IS SEEN AT, here.
//
// Then "has it left the frame?" is asked directly instead of being approximated by a
// hand-fitted world number, and the answer is right at ANY depth and ANY aspect. There is
// nothing left to drift.
//
// ─── THE FRUSTUM IS READ FROM THE REAL PROJECTION, NOT RE-DERIVED ───────────────
//
// The one thing this module must never do is grow its OWN copy of the field of view. That is
// how the tracer seam opened (main.ts kept a hand-copied mirror of the gun's reach, and the
// copy did not track). So every number below is read straight out of `sceneProjection()`'s
// own matrix — mvp[0] is f/aspect, mvp[5] is f — which is the same matrix `projectSegment`
// divides by. A frustum computed here and a pixel drawn by the shell cannot disagree: they
// are the same two floats.
//
// PURE and deterministic. No DOM, no time, no randomness.

import { sceneProjection } from './scene'

/**
 * Half-WIDTH of the view frustum at `depth`, in world-window units: the world x that lands
 * exactly on the right-hand edge of the frame (ndc.x = 1).
 *
 * Read out of the projection matrix itself: `ndc.x = mvp[0] * x / depth`, so the x at
 * ndc.x = 1 is `depth / mvp[0]`. Depends on the ASPECT, because a wider window shows more
 * world to the sides.
 */
export function frustumHalfWidth(depth: number, aspect: number): number {
  return depth / sceneProjection(aspect)[0]
}

/**
 * Half-HEIGHT of the view frustum at `depth`, in world-window units: the world y that lands
 * on the top edge (ndc.y = 1).
 *
 * `mvp[5]` is `f` alone — the vertical FOV does NOT depend on the aspect (only the width
 * does), so this needs no aspect and is the stabler ruler of the two. Anything that must
 * mean the same thing on a phone and on an ultrawide is measured against THIS.
 */
export function frustumHalfHeight(depth: number): number {
  return depth / sceneProjection(1)[5]
}

/** A usable frame has a FINITE, POSITIVE extent. Anything else is not a frame. */
const isRealFrame = (half: number): boolean => Number.isFinite(half) && half > 0

/**
 * The NDC x a world-window `x` seen at `depth` projects to. |ndc| > 1 is off the left/right
 * edge of the frame.
 *
 * TOTAL, and the degenerate branch is chosen rather than inherited. If the frame has no
 * FINITE POSITIVE extent — depth <= 0 (at or behind the eye), a non-finite depth or aspect, a
 * non-finite x — it reports +Infinity: "infinitely far outside the frame".
 *
 * Note the deliberate ruling on `depth = Infinity`. The raw arithmetic would give ndc 0: an
 * infinitely distant frame is infinitely wide, so everything sits at the vanishing point, dead
 * centre. That limit is mathematically correct and it is a TRAP for the only question this
 * function is ever asked — "has the object left the frame?" — because it answers "no, it is in
 * the middle of your screen" about an object that is nowhere. A caller who forgot to guard
 * would keep such an object alive forever. So a non-finite frame reports OUTSIDE, and the
 * fail-safe direction is the same one everywhere: an object we cannot place is an object we
 * are not drawing.
 */
export function ndcX(x: number, depth: number, aspect: number): number {
  const half = frustumHalfWidth(depth, aspect)
  if (!isRealFrame(half) || !Number.isFinite(x)) return Number.POSITIVE_INFINITY
  return x / half
}

/** The NDC y a world-window `y` seen at `depth` projects to. Total, as {@link ndcX}. */
export function ndcY(y: number, depth: number): number {
  const half = frustumHalfHeight(depth)
  if (!isRealFrame(half) || !Number.isFinite(y)) return Number.POSITIVE_INFINITY
  return y / half
}

/**
 * The inverse of {@link ndcX}: the world-window x that lands at `ndc` when seen at `depth`.
 *
 * THIS is the function a screen-denominated constant is spent through. Write the constant in
 * the unit you can actually picture — "0.9 of the way to the edge" — and let the depth it is
 * seen at do the conversion. Then moving the depth axis moves nothing on screen.
 */
export function worldX(ndc: number, depth: number, aspect: number): number {
  return ndc * frustumHalfWidth(depth, aspect)
}

/** The inverse of {@link ndcY}: the world-window y that lands at `ndc` when seen at `depth`. */
export function worldY(ndc: number, depth: number): number {
  return ndc * frustumHalfHeight(depth)
}

/** Is an NDC coordinate inside the visible square? ([-1, 1] — scene.ts's convention.) */
export function inFrame(ndc: number): boolean {
  return Math.abs(ndc) <= 1
}

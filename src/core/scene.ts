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
// TWO PROJECTORS (rb4-5): `projectSegment` is the PURE perspective divide — the same
// frustum `screen.ts` measures its ruler against (rb4-1). `projectWorldSegment` adds the
// constant HORIZN screen-Y lift on top. They are split because the ROM adds HORIZN in
// exactly ONE place: POSITH/POSITP (RBGRND.MAC:269-322, `ADC I,HORIZN` at :303), the
// PLAYFIELD-object path that also subtracts the I4YPOS eye height and pans by UNIV4X. The
// motion-object path — PLANE PROJECT (RBGRND.MAC:359) — adds NO HORIZN. So the world
// objects (horizon, mountains) get the lift; the camera-relative motion objects (planes,
// blimp, wrecks, tracers) do NOT — mirroring how rb4-5 already routes UNIV4X/I4YPOS to the
// world eye alone. AC5's "EVERY object (POSITH)" is scoped by its own `(POSITH)`.
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
 * HORIZN = $40 = 64 to the divided screen-Y of a PLAYFIELD object (POSITH, RBGRND.MAC:303);
 * our screen is NDC [-1, 1], so the offset is HORIZN / ROM_SCREEN_HALF. The exact
 * ROM-unit → NDC scale is not byte-pinned (rb4-5 Dev seam) — 512 keeps the horizon a
 * short lift above centre, matching the ROM's low-altitude look.
 */
const ROM_SCREEN_HALF = 512
/** HORIZN as an NDC screen-Y offset added to a WORLD/playfield object's projected point
 *  (rb4-5 AC5 — the POSITH path; see `projectWorldSegment`). */
const HORIZN_NDC = HORIZN / ROM_SCREEN_HALF

/** Vertical field of view of the cockpit — a 60° window over the vector world. */
const VERTICAL_FOV = Math.PI / 3
/** Near clip: just in front of the eye. */
const NEAR = 1
/**
 * Far clip — past the ROM's FARTHEST playfield object, with headroom.
 *
 * rb4-1: the old comment here cited the horizon depth with the poisoned doc's UN-RADIXED
 * digits. `HORZ` is defined at RBARON.MAC:451 inside the `.RADIX 16` region opened at
 * :74, so its literal is HEX → 0x1000 = 4096. Read as decimal, 20000 looked like 20× the
 * horizon when it was under 5× — and, worse, it sat BELOW the ROM's farthest objects: the
 * mountain recycle depth P.OBZI = 0x7F00 = 32512 (RBARON.MAC:443) and PFOBIZ's opening
 * slot at 0x8200 = 33280 (RBARON.MAC:1305).
 *
 * HONEST CAVEAT (Reviewer, rb4-1): today this constant is INERT. `perspective()` writes
 * `far` into the projection matrix's Z row, and `projectSegment` below reads only rows 0,
 * 1 and 3 (x, y, w) — clip-Z is discarded, and nothing in src/shell/ depth-culls. So no
 * mountain was ever actually clipped by the old 20000, and raising it changes no pixel.
 * It is corrected because a wrong number in a comment is how this whole epic started; it
 * is NOT load-bearing, and nobody should assume it is.
 */
const FAR = 40000

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
 * Project a world-space segment through an MVP into an NDC `SceneSegment` — the PURE
 * perspective divide, no screen offset. This is the exact frustum `screen.ts` measures its
 * ruler against (rb4-1): a world x/y at the frame edge lands on ndc ±1, so a pixel drawn
 * here and a frustum computed there cannot disagree. Camera-relative MOTION objects (planes,
 * blimp, wrecks, tracers) go through this — the ROM's PLANE PROJECT path adds no HORIZN
 * (RBGRND.MAC:359). Returns null when both endpoints are behind the eye (clip w ≤ 0) — the
 * substrate never strokes a perspective-mirrored ghost.
 */
export function projectSegment(a: Vec3, b: Vec3, mvp: Mat4): SceneSegment | null {
  const ca = toClip(mvp, a)
  const cb = toClip(mvp, b)
  if (ca.w <= 0 && cb.w <= 0) return null
  return {
    x1: ca.x / ca.w,
    y1: ca.y / ca.w,
    x2: cb.x / cb.w,
    y2: cb.y / cb.w,
  }
}

/**
 * Project a WORLD/PLAYFIELD segment (horizon, mountains — the ROM's POSITH path): the pure
 * `projectSegment` divide PLUS the constant HORIZN screen-Y lift the ROM's POSITH/POSITP add
 * after the divide (`ADC I,HORIZN`, RBGRND.MAC:303), a depth-INDEPENDENT offset on every
 * playfield object (rb4-5 AC5). Only the world objects take it — motion objects use the bare
 * `projectSegment`, exactly as rb4-5 routes the UNIV4X pan + I4YPOS eye height to the world
 * eye alone. Null-passthrough (both endpoints behind the eye) is preserved.
 */
export function projectWorldSegment(a: Vec3, b: Vec3, mvp: Mat4): SceneSegment | null {
  const seg = projectSegment(a, b, mvp)
  if (seg === null) return null
  return { x1: seg.x1, y1: seg.y1 + HORIZN_NDC, x2: seg.x2, y2: seg.y2 + HORIZN_NDC }
}

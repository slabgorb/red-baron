// src/core/blimp.ts
//
// The Blimp / Zeppelin — rb2-10, RE-MACHINED by rb4-15. The one enemy the sky owes
// the player that ISN'T a weaving biplane — and it is an APPROACHING AIRSHIP, not
// the constant-depth lateral drifter this module used to be (CD-005's "drifts
// across" certification was CONFIRMED FALSE by the rb4 coverage review: the drift
// model borrowed the plane's div-by-2 fire and invented the cruise).
//
// THE MACHINE (RBARON.MAC — the citable ~/Projects/red-baron-source-text copy,
// md5 497db93e…, .RADIX 16 from :74; all lines read firsthand, rb4-15):
//
//   ENTRY   INITBP :1425-1426  LDA I,10 / STA BLOBJ+5 ;Z MSB  (LSB cleared :1421)
//           → enters at Z = 0x1000 = 4096, nearly the plane's own spawn depth.
//   CLOSE   BLMOTN :4259-4265  CLC / LDA BLOBJ+4 / ADC I,-80 / STA BLOBJ+4 /
//           LDA BLOBJ+5 / ADC I,-1 / STA BLOBJ+5 — a 16-bit add of 0xFF80:
//           → Z CLOSES by 0x80 = 128 every calc-frame. It flies AT you.
//   GONE    BLMOTN :4266-4270  CMP I,1 / BPL 55$ … 40$: LDA I,0 ;CLR BLOBJ
//           → alive while the Z MSB >= 1 (Z >= 0x100); the frame Z drops below
//             0x100 = 256 the object is CLEARED — it has flown past the player.
//   SPAWN   :2325-2331  LDA N.PLNZ / CMP I,4 / BCC 25$ / JSR RANDOM / AND I,0C /
//           BNE 25$ / JSR CINTBP ;RANDOM BLIMP
//           → TWO gates: no blimp until FOUR planes have appeared in the game
//             (N.PLNZ :129, INC'd per plane :2398), THEN a 1-in-4 roll.
//   FIRE    SHLAUN :4027-4030  LDA FRAME / AND I,3 ;1 OUT OF 4 FRAMES — and
//           SHLAUN :4038-4041  LDX GMLEVL / DEX / DEX / BMI SHLAUX
//           ;NO GROUND SHELLS @ LOWER LEVELS
//           → the blimp's shells launch through the SHARED SHLAUN (BLMOTN calls
//             it at :4229 "LAUNCH SHELL @ PLAYER"): 1 frame in 4, only at
//             GMLEVL >= 2. The old "÷2, no level gate" was the plane's model.
//
// WHAT IS NOT MODELLED (routed as rb4-15 Delivery Findings, not silently invented):
// the ROM blimp also carries a lateral X velocity (BLOBJ+0C, :4235-4250, with the
// UNIV4X world-wrap) and INITBP picks its entry side off PLDELX — a successor story
// ports the lateral machine. Here the airship holds its lateral station and CLOSES.
//
// PURE and deterministic. No DOM, no time, no ambient randomness — the ONLY source
// of randomness is the seeded Rng handed to `spawn`.

import { type Rng, nextFloat } from '@arcade/shared/rng'
import { multiply, rotationY, rotationZ, translation, type Mat4 } from '@arcade/shared/math3d'
import { BLCOLL_POINTS, BLIMP_PICTURE, BLIMP_POINTS } from './topology'
import { renderModel } from './biplane'
import { worldX, worldY } from './screen'
import type { SceneSegment } from './scene'
import type { Enemy } from './enemy'

// ─── ROM-exact data (rb4-15 — transcribed, hex-spelled, cited) ────────────────

/**
 * The entry Z depth — INITBP stores Z MSB = 0x10, LSB = 0 (RBARON.MAC:1425-1426,
 * with the LSB cleared at :1421): the airship ENTERS at 0x1000 = 4096, deep on the
 * same axis the planes fly down (P.INDP = 0x1080 = 4224). Hex on purpose — this
 * epic exists because 0x1080 was once read as decimal 1080.
 */
export const BLIMP_Z_START = 0x1000

/**
 * The Z closed per calc-frame — BLMOTN adds 0xFF80 (-0x80) to the 16-bit Z every
 * calculation frame (RBARON.MAC:4259-4265): 128 units of approach, ~10.42 times a
 * second. Entry to gone is 31 calc-frames ≈ 3.0 s of closing airship.
 */
export const BLIMP_CLOSE_SPEED = 0x80

/**
 * The spawn gate: no blimp until this many planes have APPEARED in the game —
 * LDA N.PLNZ / CMP I,4 / BCC skip (RBARON.MAC:2325-2327). N.PLNZ is "NUMBER OF
 * PLANES COUNT" (:129), incremented once per plane spawned (:2398). The caller
 * maintains the count; this module judges it.
 */
export const BLIMP_PLANE_GATE = 4

/**
 * The surviving 25 % — the SECOND gate: JSR RANDOM / AND I,0C / BNE skip
 * (RBARON.MAC:2328-2330). Bits 2-3 of the hardware RANDOM must both be zero:
 * exactly 1 roll in 4. Still a SEPARATE roll from enemy.ts's LONE_PLANE_CHANCE
 * (also 0.25, but deciding lone-plane-vs-formation).
 */
export const BLIMP_SPAWN_CHANCE = 0.25

/**
 * The despawn line — BLMOTN keeps the airship while the Z MSB >= 1 (CMP I,1 /
 * BPL 55$, RBARON.MAC:4266-4267) and CLEARS the object below it (40$: LDA I,0
 * ;CLR BLOBJ, :4268-4270). Z = 0x100 exactly is ALIVE; 0xFF is gone.
 */
const BLIMP_DESPAWN_Z = 0x100

/** SHLAUN's level gate: LDX GMLEVL / DEX / DEX / BMI = fire only at GMLEVL >= 2
 *  ("NO GROUND SHELLS @ LOWER LEVELS", RBARON.MAC:4038-4041). */
const BLIMP_FIRE_LEVEL = 2

// ─── placement within the tested invariants (inferred — see Design Deviations) ─
//
// The story pins the Z machine; WHERE the airship sits laterally is this module's
// choice inside the approach's own geometry. The constraint is WATCHABILITY: the
// airship's x/y are fixed for its whole life (the ROM's lateral velocity is the
// descoped successor), while the visible window SHRINKS 16x as Z closes 4096 → 256.
// A position chosen "near the edge at entry" (the old drifter's idiom) is off-frame
// long before the reap. So the entry offsets are denominated in NDC AT THE DESPAWN
// LINE and spent through screen.ts there: the airship is placed so that at the
// moment it fills the screen and flies past you (Z = 0x100) it sits at |ndc x| in
// [MIN, MIN+RANGE) — framed at the climax, a whisker off the boresight at entry.

const ENTRY_NDC_MIN = 0.2
const ENTRY_NDC_RANGE = 0.36

/** Vertical spawn spread, as an NDC y fraction at the SAME despawn-line depth. */
const SPAWN_NDC_Y_RANGE = 0.35

/**
 * The airship's bounding radius in world units — READ OFF ITS OWN GEOMETRY (max
 * |coordinate| over BLIMP_POINTS = 40, the envelope's nose/tail along local z,
 * which the broadside yaw turns into its screen-X extent). Derived, so any consumer
 * reasoning about the hull can never disagree with the hull that is drawn. (Its
 * old despawn role is retired — rb4-15's reap is a depth question.)
 */
export const BLIMP_HULL_RADIUS = Math.max(...BLIMP_POINTS.flatMap((p) => p.map(Math.abs))) // 40

/** The BLIMP_PICTURE geometry is authored NOSE-ON along local z; a quarter-turn yaw presents
 *  the airship's FLANK (broadside), the way the cabinet frames the Zeppelin. Inferred
 *  — the source pins the geometry, not the presentation pose. (Moved out of main.ts in rb4-1:
 *  the pose is part of what "the blimp is on screen" MEANS, and main.ts is not testable.) */
const BLIMP_YAW = Math.PI / 2

// ─── state ───────────────────────────────────────────────────────────────────

/** The blimp's state — screen-window x/y (display-space, rb2-13), ROM-unit depth. */
export interface Blimp {
  /** Screen-window X — holds its lateral station for the whole approach (rb4-15). */
  readonly x: number
  /** Vertical offset — random at spawn. */
  readonly y: number
  /** Depth in front of the eye — ENTERS at BLIMP_Z_START and CLOSES every calc-frame. */
  readonly depth: number
  /** Lateral velocity — 0 this story (the ROM's BLOBJ+0C is a routed successor). */
  readonly deltaX: number
  /** Roll (radians): a Zeppelin flies LEVEL — always 0 (inferred; see Design Deviations). */
  readonly bank: number
  /** The screen side it sits on (windscreen bullet-hole side, WNDSHD). */
  readonly side: -1 | 1
  /** D7 "active" status. */
  readonly active: boolean
}

// ─── the two-gate spawn decision (rb4-15, :2325-2331) ─────────────────────────

/**
 * The BLMOTN spawn decision, BOTH gates: the sky must have shown BLIMP_PLANE_GATE
 * planes (LDA N.PLNZ / CMP I,4 / BCC skip), and THEN the caller's roll must land
 * strictly below the 25 % chance (RANDOM / AND I,0C). The caller draws `roll`
 * (e.g. nextFloat of the seeded Rng) and maintains `planeCount`, so the decision
 * is deterministic. Total — a NaN count is not four planes, a NaN/non-finite roll
 * fails safe to "no blimp"; neither conjures a phantom airship.
 */
export function shouldSpawnBlimp(planeCount: number, roll: number): boolean {
  return planeCount >= BLIMP_PLANE_GATE && roll < BLIMP_SPAWN_CHANCE
}

// ─── spawn (INITBP: deep entry at the ROM depth) ──────────────────────────────

/**
 * Spawn a blimp entering DEEP — at exactly BLIMP_Z_START — on a random side of the
 * boresight. Consumes the seeded Rng for its side, lateral offset, and Y — in that
 * order, unchanged from the drifter era, so a seed still picks the same side and
 * the same relative placement. Pure per (seed, aspect).
 *
 * TAKES THE FRAME'S ASPECT (rb4-1): the lateral offsets are NDC fractions spent
 * through screen.ts (at the despawn line — see the placement note above), and what
 * an NDC x means in world units depends on how wide the window is.
 */
export function spawn(rng: Rng, aspect: number): Blimp {
  const side: -1 | 1 = nextFloat(rng) < 0.5 ? -1 : 1
  const entryNdc = ENTRY_NDC_MIN + nextFloat(rng) * ENTRY_NDC_RANGE
  const spawnNdcY = (nextFloat(rng) * 2 - 1) * SPAWN_NDC_Y_RANGE
  return {
    x: side * worldX(entryNdc, BLIMP_DESPAWN_Z, aspect), // framed at the fly-past
    y: worldY(spawnNdcY, BLIMP_DESPAWN_Z),
    depth: BLIMP_Z_START, // the transcribed entry — see the constant's own citation
    deltaX: 0, // the lateral machine (BLOBJ+0C) is the routed successor
    bank: 0, // a Zeppelin flies level
    side,
    active: true,
  }
}

// ─── the reap: the ROM's own line, asked of the depth (rb4-15) ────────────────

/**
 * THE REAP — the despawn as ONE INDIVISIBLE DECISION. Hand it the stepped airship;
 * take back either the airship or nothing. There is no third thing to do with the
 * answer, and no boolean for a caller's `||` to poison — that is rb4-1's hard-won
 * shape, kept on purpose (see the round-3 story in tests/core/screen-scale.test.ts).
 *
 * WHAT CHANGED (rb4-15): the question. The drifter asked the SCREEN ("has the hull
 * cleared the frame?", frustum + aspect). The machine asks the DEPTH: BLMOTN keeps
 * the object while Z >= 0x100 and CLEARS it below (CMP I,1 / BPL … CLR BLOBJ,
 * RBARON.MAC:4266-4270) — large, on screen, and gone, because it has flown past
 * you. A depth question takes no aspect, so the parameter is retired rather than
 * left as a dead input for someone to poison.
 *
 * Total: a non-finite pose is not drawable and reports gone (it must, or a NaN
 * airship closes forever, firing).
 */
export function reapBlimp(blimp: Blimp): Blimp | null {
  if (!Number.isFinite(blimp.x) || !Number.isFinite(blimp.depth)) return null
  return blimp.depth < BLIMP_DESPAWN_Z ? null : blimp
}

// ─── the picture: the pose the cockpit strokes (moved out of main.ts, rb4-1) ────

/**
 * The airship's tracer-free picture: the authentic 36-vertex BLIMP_PICTURE
 * (topology.ts, rb2-2), posed BROADSIDE by a quarter-turn yaw, at the blimp's
 * position, projected through the shared substrate.
 *
 * Lives HERE, not in main.ts, for the same reason `shellSegments` moved into
 * guns.ts: a function that decides where an object APPEARS cannot sit in a module
 * no test can import. This is the function the cockpit draws with, so it is the
 * function the suite interrogates (the approach's GROWTH property is measured
 * through it).
 */
export function blimpSegments(blimp: Blimp, viewProj: Mat4): readonly SceneSegment[] {
  const model = multiply(
    translation(blimp.x, blimp.y, -blimp.depth),
    multiply(rotationY(BLIMP_YAW), rotationZ(blimp.bank)),
  )
  return renderModel(BLIMP_PICTURE, multiply(viewProj, model))
}

/**
 * The airship's OWN collision window — BLCOLL (RBARON.MAC:6270-6277), the 8-corner
 * ±16 × ±16 × ±40 box PLNDB pairs with the blimp (:6285-6287), POSED BROADSIDE exactly as
 * the picture is drawn (BLIMP_YAW quarter-turn: the model's z span becomes the screen's x
 * span, its y band stays y). DERIVED from the topology.ts transcription, never re-typed —
 * the window can never drift from the box, and the box equals the drawn envelope's extents,
 * so the hit test matches what the player sees (WYSIWYG): ±40 wide, ±16 tall, SYMMETRIC —
 * no plane belly/top bias. The box's model-x ±16 (the broadside DEPTH extent) is NOT ported
 * to a shell-z bound here — the shared seam's WINDOW_Z owns that axis; routed as a Delivery
 * Finding per TEA, never silently invented.
 */
const BLIMP_WINDOW = {
  x: Math.max(...BLCOLL_POINTS.map((p) => Math.abs(p[2]))), // 40 — broadside width (model z)
  yMin: Math.min(...BLCOLL_POINTS.map((p) => p[1])), //         −16
  yMax: Math.max(...BLCOLL_POINTS.map((p) => p[1])), //          16
} as const

/**
 * Adapt the airship to the shared Enemy-shaped target the rb2-5 guns collision (`collides`)
 * and the rb2-6 explosion (`explode`) consume — the blimp rides the SAME kill pipeline as a
 * plane (rb2-13 AC-7). The `kind` is cosmetic to those geometry-only seams; the kill is valued
 * on scoring.ts's dedicated flat-200 'blimp' path. (Was an ad-hoc literal in main.ts and a
 * second copy in tests/core/blimp.test.ts — two copies of an adapter is one too many.)
 * rb4-11 AC-4: the target CARRIES its BLCOLL window, so `collides` judges the airship by its
 * own broadside body instead of the plane's COLLD plate.
 */
export function blimpTarget(blimp: Blimp): Enemy {
  return {
    kind: 'lead',
    x: blimp.x,
    y: blimp.y,
    depth: blimp.depth,
    deltaX: blimp.deltaX,
    bank: blimp.bank,
    side: blimp.side,
    active: blimp.active,
    // rb4-13: an airship holding its course is a settled thing — D4 clear, like a
    // settled plane. (Only the wreck path ever reads this; a blimp has no entry turn.)
    facingAway: true,
    window: BLIMP_WINDOW, // rb4-11 AC-4 — the BLCOLL broadside box rides the target
  }
}

// ─── the calc-frame approach (one step per 96 ms calc frame — findings §1) ─────

/**
 * Advance the blimp one calculation frame: the depth CLOSES by exactly
 * BLIMP_CLOSE_SPEED (BLMOTN :4259-4265), with the lateral station, bank, side, and
 * active status carried unchanged. Pure — returns a fresh state, the input
 * untouched. Unbounded by design: `reapBlimp` is the only thing that ends the
 * approach, at the ROM's own line.
 */
export function step(blimp: Blimp): Blimp {
  return { ...blimp, depth: blimp.depth - BLIMP_CLOSE_SPEED }
}

// ─── firing (through the shared SHLAUN — BLMOTN :4229) ─────────────────────────

/**
 * Does the blimp fire THIS calc-frame? The blimp's shells launch through the
 * SHARED SHLAUN, so they inherit BOTH of its gates (rb4-15):
 *
 *   * the ÷4 cadence — LDA FRAME / AND I,3 ;1 OUT OF 4 FRAMES (:4027-4030):
 *     fires only when FRAME & 3 === 0, ~2.6 shots/s at the calc rate;
 *   * the level gate — LDX GMLEVL / DEX / DEX / BMI ;NO GROUND SHELLS @ LOWER
 *     LEVELS (:4038-4041): fires only at GMLEVL >= 2. The early sky's blimp is
 *     a TARGET, not a threat — the mid sky is where it opens up.
 *
 * Pure and deterministic. Total — a non-finite frame fails safe to "hold fire",
 * and a NaN level is not >= 2.
 */
export function blimpFires(frame: number, level: number): boolean {
  if (!Number.isFinite(frame)) return false
  return (Math.floor(frame) & 3) === 0 && level >= BLIMP_FIRE_LEVEL
}

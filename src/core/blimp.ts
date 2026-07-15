// src/core/blimp.ts
//
// The Blimp / Zeppelin — story rb2-10. The one enemy the sky owes the player that
// ISN'T a weaving biplane: it rolls in on a ~25 % chance, DRIFTS steadily across
// the screen (it does NOT weave/reverse like enemy.ts's window-follower), fires at
// the player, and is worth a flat 200 pts when gunned down — drawn with the
// authentic BLIMP/DBLIMP picture-ROM geometry (topology.ts, rb2-2). Grounded in
// findings §3 (BLMOTN, RBARON.MAC:4170+: "~25 % random spawn, drifts across, also
// fires at the player, worth 200 pts. There is no separate barrage balloon — the
// airship is the blimp. [ROM-verified]") and §4 (blimp = 200 pts, flat).
//
// DRIFTS ACROSS, NOT A WEAVE (findings §3): the biplane (enemy.ts) accelerates ΔX
// toward the window limits and REVERSES at the bounds — its ΔX takes both signs.
// The blimp does the opposite: ONE steady drift with a CONSTANT-SIGN velocity that
// carries it from its entry side across centre to the far side. It flies LEVEL (no
// bank — a Zeppelin does not roll into a turn) and cruises at a constant depth; the
// motion is purely lateral.
//
// ALSO FIRES AT THE PLAYER (findings §3): unlike a plane, whose "@ PLAYER" bit is
// PLNLVL level-gated (enemy.planeFires: level < 4 → never), the blimp is a threat
// whenever it is present. `blimpFires` takes no level and fires on the established
// ÷2 FRAME cadence (findings §3, PLNSHL) — a menace even in the early sky the
// planes leave quiet.
//
// FRAME CADENCE (findings §1 — load-bearing): the drift and the fire cadence tick
// ONCE per calculation frame (~10.42 Hz / 96 ms), NOT per 62.5 Hz display frame —
// main.ts steps the blimp inside the SIM_TIMESTEP_S accumulator like every other
// rb2 motion object.
//
// SCALE NOTE: BLMOTN is not byte-transcribed in the quarry, so the ROM pins the
// DATA that IS documented — the ~25 % spawn (BLIMP_SPAWN_CHANCE), the flat 200-pt
// value (scoring.ts BLIMP_SCORE), the authentic geometry (topology.ts) — while the
// cruise depth, the drift speed, the entry offset, the bank (0), and the ÷2 fire
// phase are chosen HERE within the tested invariants (like enemy.ts's
// WEAVE_SPEED_CAP), and flagged as inferred in the session's Design Deviations.
//
// PURE and deterministic. No DOM, no time, no ambient randomness — the ONLY source
// of randomness is the seeded Rng handed to `spawn`.

import { type Rng, nextFloat } from '@arcade/shared/rng'
import { multiply, rotationY, rotationZ, translation, type Mat4 } from '@arcade/shared/math3d'
import { P_INDP } from './returning-ace'
import { SIM_HZ } from './timing'
import { BLIMP_PICTURE, BLIMP_POINTS } from './topology'
import { renderModel } from './biplane'
import { frustumHalfWidth, ndcX, worldX, worldY } from './screen'
import type { SceneSegment } from './scene'
import type { Enemy } from './enemy'

// ─── ROM-exact data (findings §3, BLMOTN) ────────────────────────────────────

/**
 * The ~25 % random spawn roll (findings §3, BLMOTN). This is the blimp module's OWN
 * constant — a SEPARATE roll from enemy.ts's LONE_PLANE_CHANCE (which is also 0.25
 * but decides lone-plane-vs-formation); this one decides "a blimp appears at all".
 */
export const BLIMP_SPAWN_CHANCE = 0.25

// ─── tuning within the tested invariants (inferred — BLMOTN not byte-transcribed) ─

/**
 * Cruise depth the airship drifts across at — a visible mid-field distance. Inferred
 * (BLMOTN does not byte-pin it), but DENOMINATED IN THE AXIS rather than typed as a number.
 *
 * rb4-1 REWORK 2. This was a bare `600`, and "mid-field" was true of it only in the world we
 * misread: against the old 1080 spawn, 600 was 56% of the way out. Against the real P.INDP =
 * 4224 it is 14% — the airship was cruising in the player's face, and its own comment was the
 * only thing still claiming otherwise. Half the plane's spawn depth IS the mid-field, at any
 * scale, so the two can never drift apart again.
 *
 * REWORK 3 — AND THIS IS THE LESSON. Moving it was RIGHT and it BROKE THE GAME, because the
 * blimp is a RENDERED object and three of its other constants were positions ON THE SCREEN,
 * denominated in world-window units. What an x means on screen is x / depth. Move the depth
 * and every one of them means something else. Measured through the real sceneProjection(16/9):
 *
 *                            depth 600 (old)      depth 2112 (new, unfixed)
 *     enters at |x| 180..300   ndc 0.292..0.487     ndc 0.083..0.138   (near screen CENTRE)
 *     despawns at |x| = 640    ndc 1.039 (OFF)      ndc 0.295 (IN FRAME!)
 *
 * The airship popped in near the middle of the screen, drifted ~21% of a screen-width, and was
 * DELETED IN PLAIN VIEW — while main.ts's despawn comment still said "has left the frame" and
 * the depth suite stayed green, because the depth suite was looking at the other axis.
 *
 * So none of the three are world numbers any more. They are written in the PROJECTED frame and
 * spent through screen.ts at the depth they are seen at. Change CRUISE_DEPTH to anything you
 * like now — 600, 2112, 40000 — and nothing about what the player sees changes. That property
 * is tested directly (tests/core/screen-scale.test.ts flies the whole crossing at three
 * different cruise depths and asserts the same screen path, frame for frame).
 */
const CRUISE_DEPTH = P_INDP / 2 // 2112

/**
 * How long the airship takes to sail the FULL WIDTH of the frame. Inferred.
 *
 * The drift used to be `DRIFT_SPEED = 12` world-window units per calc-frame — a number with no
 * meaning until you say how wide the frame is where it is flying, which is exactly the disease.
 * At the old 600 depth those 12 units were 1% of the frame per frame; at 2112 they are 0.28%,
 * so the SAME constant made the airship crawl at a quarter of the pace it was tuned for.
 *
 * Ten seconds of screen is a thing a human can picture, and it is the same ten seconds at any
 * depth and any window shape. It also preserves what the game shipped: 12 units/frame at the
 * old 600 depth crossed the visible width in ~103 calc-frames = 9.9 s.
 */
const DRIFT_CROSSING_SECONDS = 10

/**
 * Entry band, in PROJECTED space: the airship enters at |ndc x| in [MIN, MIN+RANGE) — hard
 * against a screen edge (0.72..0.98 of the way out), but still INSIDE the frame, so it is
 * visible the moment it appears and can never be despawned on its first step. Inferred.
 *
 * The AC (rb2-10) says the blimp DRIFTS ACROSS THE SCREEN. That is a claim about the screen,
 * so it is written in screen units.
 */
const ENTRY_NDC_MIN = 0.72
const ENTRY_NDC_RANGE = 0.26

/**
 * Vertical spread of the random spawn Y, as a fraction of the frame's HALF-HEIGHT (ndc y).
 * Was a bare `40` window units — 11% of the half-height at the old depth, 3% at the new one,
 * which pinned every airship to the horizon line. Inferred.
 */
const SPAWN_NDC_Y_RANGE = 0.35

/**
 * The airship's bounding radius in world units — READ OFF ITS OWN GEOMETRY (max |coordinate|
 * over BLIMP_POINTS = 40, the envelope's nose/tail along local z, which the broadside yaw
 * turns into its screen-X extent). Derived, so the hull the despawn reasons about can never
 * disagree with the hull that is drawn.
 *
 * This is what makes "has it left the frame?" answerable about a SHAPE rather than a point:
 * the airship is gone only when its NEAREST edge is past the frustum edge — not when its
 * centre is.
 */
export const BLIMP_HULL_RADIUS = Math.max(...BLIMP_POINTS.flatMap((p) => p.map(Math.abs))) // 40

/** The BLIMP_PICTURE geometry is authored NOSE-ON along local z; a quarter-turn yaw presents
 *  the airship's FLANK (broadside), the way the cabinet frames the drifting Zeppelin. Inferred
 *  — the source pins the geometry, not the presentation pose. (Moved out of main.ts in rb4-1:
 *  the pose is part of what "the blimp is on screen" MEANS, and main.ts is not testable.) */
const BLIMP_YAW = Math.PI / 2

// ─── state ───────────────────────────────────────────────────────────────────

/** The blimp's state — all ROM screen-window units. */
export interface Blimp {
  /** Screen-window X — DRIFTS across centre (0) in ONE direction (never reverses). */
  readonly x: number
  /** Vertical offset — random at spawn. */
  readonly y: number
  /** Depth in front of the eye (> 0); the airship cruises here and drifts sideways. */
  readonly depth: number
  /** Drift velocity — CONSTANT SIGN; carries the blimp from its entry side to the far side. */
  readonly deltaX: number
  /** Roll (radians): a Zeppelin flies LEVEL — always 0 (inferred; see Design Deviations). */
  readonly bank: number
  /** The screen side it entered from; it drifts toward the OTHER side. */
  readonly side: -1 | 1
  /** D7 "active" status. */
  readonly active: boolean
}

// ─── the ~25 % spawn roll ──────────────────────────────────────────────────────

/**
 * The BLMOTN spawn decision: a blimp appears when the caller's roll lands strictly
 * BELOW the ~25 % chance (findings §3). The caller draws `roll` (e.g. nextFloat of the
 * seeded Rng) so the decision is deterministic. Total — a NaN / non-finite roll fails
 * safe to "no blimp" (NaN < 0.25 is false), never conjuring a phantom airship.
 */
export function shouldSpawnBlimp(roll: number): boolean {
  return roll < BLIMP_SPAWN_CHANCE
}

// ─── spawn (BLMOTN side entry, drifting across) ────────────────────────────────

/**
 * The airship's lateral drift, in world units per calc-frame, for an airship cruising at
 * `depth` in a frame of `aspect`. Derived from DRIFT_CROSSING_SECONDS: the full visible width
 * is `2 * frustumHalfWidth`, and it is crossed in `DRIFT_CROSSING_SECONDS` seconds at the
 * ~10.42 Hz calc cadence (SIM_HZ, findings §1).
 *
 * Exported so the suite can fly the crossing at depths other than CRUISE_DEPTH and prove the
 * screen path is the same one — the property the whole rework exists for.
 */
export function blimpDriftPerFrame(depth: number, aspect: number): number {
  const visibleWidth = 2 * frustumHalfWidth(depth, aspect)
  return visibleWidth / (DRIFT_CROSSING_SECONDS * SIM_HZ)
}

/**
 * Spawn a blimp entering from a random screen side and drifting toward the OTHER side, level
 * and at cruise depth. Consumes the seeded Rng for its side, entry position, and Y — in that
 * order, unchanged, so a seed still picks the same side and the same relative placement. Pure
 * per (seed, aspect); the drift velocity points AWAY from the entry edge (sign −side) so the
 * airship crosses the player's view.
 *
 * TAKES THE FRAME'S ASPECT (rb4-1). It has to: "enters near a screen edge" is a question about
 * the screen, and the screen's world extent depends on how wide the window is as well as on
 * how far away the airship is. The alternative — a fixed world x, tuned once against whatever
 * the depth axis happened to be that day — is the bug this story is about. The Rng draw order
 * is untouched, so seeded determinism is preserved; the mapping from those draws to world
 * coordinates is now denominated in the frame.
 */
export function spawn(rng: Rng, aspect: number): Blimp {
  const side: -1 | 1 = nextFloat(rng) < 0.5 ? -1 : 1
  const entryNdc = ENTRY_NDC_MIN + nextFloat(rng) * ENTRY_NDC_RANGE
  const spawnNdcY = (nextFloat(rng) * 2 - 1) * SPAWN_NDC_Y_RANGE
  return {
    x: side * worldX(entryNdc, CRUISE_DEPTH, aspect), // hard against the entry edge, in frame
    y: worldY(spawnNdcY, CRUISE_DEPTH),
    depth: CRUISE_DEPTH,
    deltaX: -side * blimpDriftPerFrame(CRUISE_DEPTH, aspect), // toward the far side
    bank: 0, // a Zeppelin flies level
    side,
    active: true,
  }
}

// ─── the despawn: ask the question the comment always claimed to be asking ─────

/**
 * HAS THE AIRSHIP LEFT THE FRAME? — the rb2-13 AC-6 despawn, asked in PROJECTED SPACE.
 *
 * `step` is unbounded by design (the drift never reverses), so somebody has to say when the
 * blimp is gone. main.ts used to say it with `Math.abs(blimp.x) > BLIMP_DESPAWN_X` where
 * BLIMP_DESPAWN_X = 640, under a comment reading "screen-window |x| past which the drifting
 * blimp has left the frame". That comment was a QUESTION ABOUT THE SCREEN answered with a
 * WORLD NUMBER, and it was true only at the cruise depth it was fitted to. Move the depth and
 * it silently becomes false: at 2112, |x| = 640 is ndc 0.295 — the airship was deleted while
 * it was three-tenths of the way from the centre of the screen, in plain view of the player.
 *
 * Do not multiply 640 by 3.52. That fixes the instance and leaves the class — the next person
 * to touch CRUISE_DEPTH breaks it again, and no test will notice, because nothing here is
 * measuring what the player can see. ASK THE QUESTION DIRECTLY:
 *
 *     the airship is gone when its NEAREST edge is outside the frustum (|ndc| > 1)
 *
 * which is correct at every depth and every aspect, and cannot drift, because there is no
 * longer a number to drift. The two conservative choices in it are deliberate:
 *
 *   * NEAREST EDGE, not centre: `|x| - BLIMP_HULL_RADIUS` — the whole hull must be clear, or
 *     the tail of a 40-unit airship is still being drawn on screen when it is deleted.
 *   * The FAR side of the hull's depth range (`depth + radius`): the hull is 3-D, so its
 *     vertices sit at slightly different depths, and a vertex slightly FARTHER away projects
 *     slightly FARTHER IN. Using the farthest gives the widest frustum, which keeps the
 *     airship alive fractionally longer. The error is always in the safe direction — an
 *     invisible blimp may live one extra frame; a visible one is never deleted.
 *
 * Total: a non-finite pose is not drawable, and reports gone (it must, or a NaN airship drifts
 * forever, firing).
 */
export function blimpOffScreen(blimp: Blimp, aspect: number): boolean {
  if (!Number.isFinite(blimp.x) || !Number.isFinite(blimp.depth)) return true
  const nearestEdge = Math.abs(blimp.x) - BLIMP_HULL_RADIUS
  if (!(nearestEdge > 0)) return false // the hull still straddles the boresight — plainly in view
  return ndcX(nearestEdge, blimp.depth + BLIMP_HULL_RADIUS, aspect) > 1
}

/**
 * THE REAP — the despawn as ONE INDIVISIBLE DECISION. Hand it the drifted airship; take back
 * either the airship or nothing. There is no third thing to do with the answer.
 *
 * ─── WHY THIS EXISTS, AND IT IS NOT A CONVENIENCE WRAPPER ────────────────────────────────
 *
 * `blimpOffScreen` above is correct, exhaustively measured, and it was NOT ENOUGH, because it
 * is a PREDICATE — and a predicate is an opinion the caller may overrule. rb4-1 round 3 shipped
 * main.ts:374 as
 *
 *     blimp = blimpOffScreen(drifted, aspect) ? null : drifted
 *
 * which is right, and the Reviewer then walked straight through it in one line:
 *
 *     const gone = blimpOffScreen(drifted, aspect) || Math.abs(drifted.x) > REAP_LIMIT
 *     blimp = gone ? null : drifted                      // 832/832 STILL GREEN
 *
 * The world constant is back — a bare 640 in the file no test could import — and it DOMINATES
 * the `||`, so the correct predicate never gets to decide anything. Every guard the suite had
 * still passed, because every one of them asked whether main.ts *named* `blimpOffScreen`:
 * it imported it (regex), it referenced it (noUnusedLocals), it said the word "despawn" (regex),
 * it assigned `blimp = null` somewhere (regex). All true. All satisfied by a lie. The airship was
 * deleted on its FIRST calc-frame, at 70-84 % of the way to the edge, fully drawn on screen.
 *
 * IMPORTED IS NOT OBEYED. So the caller no longer gets an opinion to argue with: it gets the
 * ANSWER. `reapBlimp` folds the predicate and the deletion into one call, so there is no boolean
 * left lying around in main.ts for an `||` to poison, and nothing for a rival bound to dominate.
 * The cockpit's entire despawn is now `blimp = reapBlimp(drifted, aspect)` — an expression with
 * no operator in it, which is the point: you cannot corrupt a decision you cannot spell.
 *
 * (And the containment is now PROVEN rather than trusted, twice over: tests/cockpit-loop.test.ts
 * BOOTS main.ts under a stub DOM and watches the real airship cross the real frame — so any
 * despawn main.ts invents, by any name, in any shape, is caught by its effect on what is drawn;
 * and tests/core/screen-scale.test.ts's DECISION PATH guard fails any write to `blimp` that is
 * not literally this call.)
 *
 * Total, by inheritance: a non-finite pose is off-screen, so it is reaped rather than left to
 * drift and fire forever.
 */
export function reapBlimp(blimp: Blimp, aspect: number): Blimp | null {
  return blimpOffScreen(blimp, aspect) ? null : blimp
}

// ─── the picture: the pose the cockpit strokes (moved out of main.ts, rb4-1) ────

/**
 * The airship's tracer-free picture: the authentic 36-vertex BLIMP_PICTURE (topology.ts,
 * rb2-2), posed BROADSIDE by a quarter-turn yaw, at the blimp's drift position, projected
 * through the shared substrate.
 *
 * Lives HERE, not in main.ts, for the same reason `shellSegments` moved into guns.ts: a
 * function that decides where an object APPEARS cannot be allowed to sit in a module no test
 * can import. "The blimp is not deleted while it is still visible" is only a testable claim if
 * a test can ask the game — not a reconstruction of the game — what the blimp looks like. This
 * is the function the cockpit draws with, so it is the function the suite interrogates.
 */
export function blimpSegments(blimp: Blimp, viewProj: Mat4): readonly SceneSegment[] {
  const model = multiply(
    translation(blimp.x, blimp.y, -blimp.depth),
    multiply(rotationY(BLIMP_YAW), rotationZ(blimp.bank)),
  )
  return renderModel(BLIMP_PICTURE, multiply(viewProj, model))
}

/**
 * Adapt the airship to the shared Enemy-shaped target the rb2-5 guns collision (`collides`)
 * and the rb2-6 explosion (`explode`) consume — the blimp rides the SAME kill pipeline as a
 * plane (rb2-13 AC-7). The `kind` is cosmetic to those geometry-only seams; the kill is valued
 * on scoring.ts's dedicated flat-200 'blimp' path. (Was an ad-hoc literal in main.ts and a
 * second copy in tests/core/blimp.test.ts — two copies of an adapter is one too many.)
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
    // rb4-13: an airship cruising its course is a settled thing — D4 clear, like a
    // settled plane. (Only the wreck path ever reads this; a blimp has no entry turn.)
    facingAway: true,
  }
}

// ─── the calc-frame drift (one step per 96 ms calc frame — findings §1) ────────

/**
 * Advance the blimp one calculation frame: a steady lateral drift by `deltaX`, with
 * the depth, bank, side, and active status carried unchanged. UNLIKE the biplane's
 * weave, `deltaX` never reverses — the drift is monotone across the screen. Pure —
 * returns a fresh state, the input untouched.
 */
export function step(blimp: Blimp): Blimp {
  return { ...blimp, x: blimp.x + blimp.deltaX }
}

// ─── firing (BLMOTN "also fires at the player") ────────────────────────────────

/**
 * Does the blimp fire THIS calc-frame? It fires on the ÷2 FRAME cadence (findings §3,
 * PLNSHL — at most every OTHER calc-frame, gated by the FRAME LSB), and — unlike a
 * plane — with NO PLNLVL level gate: the blimp is a threat at every GMLEVL. Pure and
 * deterministic in the frame. Total — a non-finite frame fails safe to "hold fire".
 * NOTE: which frame parity fires is inferred (the ROM pins the ÷2, not the phase); we
 * fire on even FRAME.
 */
export function blimpFires(frame: number): boolean {
  if (!Number.isFinite(frame)) return false
  return (Math.floor(frame) & 1) === 0 // ÷2 FRAME cadence — fire on even frames
}

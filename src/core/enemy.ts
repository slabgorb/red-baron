// src/core/enemy.ts
//
// The single enemy biplane: its weaving window-follower dogfight AI, the seeded
// side-entry spawn, and the DISCHK proximity mapping that feeds the player's
// control feel. Story rb2-4 — the lone-plane case (the 25 % RANDOM roll); the
// drone formations and score-scaled counts are rb2-7.
//
// STEERING is a WEAVING WINDOW-FOLLOWER, NOT a beeline seeker (findings §3,
// UPDPLN/PLNDEL/P.WINDW, RBARON.MAC:2570/2743/2806): the plane accelerates its ΔX
// (ACCEL=0x30) toward the window limits and REVERSES at the boundaries, weaving
// across screen centre. It follows the WINDOW, not the player — a stationary
// target is never chased to a standstill. Limits are GMLEVL-indexed
// (P.OLIM/P.ILIM, RBARON.MAC:2939/2945) — higher level = wider, more aggressive weave.
//
// SPAWN (findings §3, NWPLNE/STPLNE, RBARON.MAC:2241/2274): enters from a screen
// SIDE banked 90°, random X/Y, at depth P.INDP=0x1080. This story ships the LONE
// plane; `spawn` returns ONE enemy and consumes the injected seeded Rng for its
// random placement (the arcade-shared PRNG, same pattern as asteroids' spawnRock).
//
// BANK ∝ turn-rate reuses flight.ts's `biplaneBank` (PFROTN = ΔX×8, clamped ±0x100
// → ±45°) so the enemy and the player horizon share ONE coupling with no
// duplicated ROLL_SCALE (story context, findings §2). The 90° spawn bank is an
// entry flourish the plane rolls out of as it settles into the weave.
//
// PURE and deterministic. No DOM, no time, no ambient randomness — the ONLY source
// of randomness is the seeded Rng handed to `spawn`.

import { type Rng, nextFloat } from '@arcade/shared/rng'
import { biplaneBank } from './biplane'
import type { ProximityBand } from './flight'
import { P_MNDP, P_INDP, closeSpeed } from './returning-ace'

// ─── ROM-exact data (RBARON.MAC, `.RADIX 16` region — HEX) ───────────────────
//
// RADIX WARNING (rb4-1). Every equate below is defined under `.RADIX 16`, set at
// RBARON.MAC:74 and unbroken until the vertex island at :6217. The digits are HEX.
// This block was previously transcribed as DECIMAL, from a doc that cited the DECOY
// BUILD — a 10-SEP-81 image that never shipped, whose line numbers run 4 short of the
// real one. Read the region, not the digits.

/** P.OLIM — outer weave-window limit, GMLEVL-indexed (RBARON.MAC:2939, .RADIX 16 region). */
export const P_OLIM: readonly number[] = Object.freeze([0x40, 0x80, 0x120, 0x1a0, 0x200])

/** P.ILIM — inner weave-window limit, GMLEVL-indexed (RBARON.MAC:2945, .RADIX 16 region). */
export const P_ILIM: readonly number[] = Object.freeze([0x20, 0x30, 0x80, 0x120, 0x160])

/**
 * HORIZN — the horizon's offset along the ROM's Y axis (RBARON.MAC:456 "HORIZON OFFSET (Y AXIS)",
 * .RADIX 16). Read as decimal 40 it would name the wrong horizon, so it is pinned to the byte.
 *
 * IT IS NOT ADDED TO OUR `y`, AND THAT IS THE POINT. PLNDEL enters the window machine twice, and
 * the two entries are not symmetric in the SOURCE but are symmetric in MEANING:
 *
 *     Y (X-reg = 2):  `LDA ZX,PLSTAT+8` → PLSTAT+10, then `SBC I,HORIZN`   (:2749-2752)
 *     X (X-reg = 0):  `LDA ZX,PLSTAT+8` → PLSTAT+8   ";X DISPLAY"           (P.WITR, :2867)
 *
 * The X axis is loaded RAW because PLSTAT+8 is already the DISPLAY position (";X SCREEN POSITION",
 * :3157). The Y axis is loaded MINUS HORIZN for exactly one reason: to put it in that same display
 * space. So the subtraction does not displace the weave — it REMOVES a displacement, and the
 * machine then runs on screen coordinates on both axes, centred on the boresight.
 *
 * Our `x`/`y` ARE those screen-window coordinates (see the fields below, and guns.ts:179-181 —
 * "Screen-window Y at fire (enemy.y space)"): main.ts:196 hands `y` straight to the camera, so
 * y = 0 is the boresight, which is where the horizon sits in level flight and where the pilot's
 * shell is fired (`{ x: muzzleX(gun), y: 0, … }`). Our y is therefore ALREADY `PLSTAT+10 - HORIZN`;
 * subtracting HORIZN a second time would double-count the conversion and lift every plane 64 units
 * above a gun whose hit window is ±32 — planes that cannot be shot. Kept exported as the pinned
 * provenance of the offset our coordinate origin has already absorbed. (rb4-6; see the story
 * deviation — AC-2's "biased by HORIZN" reads the subtraction backwards.)
 */
export const HORIZN = 0x40

/**
 * DRINZ — the drone's initial (deeper) spawn depth (RBARON.MAC:466 "DRONE INITIAL Z", .RADIX 16).
 * `P.1ST+5 = DRINZ/100` (:2369) seeds a drone FARTHER back than the lead's P.INDP (0x1080), so a
 * formation enters staggered in depth. Read as decimal 1600 the drones spawned 3.5× too shallow.
 */
export const DRINZ = 0x1600

/**
 * WO.RTN — the fly-past re-entry disable delay, in calc frames (RBARON.MAC:473 "W/O RETURNING",
 * .RADIX 16). When a plane bores past P.MNDP the ROM sets `PLSTAT+7 = WO.RTN` (:2736) to hold the
 * slot empty before the returning attack re-enters. Exported for the returning-ace arming wiring.
 */
export const WO_RTN = 0x10

/**
 * ACCEL — the per-calc-frame ΔX weave acceleration (P.WCHK).
 * RBARON.MAC:465 `ACCEL =30`, .RADIX 16 region (set at :74) → 0x30 = 48.
 * Read as decimal 30 the weave built turn-rate at 62.5% of arcade rate — and since
 * bank ∝ ΔX, the planes banked shallower too.
 */
export const ACCEL = 0x30

/**
 * P.MNDP — the closest a plane bores in before the fly-by becomes a returning pass.
 * RBARON.MAC:469 `P.MNDP =140`, .RADIX 16 region (set at :74) → 0x140 = 320.
 *
 * Re-exported from returning-ace.ts under its ROM NAME rather than re-typed, so one ROM
 * equate cannot hold two values again (it held 140 in both places, and both were wrong).
 *
 * rb4-1 REWORK: this was briefly exported as `MIN_DEPTH`, which collided with
 * landscape.ts's own `MIN_DEPTH` — the mountain recycle threshold, 0x01C0 = 448. One
 * identifier, two unrelated ROM equates, two values: exactly the bug class this story
 * exists to kill, recreated in the act of killing it. The ROM name is unambiguous.
 *
 * P.INDP (RBARON.MAC:464, 0x1080 = 4224 — the depth a plane ENTERS at, STPLNE) rides
 * back out through here too. It now lives beside P.MNDP in returning-ace.ts, which
 * imports nothing: the two ends of the depth axis belong in the one module every other
 * module can reach without a cycle. enemy.ts's public surface is unchanged.
 */
export { P_MNDP, P_INDP }

/** The RANDOM roll: 25 % chance of a lone plane (findings §3). rb2-7 branches on it. */
export const LONE_PLANE_CHANCE = 0.25

// ─── tuning within the tested invariants (inferred — NOT ROM-pinned) ─────────

/**
 * Absolute ceiling on |ΔX|/|ΔY| so the weave crosses the window smoothly instead of
 * teleporting wall-to-wall. The ROM accelerates the delta toward per-zone TARGET deltas
 * (P.ODLX/P.IDLX/P.IIDL, RBARON.MAC:2948-2956) whose ×2/×3 macro scale is unverified with
 * no baked artifact — deliberately NOT byte-pinned (see the story deviation). This ceiling
 * plus the per-level braking cap below stand in for those targets behaviourally.
 */
const WEAVE_SPEED_CAP = 100

/**
 * Per-level weave-speed cap (rb4-6): the top speed whose braking distance (v²/2·ACCEL) is
 * exactly HALF the inner window — so a plane closing on centre always reverses AWAY (P.INER)
 * BEFORE it crosses, never drifting through to the far wall. `sqrt(ACCEL·ilim)` gives that
 * speed; the absolute WEAVE_SPEED_CAP bounds it at the wide (deep-level) windows. This is the
 * behavioural stand-in for the un-pinned per-zone target deltas — pinned by AC-1's tests, not
 * by a fabricated byte.
 */
const weaveSpeedCap = (ilim: number): number => Math.min(WEAVE_SPEED_CAP, Math.sqrt(ACCEL * ilim))

/**
 * DISCHK band cutoffs by depth — INFERRED tunables. DISCHK itself (RBARON.MAC:3468)
 * branches on a distance FLAG (D6/D7 of TEMP3) and pins only the scale fractions
 * (1.0 / 0.625 / 0.375); which depth raises which flag is not pinned here, so these
 * cutoffs are ours. (Which fraction belongs to which band — ours are inverted — is rb4-5's.)
 *
 * rb4-1: they are now expressed as FRACTIONS OF P_INDP rather than as bare numbers.
 * The old 300/700 were calibrated against the mis-read 1080-deep world; against the
 * true 0x1080 = 4224 they left the plane's whole flight in 'far'/'mid' — it floored at
 * P.MNDP = 320 and could never reach 'near' at all. Tying them to P_INDP means the depth
 * scale and the bands can never drift apart again.
 */
const NEAR_DEPTH = P_INDP / 4 // 1056
const MID_DEPTH = (P_INDP * 5) / 8 // 2640

/** The entry flourish: the plane peels in banked a full 90°. */
const SPAWN_BANK = Math.PI / 2

/**
 * How many calc frames the ±90° entry bank takes to ROLL OUT into the weave. The ROM ramps
 * the entry Y-rotation to zero over several frames before `AND I,0EF` clears D4
 * (RBARON.MAC:2620-2652) — it does not collapse to the shallow steering bank on frame 1.
 * The exact ramp length is not source-pinned; 8 matches rb4-13's facingAway flourish window.
 */
const ENTRY_RAMP_FRAMES = 8

/** Vertical spread of the random spawn Y (± window units) — inferred, keeps the plane on-screen. */
const SPAWN_Y_RANGE = 40

// ─── state ───────────────────────────────────────────────────────────────────

/**
 * Which kind of plane this is — the lead or one of its two drone wingmen (findings §3,
 * "1 PLANE, 2 DRONES"). rb2-7 adds this discriminant so the kill payoff can score a
 * drone as the flat DRONE_SCORE and a close lead by depth, and so PLNXCG can promote a
 * surviving drone into the next lead. A subset of scoring.ts's KillKind (the blimp — a
 * borrowed slot, findings §3 — arrives in rb2-10); scoreKill accepts an EnemyKind value
 * structurally, so this type stays HERE (the lower module) with no import into scoring.
 */
export type EnemyKind = 'lead' | 'drone'

/** The enemy plane's state — all ROM-window units. */
export interface Enemy {
  /** Lead plane or drone wingman (findings §3). */
  readonly kind: EnemyKind
  /** Screen-window X — weaves across centre (0), bounded ±P_OLIM[level]. */
  readonly x: number
  /** Vertical offset — random at spawn. */
  readonly y: number
  /** Depth in front of the eye; P_INDP at spawn, closes toward the player. */
  readonly depth: number
  /** ΔX — the weave velocity / turn-rate (accelerates by ACCEL, reverses at bounds). */
  readonly deltaX: number
  /**
   * ΔY — the vertical weave velocity (rb4-6). PLNDEL runs the SAME window machine on the Y axis
   * (biased by HORIZN) before the X axis, so a plane climbs and dives as well as slews. Optional:
   * hand-built Enemy fixtures (hitbox/render probes) omit it, and step() reads it as 0.
   */
  readonly deltaY?: number
  /** Roll (radians): ±90° entry flourish, then biplaneBank(deltaX) once weaving. */
  readonly bank: number
  /**
   * rb4-6 — frames of ±90° entry-bank flourish still to roll out (RBARON.MAC:2620-2652). While
   * > 0 the bank RAMPS from 90° toward the weave; at 0 it IS biplaneBank(ΔX). Optional/defaults
   * to 0 (settled) for hand-built fixtures; spawn seeds it to ENTRY_RAMP_FRAMES.
   */
  readonly entryFrames?: number
  /**
   * rb4-6 — the drone FORMATION phase (PLSTAT+6 D1, RBARON.MAC:2368/3512). `true` ⇔ still flying
   * PARALLEL, locked to the lead's motion; `false` ⇔ a lead, or a drone FRDRNE has freed to weave
   * on its own. Leads are never parallel. Optional/defaults falsy for hand-built fixtures.
   */
  readonly parallel?: boolean
  /** The screen side it entered from. */
  readonly side: -1 | 1
  /** D7 "active" status. */
  readonly active: boolean
  /**
   * The PLSTAT+6 D4 orientation mirror (rb4-13): `true` ⇔ D4=0 "PLANE FACING
   * AWAY" (RBARON.MAC:2652); `false` ⇔ D4=1, still rotated toward the viewer.
   * THIS bit — never depth — picks the biplane model (DRNPIC, RBARON.MAC:4961).
   * Cleared (set true) once the entry rotation completes, exactly as the ROM's
   * :2620-2652 ramp does; re-rotation belongs to the ace pass, not the weave.
   */
  readonly facingAway: boolean
}

// ─── pure helpers ─────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** Clamp a GMLEVL to a valid table index (0 .. .LEVLS-1). */
const levelIndex = (level: number): number => clamp(Math.floor(level) || 0, 0, P_OLIM.length - 1)

// ─── spawn ─────────────────────────────────────────────────────────────────────

/**
 * Spawn the lone enemy from a screen side, banked 90°, at depth P.INDP — the 25 %
 * lone-plane case (findings §3). Consumes the seeded Rng for its random side, X
 * (in the outer band of the window), and Y. Pure per seed.
 */
export function spawn(rng: Rng, level = 0): Enemy {
  const lvl = levelIndex(level)
  const olim = P_OLIM[lvl]
  const ilim = P_ILIM[lvl]
  const side: -1 | 1 = nextFloat(rng) < 0.5 ? -1 : 1
  // random X in the outer band [ilim, olim), on the chosen side — it enters from the edge
  const mag = ilim + nextFloat(rng) * (olim - ilim)
  const y = (nextFloat(rng) * 2 - 1) * SPAWN_Y_RANGE
  return {
    kind: 'lead', // the lone plane is a lead; drones are fielded by waves.ts's spawnWave
    x: side * mag,
    y,
    depth: P_INDP,
    deltaX: 0,
    deltaY: 0, // the Y window machine starts from rest, biased toward HORIZN
    bank: side * SPAWN_BANK,
    entryFrames: ENTRY_RAMP_FRAMES, // the 90° entry bank rolls out over the flourish window
    side,
    active: true,
    facingAway: false, // D4=1 at entry — the plane arrives rotated-in, mid entry turn
    parallel: false, // a lone plane is a lead; leads are never in the drone formation phase
  }
}

// ─── the calc-frame weave (one step per 96 ms calc frame — findings §1) ────────

/**
 * One axis of the P.WINDW window-servo (RBARON.MAC:2755-2800), run identically on Y then X —
 * PLNDEL enters `2$: LDX I,2` for Y, then `P.WITR: DEX/DEX` drops to X=0 and re-runs it. Three
 * zones on |pos| per GMLEVL (`pos` measured relative to the biased centre):
 *
 *   • |rel| >= olim (P.OLIM "RETURN TO CENTER LIMIT", :2939) → reverse TOWARD centre (:2781)
 *   • ilim <= |rel| < olim (P.ILIM, :2945)                  → coast, no direction change (:2790)
 *   • |rel| < ilim  → `EOR I,0FF ;REVERSE FLAG (HEAD AWAY FROM CENTER)` reverse AWAY (:2794-2796)
 *
 * The velocity accelerates by ACCEL toward the zone heading (capped by WEAVE_SPEED_CAP) and the
 * position integrates, clamped to the outer window. There is no per-axis bias: both entries run
 * on DISPLAY coordinates (the Y entry's `SBC I,HORIZN` is what puts it there, and our `y` is
 * already in that space — see HORIZN above), so one unbiased servo serves both, exactly as the
 * ROM re-enters this one block for each axis. The inner reversal is why a plane turns AWAY as it
 * nears centre and never drifts through to the far wall.
 */
function windowServo(pos: number, vel: number, olim: number, ilim: number): { pos: number; vel: number } {
  const a = Math.abs(pos)
  let heading: number
  if (a >= olim) heading = pos > 0 ? -1 : 1 // outer wall → back toward centre
  else if (a < ilim) heading = pos >= 0 ? 1 : -1 // inner window → HEAD AWAY from centre
  else heading = vel >= 0 ? 1 : -1 // middle band → coast in the current direction
  const cap = weaveSpeedCap(ilim)
  const newVel = clamp(vel + ACCEL * heading, -cap, cap)
  return { pos: clamp(pos + newVel, -olim, olim), vel: newVel }
}

/**
 * Advance the weaving window-follower one calculation frame. Runs the window/servo machine on
 * BOTH axes (Y first, then X — the ROM's own order), reversing at the INNER window (away from
 * centre) and the OUTER window (toward centre), banks ∝ ΔX via the shared `biplaneBank` after the
 * ±90° entry flourish rolls out, and bores the depth in. A plane that closes past P.MNDP is
 * DESTROYED as an object (active → false) — the depth is never floored. Pure — returns a fresh
 * state.
 */
export function step(enemy: Enemy, level = 0): Enemy {
  // A destroyed plane stays destroyed (idempotent — main.ts steps the whole wave with map()).
  if (!enemy.active) return enemy

  const lvl = levelIndex(level)
  const olim = P_OLIM[lvl]
  const ilim = P_ILIM[lvl]

  // BOTH AXES: PLNDEL runs the machine on Y first (`2$: LDX I,2`, :2747), then P.WITR's `DEX/DEX`
  // drops to X=0 and re-enters the SAME block (:2865-2873). One servo, called twice — no bias on
  // either axis, because our x and y are both already the ROM's display coordinates (see HORIZN).
  const sy = windowServo(enemy.y, enemy.deltaY ?? 0, olim, ilim)
  const sx = windowServo(enemy.x, enemy.deltaX, olim, ilim)

  // The ROM's own approach rate: PLNZD indexes PLPOSZ by GMLEVL and stores it as "PLANE MOTION
  // DEPTH DELTA" (RBARON.MAC:2409-2411); UPDPLN ADDS it (negative) so the depth falls (:2704-2707).
  // `BPL PLNDEL ;NOT YET` (:2722) keeps the plane WEAVING while depth >= P.MNDP — so its LAST
  // active frame sits AT the floor (the closing delta can't carry it below while still weaving).
  // The NEXT frame it bores THROUGH — DESTROYED as an object (`STA PLSTAT+6 ;CLR PLANE`, :2741):
  // active → false, depth NOT floored (it keeps closing past), and stepWave drops it. This one
  // clean frame at the floor is also the P.UPD0 trigger main.ts arms the returning attack on.
  const closed = enemy.depth + closeSpeed(level)
  // (lower-case "past" on purpose: depth-scale.test.ts sweeps ALL-CAPS tokens on any line
  // mentioning depth, and reads a shouted PAST in a trailing comment as an unregistered constant.)
  const flyingPast = enemy.depth <= P_MNDP // already touched the floor last frame → now flies past
  const depth = flyingPast ? closed : Math.max(closed, P_MNDP)
  const active = !flyingPast

  // BANK: the ±90° entry flourish ROLLS OUT toward the weave over ENTRY_RAMP_FRAMES
  // (RBARON.MAC:2620-2652) — it does not snap on frame 1. It settles the instant ΔX reverses
  // through 0 (biplaneBank(0) = 0 — 0 is a real turn-rate, not a falsy fallback) or when the
  // ramp elapses; thereafter bank IS biplaneBank(ΔX), one coupling shared with the player horizon.
  const weaveBank = biplaneBank(sx.vel)
  const rem = enemy.entryFrames ?? 0
  let bank: number
  let entryFrames: number
  if (rem > 0 && sx.vel !== 0) {
    entryFrames = rem - 1
    const progress = (ENTRY_RAMP_FRAMES - entryFrames) / ENTRY_RAMP_FRAMES
    const mag = SPAWN_BANK + (Math.abs(weaveBank) - SPAWN_BANK) * progress
    bank = (Math.sign(enemy.bank) || 1) * mag
  } else {
    entryFrames = 0
    bank = weaveBank
  }

  return {
    ...enemy,
    x: sx.pos,
    deltaX: sx.vel,
    y: sy.pos,
    deltaY: sy.vel,
    bank,
    entryFrames,
    depth,
    active,
    // D4 clears once the entry rotation completes ("`AND I,0EF` — ;D4=0 (PLANE FACING AWAY)",
    // RBARON.MAC:2645-2652). The weave never re-rotates it toward the viewer — that is the ace
    // pass's business — so the bit holds facing-away for the whole flight (rb4-13).
    facingAway: true,
  }
}

// ─── DISCHK proximity wiring (live nearest-enemy depth → band, findings §2) ────

/**
 * Map an enemy depth to its DISCHK proximity band — the seam that sharpens the
 * player's control feel as the enemy closes (near ×1.0 / mid ×0.625 / far ×0.375,
 * scaled in flight.ts). Total over every input: a degenerate depth (NaN, ±Infinity)
 * falls through to the slow 'far' band rather than crashing.
 */
export function proximityBand(depth: number): ProximityBand {
  if (depth < NEAR_DEPTH) return 'near'
  if (depth < MID_DEPTH) return 'mid'
  return 'far'
}

// ─── PLNLVL level-gated firing (findings §3, PLNSHL/NWPLNE) ────────────────────

/**
 * The PLNLVL fire GRANT for a GMLEVL — the fraction of planes allowed to shoot the
 * player (findings §3, NWPLNE:2345-2355): level < 4 never (0), level 4 a 50 % coin
 * flip (0.5), level ≥ 5 always (1). The early sky (level < 4) never shoots back.
 * Total — a non-finite / negative level fails safe to "never fire".
 */
export function planeFireChance(level: number): number {
  if (!Number.isFinite(level)) return 0
  const lvl = Math.floor(level)
  if (lvl < 4) return 0
  if (lvl === 4) return 0.5
  return 1
}

/**
 * Does a plane fire THIS calc-frame? Combines the PLNLVL level grant with the ÷2 FRAME
 * cadence (PLNSHL:4798-4807 — a plane fires at most every OTHER calc-frame, gated by the
 * FRAME LSB) and, at level 4, a supplied `roll` in [0,1) for the 50 % coin flip. Pure —
 * the caller draws `roll` (e.g. nextFloat of the seeded Rng), so the decision is
 * deterministic. NOTE: which frame parity fires is inferred (the ROM pins the ÷2, not
 * the phase); we fire on even FRAME.
 */
export function planeFires(level: number, frame: number, roll: number): boolean {
  const chance = planeFireChance(level)
  if (chance === 0) return false
  if ((Math.floor(frame) & 1) !== 0) return false // ÷2 FRAME cadence — hold fire on odd frames
  return chance === 1 || roll < 0.5 // always-fire, or win the level-4 coin flip
}

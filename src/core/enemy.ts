// src/core/enemy.ts
//
// The single enemy biplane: its weaving window-follower dogfight AI, the seeded
// side-entry spawn, and the DISCHK proximity mapping that feeds the player's
// control feel. Story rb2-4 — the lone-plane case (the 25 % RANDOM roll); the
// drone formations and score-scaled counts are rb2-7.
//
// STEERING is a WEAVING WINDOW-FOLLOWER, NOT a beeline seeker (findings §3,
// UPDPLN/PLNDEL/P.WINDW, RBARON.MAC:2570/2743/2806): the plane accelerates its ΔX
// (by ACCEL=0x30) toward a per-zone TARGET delta and reverses at the window
// boundaries — AWAY from centre at the inner one. It follows the WINDOW, not the
// player — a stationary target is never chased to a standstill. Limits and targets
// are GMLEVL-indexed (P.OLIM/P.ILIM :2939/:2945; P.ODLX/P.IDLX/P.IIDL :2948-2956) —
// higher level = wider, faster, more aggressive weave.
//
// COORDINATE SPACE (rb4-6 round 2 — read this before touching x/y). A plane's stored
// position is WORLD (the ROM's PLSTAT+0..+3; the block layout at :266-297 names +0/+2
// "PLANE POSITION" and +8/+A "DISPLAY POSITION" as separate fields). Where it is ON
// SCREEN — and therefore where the gun can hit it and where the cockpit must draw it —
// is `displayPos(enemy, eye)`: the world position MINUS the pilot's own (:2909-2913).
// Round 1 conflated the two, which is how it shipped a servo that wove planes out of a
// gun window the stick could not move: the game soft-locked after five kills with all
// 1051 tests green. If you are about to write `enemy.x` into anything the player sees
// or shoots, you want `displayPos`.
//
// SPAWN (findings §3, NWPLNE/STPLNE, RBARON.MAC:2241/2274): enters from a screen
// SIDE banked 90°, random X, at depth P.INDP=0x1080, and at STPLNE's random ALTITUDE
// (:2310-2316) — an absolute Y in the ROM's own plane-altitude band, not an offset from
// the boresight. This story ships the LONE plane; `spawn` returns ONE enemy and consumes
// the injected seeded Rng for its random placement (the arcade-shared PRNG, same pattern
// as asteroids' spawnRock).
//
// BANK ∝ turn-rate reuses flight.ts's `biplaneBank` (PFROTN = ΔX×8, clamped ±0x100
// → ±45°) so the enemy and the player horizon share ONE coupling with no
// duplicated ROLL_SCALE (story context, findings §2). The 90° spawn bank is an
// entry flourish the plane rolls out of as it settles into the weave.
//
// PURE and deterministic. No DOM, no time, no ambient randomness — the ONLY source
// of randomness is the seeded Rng handed to `spawn`.

import { type Rng, nextFloat } from '@arcade/shared/rng'
import type { Vec3 } from '@arcade/shared/math3d'
import { biplaneBank } from './biplane'
import { ALT_TO_Y, type ProximityBand } from './flight'
import { HORIZN, PFPLOW, PFPHI } from './topology'
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

// ─── the per-zone TARGET DELTAS (P.WCHK, RBARON.MAC:2948-2956) ────────────────
//
// THE THREE TABLES ROUND 1 SAID COULD NOT BE READ. Its descope claimed the `.2WORD`/`.3WORD`
// macros carried "an unverified ×2/×3 scale with NO baked artifact to arbitrate", and shipped an
// invented `sqrt(ACCEL·ilim)` in their place — a fabricated constant substituted for available ROM
// data, which inverts this epic's entire purpose while wearing its vocabulary. The arbiter is
// twenty lines from the top of the same file:
//
//     20:  .MACRO .3WORD .A,.B,.C,.D
//     21:  .WORD  3*.A,3*.B,3*.C,3*.D
//     25:  .MACRO .2WORD .A,.B,.C,.D
//     26:  .WORD  2*.A,2*.B,2*.C,2*.D
//
// and it is corroborated independently: each macro takes only FOUR arguments, so the author wrote
// every table's fifth entry longhand with the multiplier spelled out — `.WORD 80*2` (:2949),
// `2C*3` (:2953), `40*3` (:2956). Same scale, twice, in two notations. The operands are bare, so
// `.RADIX 16` (:74) makes them HEX: a decimal reading of `.3WORD …,28` gives 84 where the ROM
// assembles 120.
//
// HOW THE ZONE PICKS ITS TABLE. The three are CONTIGUOUS and indexed by zone×GMLEVL. P.WINDW loads
// SAVY = GMLEVL*2 (:2760-2761) and adds a table base: outer falls straight through to P.WCHK with
// Y = SAVY (:2782) → P.ODLX; middle loads `.LEVLS*2` (:2791) → P.IDLX; inner loads `.LEVLS*4`
// (:2797, right after `EOR I,0FF`) → P.IIDL. With `.LEVLS = 5` (:504) those offsets land exactly
// one and two five-word tables along. P.WCHK (:2806-2864) then servos the CURRENT delta TOWARD the
// one it picked — "CURRENT DELTA=MAX DELTA" → hold (:2826), else "ACCELERATE SO DELTA=MAX" by
// ±ACCEL (:2832, :2843-2846), else snap exactly onto it (:2834-2840). A per-zone TARGET, not one
// symmetric speed cap.

/** P.ODLX — OUTER target deltas, `.2WORD 90,8C,84,7C` + `.WORD 80*2` (RBARON.MAC:2948-2949). */
export const P_ODLX: readonly number[] = Object.freeze([0x90 * 2, 0x8c * 2, 0x84 * 2, 0x7c * 2, 0x80 * 2])

/** P.IDLX — MIDDLE target deltas, `.3WORD 8,14,1C,24` + `.WORD 2C*3` (RBARON.MAC:2952-2953). */
export const P_IDLX: readonly number[] = Object.freeze([8 * 3, 0x14 * 3, 0x1c * 3, 0x24 * 3, 0x2c * 3])

/**
 * P.IIDL — INNER target deltas, `.3WORD 0,10,18,28` + `.WORD 40*3` (RBARON.MAC:2955-2956).
 * P_IIDL[0] = 0 is a REAL target — at GMLEVL 0 the inner zone really is a dead stop, and a `||`
 * default would silently promote it to level 1's 48.
 */
export const P_IIDL: readonly number[] = Object.freeze([0 * 3, 0x10 * 3, 0x18 * 3, 0x28 * 3, 0x40 * 3])

/**
 * HORIZN — the horizon's offset along the ROM's Y axis (RBARON.MAC:456 "HORIZON OFFSET (Y AXIS)",
 * .RADIX 16). RE-EXPORTED, not re-declared: topology.ts owns this equate and scene.ts:49 wires it
 * into the projection as HORIZN_NDC. Round 1 declared a second `export const HORIZN = 0x40` here —
 * one identifier, two homes, the exact fragility P_MNDP's comment below says this epic exists to
 * kill. They agreed at 0x40, which is precisely why a value comparison could never have caught it.
 *
 * WHERE IT LANDS IN THE CONVERSION (the round-2 question the Reviewer told us to re-derive rather
 * than assume). HORIZN is a SCREEN offset applied AFTER the perspective divide, and it stays in
 * the projection — it is not the enemy servo's business:
 *
 *     Y (X-reg = 2):  `LDA ZX,PLSTAT+8` → PLSTAT+10, then `SBC I,HORIZN`   (:2749-2752)
 *     X (X-reg = 0):  `LDA ZX,PLSTAT+8` → PLSTAT+8   ";X DISPLAY"           (P.WITR, :2867)
 *
 * Both entries read the DISPLAY position (PLSTAT+8..+B, ";X SCREEN POSITION" :3157 — the block
 * layout at :278-281 names it "DISPLAY POSITION"). The X axis is loaded raw; the Y axis is loaded
 * MINUS HORIZN for one reason: POSITH added HORIZN to it on the way out of the divide
 * (`ADC I,HORIZN`, RBGRND.MAC:303), so removing it puts Y back in the same horizon-relative space
 * X already occupies. It NORMALIZES — it does not displace. Round 1's ruling on that stands.
 *
 * What changed in round 2 is the space our `x`/`y` live in, not HORIZN's meaning: they are now the
 * ROM's WORLD position (PLSTAT+0..+3), and the screen position is derived per frame by `displayPos`
 * below. Our display Y is horizon-relative BY CONSTRUCTION — the eye sits on the horizon in level
 * flight — so there is still no HORIZN term in this module's arithmetic, and scene.ts remains the
 * one place that adds it.
 */
export { HORIZN }

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
 * DELTA_SCALE — the delta is a QUARTER-UNIT of position per calc frame. This is the number that
 * makes P.ODLX/P.IDLX/P.IIDL mean anything, and reading the tables without it is what made round 1
 * disbelieve them: a "288 units/frame" delta inside GMLEVL 0's ±0x40 = 64 window is absurd on its
 * face, and the absurdity was taken as evidence the macro scale must be wrong. It is not — the
 * scale is one `JSR` away, in the routine that CONSUMES the delta.
 *
 * UPDPLN (:2570-2581) integrates the delta into the plane's WORLD position through DIVBY4:
 *
 *     2570  UPDPLN: LDA PLSTAT+0C      ; delta X LSB
 *     2571          STA TEMP2
 *     2572          LDA PLSTAT+0D      ; delta X MSB
 *     2573          JSR DIVBY4         ; (A:TEMP2) = delta / 4
 *     2577          ADC PLSTAT         ; UPDATE X POSITION  += delta/4
 *     2582-2593     …the same, PLSTAT+0E/+0F into PLSTAT+2 (Y)
 *
 * and DIVBY4 (:6170-6176) is a SIGNED 16-bit shift right by two — `CMP I,80` seeds the carry from
 * the sign bit, then `ROR / ROR TEMP2` twice, so the sign extends and the MSB's low bits carry down
 * into the LSB. A true arithmetic ÷4 on the pair, not a byte-wise one.
 *
 * So the tables are in quarter-units: P.ODLX[0] = 288 is a 72-unit/frame outer dash, P.IDLX[0] = 24
 * a 6-unit/frame middle coast. Against a 64-unit window those are a hard run home and a gentle
 * drift — which is the engagement the arcade actually plays. ACCEL is in the SAME delta units
 * (P.WCHK adds it to PLSTAT+0C directly, :2860-2864), so it is 12 units/frame of position rate.
 *
 * The delta is ALSO the plane's rotation source at ×1 — "PLANE X/Y ROTATION=-4*DELTA X"
 * (:2629) — which is why `biplaneBank` reads the raw delta below and not the scaled position rate.
 */
const DELTA_SCALE = 4

/**
 * The plane's ALTITUDE BAND — the ROM's own clamp on where a plane may fly, and the reason every
 * GMLEVL is winnable. UPDPLN bounds the world Y it just integrated to [PFPLOW, PFPHI]
 * (:2595-2611), the equates at :448-449 (`PFPLOW =80*4 ;PLANE MIN ALTITUDE (ABOVE HORIZON)`,
 * `PFPHI =140*4 ;PLANE MAX ALTITUDE`). Those are I4YPOS units — the player's own altitude unit,
 * "PLAYER Y POSITION * 4" (:91) — so `ALT_TO_Y` carries them into eye/world Y exactly as it
 * carries the pilot's altitude, through the one mapping rather than a second copy of it.
 *
 * WHY IT IS LOAD-BEARING. The band works out to [128, 320], and the pilot's own eye rides
 * [ALT_MIN, ALT_MAX] × ALT_TO_Y = [8, 384] — so the plane's altitude is always somewhere the pilot
 * can climb or dive to. Without this clamp the Y servo drives |y| out to ±P_OLIM around the world
 * origin, and a plane that picked the negative side sits at y = −288 under an eye that cannot go
 * below +8: permanently, invisibly unshootable. That is round 1's soft-lock wearing different
 * clothes, and it is the ROM — not a tuned guard — that rules it out.
 */
const PLANE_ALT_MIN = PFPLOW * ALT_TO_Y // 128
const PLANE_ALT_MAX = PFPHI * ALT_TO_Y // 320

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

/**
 * STPLNE's random spawn ALTITUDE (RBARON.MAC:2310-2316) — the ROM's own bit-twiddle, transcribed
 * rather than approximated, because the band it produces is what puts the plane where the pilot
 * can see it:
 *
 *     2310  JSR RANDOM       ; r = a random byte
 *     2311  CLC
 *     2312  ADC I,80         ; lsb = (r + 0x80) & 0xFF, carry set iff r >= 0x80
 *     2313  STA PLSTAT+2
 *     2314  AND I,1          ; (AND does not touch the carry — it survives from :2312)
 *     2315  ADC I,1          ; msb = (lsb & 1) + 1 + carry
 *     2316  STA PLSTAT+3
 *
 * so the plane's world Y is a 16-bit I4YPOS value in [0x180, 0x37F], which UPDPLN's band then
 * clamps to [PFPLOW, PFPHI]. Note this is an ABSOLUTE altitude — unlike the X spawn, which the ROM
 * writes as a display offset plus UNIV4X (`ADC UNIV4X / STA PLSTAT`, :2291-2297) — and that
 * asymmetry is the whole point of the round-2 seam: it is why `enemy.y − eye[1]` IS the mapping
 * once `enemy.y` is the altitude the ROM actually stores, and why round 1's ±40 screen offset was
 * not. Against the pilot's spawn eye of 132, this band puts the plane just above the horizon.
 */
function spawnAltitude(rng: Rng): number {
  const r = Math.floor(nextFloat(rng) * 0x100) // JSR RANDOM — one byte
  const lsb = (r + 0x80) & 0xff
  const msb = (lsb & 1) + 1 + (r >= 0x80 ? 1 : 0)
  return clamp(msb * 0x100 + lsb, PFPLOW, PFPHI) * ALT_TO_Y
}

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
  /**
   * WORLD X (the ROM's PLSTAT+0/+1, ":268 PLANE POSITION X"). NOT a screen offset — `displayPos`
   * derives the screen position by subtracting the pilot's own UNIV4X. Weaves about the world
   * origin, bounded ±P_OLIM[level].
   */
  readonly x: number
  /**
   * WORLD Y (PLSTAT+2/+3) — the plane's ALTITUDE, in the same units `toEye` reports the pilot's.
   * Seeded by STPLNE's random altitude and held inside [PLANE_ALT_MIN, PLANE_ALT_MAX] by UPDPLN's
   * band, so it is always an altitude the pilot can fly to. Screen Y is `displayPos`'s job.
   */
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

// NaN-safe: Math.min/max PROPAGATE NaN, and a NaN that ever reaches x/y persists across every
// later frame (state is fed back through step). Unreachable from spawn today; the floor is the
// total answer for a degenerate hand-built fixture (rb4-6 R3 totality pin).
const clamp = (v: number, lo: number, hi: number): number => (Number.isNaN(v) ? lo : Math.max(lo, Math.min(hi, v)))

/** Clamp a GMLEVL to a valid table index (0 .. .LEVLS-1). */
const levelIndex = (level: number): number => clamp(Math.floor(level) || 0, 0, P_OLIM.length - 1)

// ─── the world → display seam (PLONSN, RBARON.MAC:2907-2933) ──────────────────

/**
 * Where a plane IS ON SCREEN, given where the pilot is: the plane's stored WORLD position minus
 * the pilot's own. This is the seam round 1 did not have, and not having it is what made the game
 * soft-lock after five kills — the servo wove the plane away from a boresight the pilot had no way
 * to move, because nothing in the clone connected the stick to the plane's position at all.
 *
 * The ROM computes it per frame, per axis, in PLONSN:
 *
 *     2906  LDX I,2                 ; run for X-reg = 2 (Y) …
 *     2909  LDA ZX,PLSTAT           ; PLANE POSITION      — WORLD
 *     2910  SBC ZX,UNIV4X           ; - UNIVERSE CENTER   — the pilot
 *     2916  JSR DPABS               ; ABSOLUTE OF POSITION ON SCREEN
 *     2934  DEX / DEX / BPL 10$     ; … then X-reg = 0 (X)
 *
 * and the two axes subtract different halves of one 4-byte block (:90-91): `UNIV4X` (the turn pan)
 * on X, `I4YPOS = UNIV4X+2 ;PLAYER Y POSITION * 4` (the altitude) on Y. `toEye` already returns
 * exactly that pair, so the eye has ONE source and this function does not re-derive a second pan.
 *
 * Turning slides a plane across the screen; climbing slides it up and down it. That is how the
 * pilot aims: the plane weaves away from the boresight and you fly it back into the sights.
 *
 * `eye[2]` is unused — depth is not panned, exactly as the ROM's (X − UNIV4X) over an untouched Z.
 */
export function displayPos(enemy: Enemy, eye: Vec3): { x: number; y: number } {
  return { x: enemy.x - eye[0], y: enemy.y - eye[1] }
}

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
  const y = spawnAltitude(rng) // STPLNE's absolute altitude, not an eye-relative offset
  return {
    kind: 'lead', // the lone plane is a lead; drones are fielded by waves.ts's spawnWave
    x: side * mag,
    y,
    depth: P_INDP,
    deltaX: 0,
    deltaY: 0, // the Y window machine starts from rest — and UNBIASED (user ruling; see HORIZN above)
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
 * zones on |pos| per GMLEVL, each with its OWN target delta:
 *
 *   • |pos| >= olim (P.OLIM "RETURN TO CENTER LIMIT", :2939) → head TOWARD centre, at P.ODLX
 *   • ilim <= |pos| < olim (P.ILIM, :2945) → coast, "NO DIRECTION CHANGES" (:2790), at P.IDLX
 *   • |pos| < ilim → `EOR I,0FF ;REVERSE FLAG (HEAD AWAY FROM CENTER)` (:2794-2796), at P.IIDL
 *
 * P.WCHK (:2806-2864) servos the delta toward that zone's target rather than clamping it to one
 * symmetric cap: equal → hold (:2826); |Δ − target| > ACCEL → step by ±ACCEL, "ACCELERATE SO
 * DELTA=MAX" (:2832, :2843-2846); otherwise snap exactly onto it (:2834-2840). The position then
 * integrates delta/DELTA_SCALE, which is UPDPLN's `JSR DIVBY4` (:2573) — see DELTA_SCALE above.
 *
 * The ±olim position clamp is OURS, not the ROM's (P.WINDW only ever writes the delta; the ROM
 * bounds the plane elsewhere — on Y by UPDPLN's altitude band, on screen by PLONSN's depth-scaled
 * window, :2877-2937). It stands in for PLONSN, which we do not model, and it is what keeps a
 * GMLEVL-0 plane provably inside GMLEVL 0's narrow window.
 *
 * One servo, no per-axis bias: both ROM entries read the DISPLAY position (:2749, :2867) and the
 * Y entry's `SBC I,HORIZN` only normalizes into the space X is already in — see HORIZN above.
 *
 * NOTE (deliberate simplification, behaviour-equivalent). The ROM carries the direction decision in
 * a sign FLAG (`FLAG+1` = sign(Δ) EOR sign(pos), EOR'd per zone, :2762-2797) and its reverse branch
 * (`40$`, :2851-2854) steps by ±ACCEL WITHOUT the snap the non-reversing path has. Expressing both
 * as "step the signed delta toward heading×target, snapping within ACCEL" reproduces every zone's
 * behaviour and differs only in reaching a reversed target one frame sooner in the rare case where
 * target + |Δ| ≤ ACCEL. The ROM converges to the same delta on the following frame.
 */
function windowServo(
  pos: number,
  vel: number,
  olim: number,
  ilim: number,
  odlx: number,
  idlx: number,
  iidl: number,
): { pos: number; vel: number } {
  const a = Math.abs(pos)
  let heading: number
  let target: number
  if (a >= olim) {
    heading = pos > 0 ? -1 : 1 // outer wall → back toward centre
    target = odlx
  } else if (a < ilim) {
    heading = pos >= 0 ? 1 : -1 // inner window → HEAD AWAY from centre
    target = iidl
  } else {
    heading = vel >= 0 ? 1 : -1 // middle band → coast in the current direction
    target = idlx
  }
  // P.WCHK: accelerate the delta toward this zone's target, snapping once within one ACCEL step.
  const want = heading * target
  const diff = want - vel
  const newVel = Math.abs(diff) <= ACCEL ? want : vel + ACCEL * Math.sign(diff)
  // UPDPLN: the position takes delta/4 (DIVBY4), never the raw delta.
  return { pos: clamp(pos + newVel / DELTA_SCALE, -olim, olim), vel: newVel }
}

/**
 * Advance the weaving window-follower one calculation frame. Runs the window/servo machine on
 * BOTH axes (Y first, then X — the ROM's own order), reversing at the INNER window (away from
 * centre) and the OUTER window (toward centre), banks ∝ ΔX via the shared `biplaneBank` after the
 * ±90° entry flourish rolls out, and bores the depth in. A plane that closes past P.MNDP is
 * DESTROYED as an object (active → false). Pure — returns a fresh state.
 *
 * DEPTH FLOOR — one frame, and it is a deviation, not a transcription. The plane's LAST active
 * frame sits exactly AT P.MNDP (`Math.max(closed, P_MNDP)` below) and it is destroyed on the
 * NEXT one. The ROM destroys it in the SAME frame, off the raw sub-floor depth (:2704-2742); our
 * one-frame lag exists to give main.ts a clean P.UPD0 trigger frame to arm the returning attack
 * on. Round 1's docstring claimed here that "the depth is never floored" directly above the
 * `Math.max` that floors it — an inferred timing choice asserted with the same confidence as the
 * byte-pinned claims around it. It is inferred. The depth does bore THROUGH on the fly-past frame.
 */
export function step(enemy: Enemy, level = 0): Enemy {
  // A destroyed plane stays destroyed (idempotent — main.ts steps the whole wave with map()).
  if (!enemy.active) return enemy

  const lvl = levelIndex(level)
  const olim = P_OLIM[lvl]
  const ilim = P_ILIM[lvl]

  // BOTH AXES: PLNDEL runs the machine on Y first (`2$: LDX I,2`, :2747), then P.WITR's `DEX/DEX`
  // drops to X=0 and re-enters the SAME block (:2865-2873). One servo, called twice.
  const sy = windowServo(enemy.y, enemy.deltaY ?? 0, olim, ilim, P_ODLX[lvl], P_IDLX[lvl], P_IIDL[lvl])
  const sx = windowServo(enemy.x, enemy.deltaX, olim, ilim, P_ODLX[lvl], P_IDLX[lvl], P_IIDL[lvl])
  // …and Y alone then takes UPDPLN's altitude clamp (:2595-2611). The asymmetry is the ROM's own:
  // UPDPLN bounds the Y it integrates to [PFPLOW, PFPHI] and leaves X unbounded. See PLANE_ALT_MIN.
  const y = clamp(sy.pos, PLANE_ALT_MIN, PLANE_ALT_MAX)

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
  // (RBARON.MAC:2620-2652) — it does not snap on frame 1. Thereafter bank IS biplaneBank(ΔX),
  // one coupling shared with the player horizon.
  //
  // rb4-6 round 2: the ramp is a plain COUNTDOWN. Round 1 also required `sx.vel !== 0`, on the
  // reasoning that the entry "settles the instant ΔX reverses through 0" — an invention, and one
  // the ROM tables then falsified: UPDMOB ramps PLSTAT+14/15 toward zero by a fixed ±0x40 per
  // frame (:2634-2648) and clears D4 when the ROTATION reaches zero, never consulting the delta.
  // The two are genuinely independent, and coupling them broke AC-4: P.IIDL[0] = 0 means a GMLEVL-0
  // plane legitimately DEAD-STOPS inside the inner window, which round 1's condition read as "the
  // entry ramp has finished" — so `stepWave` fired FREPAR and the drones left formation on frame 4.
  const weaveBank = biplaneBank(sx.vel)
  const rem = enemy.entryFrames ?? 0
  let bank: number
  let entryFrames: number
  if (rem > 0) {
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
    y,
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

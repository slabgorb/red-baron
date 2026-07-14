// src/core/flight.ts
//
// The authentic Red Baron FLIGHT MODEL — the pot-yoke dynamics that DRIVE the
// rb1 flightView camera (findings §2, "Player flight model"). rb1 built the
// camera (camera.ts) and the tilting horizon (horizon.ts); this module supplies
// the dynamics that PRODUCE the attitude they render.
//
// Two analog pots (a flight yoke) + fire — NO THROTTLE. Forward motion is
// implicit and constant; the pilot commands only TURN and PITCH (R2BRON.MAC:520,
// findings §2). The player is the universe centre and the world moves around it.
//
//   * TURN / ROLL → PLDELX, a RATE WITH INERTIA. The yoke sets a TARGET turn-rate
//     the plane ramps into (step-limited acceleration + 2 counts of hysteresis) —
//     not an instant heading (POT.X, R2BRON.MAC:5890-5919).
//   * PITCH → PLDELY, 11 DISCRETE STEPS. POTSCL maps the pitch pot to an index
//     into POTDLY (R2BRON.MAC:5923). Centre = 0; ASYMMETRIC — dive (-32) is
//     faster than climb (+25).
//   * PFMOTN "update centre of screen" (R2BRON.MAC:3149-3262): PLDELX (×DISCHK)
//     pans the world horizontally (heading → yaw); PFROTN = PLDELX × 8, clamped
//     |·| ≤ 0x100, is the horizon-bank roll; PLDELY (×DISCHK) adds to altitude
//     I4YPOS, hard-clamped PLYMIN..PLYMAX (you cannot pitch into the ground in a
//     dogfight — terrain only bites in the rb3 ground wave).
//   * DISCHK (R2BRON.MAC:3463-3491): player deltas scale by the proximity of the
//     nearest object — close ×1.0 / mid ×0.625 / far ×0.375. Apparent agility
//     rises when something is near. rb2-1 has no enemies yet, so the band is an
//     INPUT the caller supplies.
//
// SCALE NOTE (findings §2, PFROTN bit format `XXX XQQA AAAA AA.FF` = quadrant +
// angle + fraction): the ROM angle → radian scale and the per-frame acceleration
// step are not pinned to a byte by the source, so they are chosen here within the
// tested invariants — a full-deflection settled turn saturates the 0x100 bank
// clamp, and the turn ramps rather than snapping. A quadrant is 0x200, so the
// 0x100 bank clamp is a 45° maximum bank (ROLL_SCALE = π/1024).
//
// PURE and deterministic. No DOM, no time, no randomness.

import type { Vec3 } from '@arcade/shared/math3d'
import type { Attitude } from './camera'

// ─── ROM-exact data (findings §2, §5) ───────────────────────────────────────

/**
 * POTDLY — the 11-step pitch table PLDELY, index 0..10 (RBARON.MAC:5930). Declared
 * `.4WORD -32.,-23.,-17.,-10.,-5,0,4,8,13.,18.,25.`; the `.4WORD` macro
 * (RBARON.MAC:15-18) MULTIPLIES EVERY OPERAND BY 4, so the shipped table is the ×4
 * expansion — NOT the raw operand list our clone first transcribed (rb4-5 FL-001).
 */
export const PITCH_TABLE: readonly number[] = Object.freeze([
  -128, -92, -68, -40, -20, 0, 16, 32, 52, 72, 100,
])

/** PFROTN magnitude clamp: |PLDELX × 8| ≤ 0x100. */
export const BANK_LIMIT = 0x100

/** I4YPOS altitude floor PLYMIN = $8·4 (RBARON.MAC:445-455, `.RADIX 16` — HEX). */
export const ALT_MIN = 0x8 * 4 // 32 (0x8 = 8, so decimal read was coincidentally right)
/** I4YPOS altitude ceiling PLYMAX = $180·4 (same hex equate block; sibling PFPLOW = $80·4 in topology.ts). */
export const ALT_MAX = 0x180 * 4 // 1536

/** POT.X hysteresis: turnRate ignores commanded changes within 2 counts. */
export const TURN_HYSTERESIS = 2

/** DISCHK band of the nearest object (findings §2). */
export type ProximityBand = 'near' | 'mid' | 'far'

/**
 * DISCHK proximity scale factors (RBARON.MAC:3468-3496 + the band flags at :3189,
 * `D7=CLOSE, D6=MIDDLE, D5=FAR`). rb4-5 AC3: our bands were INVERTED. The ROM scales
 * the player's deltas by CLOSE ×0.375 (BMI → "0.375 * VALUE"), MIDDLE ×0.625 (BVS →
 * "0.625 * VALUE"), FAR ×1.0 (fall-through → "1.0 * VALUE"). Control goes SLUGGISH
 * when something is near, full when the sky is clear — the opposite of "sharper near".
 */
export const DISCHK: Readonly<Record<ProximityBand, number>> = Object.freeze({
  near: 0.375,
  mid: 0.625,
  far: 1.0,
})

// ─── forced-slow control band (rb3-2, findings §2) ───────────────────────────

/**
 * The DISCHK band ground mode forces the controls to — the fixed MIDDLE feel (×0.625),
 * regardless of the nearest object's distance. PFMOTN `BIT GRMODE / BPL / LDA I,40`
 * (RBARON.MAC:3186-3188) loads TEMP3 = 0x40 = D6 = MIDDLE (rb4-5 AC3). Not the slowest
 * band — 'far' is now the FASTEST (×1.0) and 'near' the slowest (×0.375).
 */
export const GROUND_CONTROL_BAND: ProximityBand = 'mid'

/**
 * DISCHK band selector for the pilot's FlightInput: in ground mode the controls are pinned
 * to the slow band (GROUND_CONTROL_BAND) regardless of the nearest object; otherwise the
 * live nearest-object band passes through unchanged (findings §2). Reuses the existing
 * ProximityBand plumbing — no new control path.
 */
export function controlBand(groundMode: boolean, liveBand: ProximityBand): ProximityBand {
  return groundMode ? GROUND_CONTROL_BAND : liveBand
}

// ─── tuning within the tested invariants (see SCALE NOTE) ────────────────────

/**
 * Full-deflection commanded PLDELX — the pot's turn-rate RANGE at full yoke, not a
 * cap on where PLDELX may sit (rb4-5 AC4 retires the invented MAX_TURN=40 cap). Kept
 * at 40 so a full hard turn settles ≥ 0x1C=28 "hard turn" (findings §5) and ×8
 * saturates the 0x100 bank clamp. POT.X steps toward it PROPORTIONALLY, not by a ramp.
 */
const POT_RANGE = 40
/** POT.X per-frame step bound: the shift result is limited to [-16, +15] (RBARON.MAC:5911-5916). */
const TURN_STEP_MIN = -16
const TURN_STEP_MAX = 15
/** PFROTN bank → radians: 0x200 = a 90° quadrant, so 0x100 = 45° (π/1024 per count). */
const ROLL_SCALE = Math.PI / 1024
/** Accumulated heading (UNIV4X world pan) → the eye's lateral world-X offset. The ROM
 *  accumulates the scaled PLDELX straight into UNIV4X and draws objects at (X − UNIV4X),
 *  so the pan IS the eye's X — a 1:1 world-unit translation (rb4-5 AC1). */
const PAN_SCALE = 1
/** I4YPOS (eye Y ×4, findings §2) → world eye height. Exported so the horizon uses the
 *  SAME altitude→eye mapping as the world objects (they must rise/fall together). */
export const ALT_TO_Y = 1 / 4

// ─── state & input ───────────────────────────────────────────────────────────

/** One calc-frame of pilot input — two pots + the DISCHK band. No throttle. */
export interface FlightInput {
  /** Yoke X ∈ [-1, 1]: the commanded TARGET turn-rate (PLDELX). */
  readonly turn: number
  /** Yoke Y ∈ [-1, 1]: mapped through POTSCL to a PLDELY step. */
  readonly pitch: number
  /** DISCHK band of the nearest object. */
  readonly proximity: ProximityBand
}

/** The player's flight state — ROM-unit accumulators (findings §2). */
export interface FlightState {
  /** PLDELX — turn rate, eased toward the yoke with inertia + hysteresis. */
  readonly turnRate: number
  /** PLDELY — this frame's climb/dive step (transient; 0 = level). */
  readonly pitchRate: number
  /** I4YPOS — eye altitude, hard-clamped [ALT_MIN, ALT_MAX]. */
  readonly altitude: number
  /** Accumulated turn pan (UNIV4X) → the camera's yaw. */
  readonly heading: number
}

/** Straight, level flight at the ROM spawn altitude I4YPOS = 0x0210 (findings §5). */
export const INITIAL_FLIGHT: FlightState = Object.freeze({
  turnRate: 0,
  pitchRate: 0,
  altitude: 0x0210,
  heading: 0,
})

// ─── pure ROM helpers ─────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/**
 * POTSCL — map the pitch pot [-1, 1] to a discrete PLDELY step (findings §2).
 * Centre (0) → 0; full nose-up (+1) → +25; full nose-down (-1) → -32; out-of-range
 * pots clamp to the table ends. The result is always a table value (no interpolation).
 */
export function pitchDelta(pitchPot: number): number {
  const index = clamp(Math.round((pitchPot + 1) * 5), 0, PITCH_TABLE.length - 1)
  return PITCH_TABLE[index]
}

/**
 * PFROTN — the horizon-bank angle from the turn rate: PLDELX × 8, sign preserved,
 * hard-clamped to ±0x100 so a hard bank cannot over-rotate the horizon (findings §2).
 */
export function pfrotn(turnRate: number): number {
  return clamp(turnRate * 8, -BANK_LIMIT, BANK_LIMIT)
}

/**
 * POT.X (RBARON.MAC:5897-5926) — ease PLDELX toward its target PROPORTIONALLY. The
 * error (target − current) inside the 2-count deadband (|diff| < 3) is left alone;
 * otherwise the step is the error ARITHMETICALLY shifted right by 3 (`LSR LSR LSR` +
 * `ORA 0E0` sign-extend), bounded to [-16, +15], with a ±1 floor (the `20$` branch)
 * so a small non-zero error still creeps PLDELX in. No constant ramp, no MAX_TURN cap.
 */
function easeTurnRate(current: number, target: number): number {
  const diff = target - current
  if (Math.abs(diff) < TURN_HYSTERESIS + 1) return current // deadband: |diff| < 3 → leave alone
  let step = diff >> 3 // arithmetic shift right by 3 (JS >> is arithmetic)
  if (step === 0) step = Math.sign(diff) // 20$ floor: a non-zero error steps by ±1
  return current + clamp(step, TURN_STEP_MIN, TURN_STEP_MAX)
}

// ─── the calc-frame sim (one step per 96 ms calc frame — timing.ts) ───────────

/**
 * Advance the flight model one calculation frame (findings §1 cadence). Pure:
 * returns a fresh state, never mutates the input. PLDELX eases toward the yoke;
 * PLDELY is this frame's pitch step; both (×DISCHK) drive the world — turn pans
 * the heading, pitch moves the altitude (clamped).
 */
export function step(state: FlightState, input: FlightInput): FlightState {
  const scale = DISCHK[input.proximity]
  // `turn` is the normalized yoke ∈ [-1, 1]; clamp out-of-range just as POTSCL
  // clamps the pitch pot, so a bad caller can't over-drive PLDELX past a full turn.
  // The target is the pot deflection in ROM turn-rate units (integer, for the >>3 step).
  const turnRate = easeTurnRate(state.turnRate, Math.round(clamp(input.turn, -1, 1) * POT_RANGE))
  const pitchRate = pitchDelta(input.pitch)
  return {
    turnRate,
    pitchRate,
    heading: state.heading + turnRate * scale,
    altitude: clamp(state.altitude + pitchRate * scale, ALT_MIN, ALT_MAX),
  }
}

// ─── the camera bridge — this is what "drives the rb1 flightView camera" ──────

/**
 * Project ROM-unit flight state onto the camera attitude (radians). rb4-5: the ONLY
 * rotation is the bank — the horizon banks with the clamped PFROTN roll. There is NO
 * camera pitch and NO camera yaw; climb/dive and turning move the EYE (see toEye),
 * they never rotate the camera (findings §2, RBARON.MAC:3196-3262).
 */
export function toAttitude(state: FlightState): Attitude {
  return { roll: pfrotn(state.turnRate) * ROLL_SCALE }
}

/**
 * The pilot's eye position for flightView (rb4-5 AC1). The world is TRANSLATED about a
 * fixed eye: the accumulated heading is the UNIV4X world pan (eye X), and the altitude
 * is the I4YPOS eye height (eye Y). Turning slides the eye sideways, climbing lifts it —
 * neither rotates the camera. Depth is untouched, exactly as the ROM's (X−UNIV4X)/depth.
 */
export function toEye(state: FlightState): Vec3 {
  return [state.heading * PAN_SCALE, state.altitude * ALT_TO_Y, 0]
}

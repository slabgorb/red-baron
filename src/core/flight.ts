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

/** POTDLY — the 11-step pitch table PLDELY, index 0..10 (R2BRON.MAC:5923). */
export const PITCH_TABLE: readonly number[] = Object.freeze([
  -32, -23, -17, -10, -5, 0, 4, 8, 13, 18, 25,
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

/** DISCHK proximity scale factors — close feels sharper than far. */
export const DISCHK: Readonly<Record<ProximityBand, number>> = Object.freeze({
  near: 1.0,
  mid: 0.625,
  far: 0.375,
})

// ─── forced-slow control band (rb3-2, findings §2) ───────────────────────────

/**
 * The DISCHK band ground mode forces the controls to — the slow 'far' feel (×0.375),
 * regardless of the nearest object's distance (findings §2, "ground mode is forced to the
 * slow band"). 'far' is the minimum DISCHK scale; enemy.ts already calls it "the slow 'far'
 * band".
 */
export const GROUND_CONTROL_BAND: ProximityBand = 'far'

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

/** Full-yoke commanded PLDELX. ≥ 0x1C "hard turn" (findings §5) and ×8 saturates BANK_LIMIT. */
const MAX_TURN = 40
/** Step-limited acceleration: how far PLDELX eases toward its target each calc frame. */
const TURN_ACCEL = 8
/** PFROTN bank → radians: 0x200 = a 90° quadrant, so 0x100 = 45° (π/1024 per count). */
const ROLL_SCALE = Math.PI / 1024
/** PLDELY climb/dive step → transient camera pitch (radians per step). */
const PITCH_SCALE = Math.PI / 512
/** Accumulated heading (turn pan) → yaw radians. */
const YAW_SCALE = Math.PI / 1024
/** I4YPOS (eye Y ×4, findings §2) → world eye height. */
const ALT_TO_Y = 1 / 4

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

/** POT.X — ease PLDELX toward its target: step-limited, with a 2-count deadband. */
function easeTurnRate(current: number, target: number): number {
  const delta = target - current
  if (Math.abs(delta) <= TURN_HYSTERESIS) return current // hysteresis: don't chase
  return current + Math.sign(delta) * Math.min(TURN_ACCEL, Math.abs(delta))
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
  const turnRate = easeTurnRate(state.turnRate, clamp(input.turn, -1, 1) * MAX_TURN)
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
 * Project ROM-unit flight state onto the rb1 camera attitude (radians): the
 * horizon banks with the clamped PFROTN roll, slides with the transient pitch,
 * and pans with the accumulated heading (findings §2).
 */
export function toAttitude(state: FlightState): Attitude {
  return {
    roll: pfrotn(state.turnRate) * ROLL_SCALE,
    pitch: state.pitchRate * PITCH_SCALE,
    yaw: state.heading * YAW_SCALE,
  }
}

/**
 * The pilot's eye position for flightView. Heading is a yaw rotation (not a
 * lateral strafe), so the eye only rises and falls with altitude: [0, y, 0].
 */
export function toEye(state: FlightState): Vec3 {
  return [0, state.altitude * ALT_TO_Y, 0]
}

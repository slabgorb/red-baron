// tests/core/flight.test.ts
//
// Story rb2-1 — RED phase (Furiosa / TEA). The authentic FLIGHT MODEL —
// the dynamics that DRIVE the rb1 flightView camera (findings §2).
//
// CONTRACT for the GREEN phase (The Word Burgers / DEV): create
// `src/core/flight.ts`, the pot-yoke → attitude flight model, exporting:
//
//   // --- ROM-exact constants (findings §2, §5) ---
//   export const PITCH_TABLE: readonly number[]  // POTDLY: [-32,-23,-17,-10,-5,0,4,8,13,18,25]
//   export const BANK_LIMIT: number              // 0x100 = 256   (PFROTN magnitude clamp)
//   export const ALT_MIN: number                 // PLYMIN = $8*4   = 32   (hex equate, .RADIX 16)
//   export const ALT_MAX: number                 // PLYMAX = $180*4 = 1536 (hex equate, .RADIX 16)
//   export const TURN_HYSTERESIS: number         // 2 counts (POT.X)
//
//   export type ProximityBand = 'near' | 'mid' | 'far'
//   export const DISCHK: Readonly<Record<ProximityBand, number>>  // near 1.0 / mid 0.625 / far 0.375
//
//   // --- pure ROM helpers ---
//   export function pitchDelta(pitchPot: number): number   // POTSCL: pot [-1,1] → step → PLDELY
//   export function pfrotn(turnRate: number): number       // PFROTN = clamp(turnRate*8, ±BANK_LIMIT)
//
//   // --- the calc-frame sim (one step per 96 ms calc frame — timing.ts) ---
//   export interface FlightInput {
//     readonly turn: number              // yoke X ∈ [-1,1]: commanded TARGET turn-rate
//     readonly pitch: number             // yoke Y ∈ [-1,1] → POTSCL → PLDELY
//     readonly proximity: ProximityBand  // DISCHK band of the nearest object
//   }
//   export interface FlightState {
//     readonly turnRate: number   // PLDELX — a rate with inertia + hysteresis
//     readonly pitchRate: number  // PLDELY — this frame's climb/dive step
//     readonly altitude: number   // I4YPOS — clamped [ALT_MIN, ALT_MAX]
//     readonly heading: number    // accumulated turn pan (UNIV4X → yaw)
//   }
//   export const INITIAL_FLIGHT: FlightState        // level; altitude 0x210 = 528 (findings §5)
//   export function step(state: FlightState, input: FlightInput): FlightState
//
//   // --- the camera bridge: this is what "drives the rb1 flightView camera" ---
//   export function toAttitude(state: FlightState): Attitude   // { roll, pitch, yaw } radians
//   export function toEye(state: FlightState): Vec3            // eye world position [0, y, 0]
//
// WHY THIS SHAPE (cited — findings §2 "Player flight model"):
//   * TURN/ROLL → PLDELX, a RATE WITH INERTIA. POT.X (RBARON.MAC:5897-5926) eases
//     PLDELX toward the commanded pot with 2 counts of hysteresis, stepping by the
//     error arithmetically shifted right 3 (proportional) — the yoke sets a *target
//     turn-rate the plane ramps into*, not an instant heading (rb4-5 AC4).
//   * PITCH → PLDELY, 11 DISCRETE STEPS. POTSCL maps the pitch pot to index 0..10
//     into POTDLY: `.4WORD -32.,-23.,-17.,-10.,-5,0,4,8,13.,18.,25.` (RBARON.MAC:5930).
//     The `.4WORD` macro (RBARON.MAC:15-18) ×4's every operand, so the shipped table
//     is [-128,-92,-68,-40,-20,0,16,32,52,72,100] (rb4-5 FL-001). Center = 0;
//     ASYMMETRIC — dive (-128) is faster than climb (+100).
//   * PFMOTN (RBARON.MAC:3149-3262): PLDELX (×DISCHK) pans the world horizontally
//     (UNIV4X); PFROTN = PLDELX × 8, clamped |·| ≤ 0x100, is the horizon-bank
//     roll; PLDELY (×DISCHK) adds to altitude I4YPOS, HARD-CLAMPED PLYMIN..PLYMAX.
//   * DISCHK (RBARON.MAC:3468-3496): player deltas scale by proximity of the nearest
//     object — rb4-5 AC3: close ×0.375 / mid ×0.625 / far ×1.0. Control goes SLUGGISH
//     when something is near (our shipped bands were inverted).
//   * NO THROTTLE. Two pots (a flight yoke) + fire + start; forward motion is
//     IMPLICIT AND CONSTANT — the pilot commands only turn and pitch (R2BRON.MAC:520,
//     the epic "throttle" blurb was corrected).
//   * INITIAL/respawn eye altitude I4YPOS = 0x0210 = 528 (findings §5, R2BRON.MAC:1215-1291).
//
// SCOPE: rb2-1 owns the flight DYNAMICS only. The camera/horizon it drives are the
// rb1 foundation (camera.ts, horizon.ts) — tested there. Enemy planes, DISCHK's
// live nearest-object distance, collision, and the ground wave are later stories,
// so `proximity` is an INPUT the caller supplies (rb2-1 has no enemies yet).
//
// The exact ROM DATA is pinned to the byte (the pitch table, the ×8 coupling, the
// clamps, the DISCHK fractions). Where the ROM→radian scale and the accel-step
// size are Dev tuning (the doc does not pin them), the camera bridge and the
// inertia ramp are pinned BEHAVIOURALLY — sign, monotonicity, bounds, convergence —
// not as magic constants. Testing an unspecified constant would fabricate a spec.
//
// Loaded defensively (await import in beforeAll, the house pattern): during RED the
// module does not exist, so each test reports a clean assertion failure instead of
// a suite-collection crash. camera.ts / horizon.ts DO exist (rb1) and are imported
// statically — the integration tests prove the model drives the REAL camera.

import { describe, it, expect, beforeAll } from 'vitest'
import { transform, type Vec3, type Mat4 } from '@arcade/shared/math3d'
import { flightView } from '../../src/core/camera'

// --- local mirrors of the RED contract (kept out of the static import graph so
//     the file loads while src/core/flight.ts does not yet exist) ---

type ProximityBand = 'near' | 'mid' | 'far'

interface Attitude {
  readonly roll: number
  readonly pitch: number
  readonly yaw: number
}

interface FlightInput {
  readonly turn: number
  readonly pitch: number
  readonly proximity: ProximityBand
}

interface FlightState {
  readonly turnRate: number
  readonly pitchRate: number
  readonly altitude: number
  readonly heading: number
}

interface FlightModule {
  PITCH_TABLE?: readonly number[]
  BANK_LIMIT?: number
  ALT_MIN?: number
  ALT_MAX?: number
  TURN_HYSTERESIS?: number
  DISCHK?: Readonly<Record<ProximityBand, number>>
  INITIAL_FLIGHT?: FlightState
  pitchDelta?: (pitchPot: number) => number
  pfrotn?: (turnRate: number) => number
  step?: (state: FlightState, input: FlightInput) => FlightState
  toAttitude?: (state: FlightState) => Attitude
  toEye?: (state: FlightState) => Vec3
}

let f: FlightModule = {}

beforeAll(async () => {
  try {
    f = (await import('../../src/core/flight')) as unknown as FlightModule
  } catch {
    f = {}
  }
})

/** Fail loud-and-clear when a contract export is missing (RED-friendly). */
function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`src/core/flight.ts must export ${name} (rb2-1 RED contract)`)
  }
  return value
}

/** Build a FlightInput; proximity defaults to 'near' (rb4-5: the SLOW ×0.375 band) for terse tests. */
const IN = (turn: number, pitch: number, proximity: ProximityBand = 'near'): FlightInput => ({
  turn,
  pitch,
  proximity,
})

/** Run `n` identical calc-frame steps from `state`. */
function run(state: FlightState, input: FlightInput, n: number): FlightState {
  const step = need(f.step, 'step')
  let s = state
  for (let i = 0; i < n; i++) s = step(s, input)
  return s
}

/** The starting state (a fresh copy is cheap; INITIAL_FLIGHT itself must stay immutable). */
function base(): FlightState {
  return { ...need(f.INITIAL_FLIGHT, 'INITIAL_FLIGHT') }
}

/** Hand-build a state by overriding INITIAL fields (robust to extra fields Dev adds). */
function withState(overrides: Partial<FlightState>): FlightState {
  return { ...base(), ...overrides }
}

// ───────────────────────────────────────────────────────────────────────────
// AC-1 — PLDELY pitch table (POTSCL / POTDLY)
// ───────────────────────────────────────────────────────────────────────────
describe('flight — PLDELY 11-step pitch table (POTSCL, findings §2)', () => {
  // rb4-5 FL-001: POTDLY is declared with the `.4WORD` macro (RBARON.MAC:15-18),
  // which MULTIPLIES EVERY OPERAND BY 4. The shipped ROM table is the ×4 expansion
  // of `.4WORD -32.,-23.,-17.,-10.,-5,0,4,8,13.,18.,25.` (RBARON.MAC:5930), NOT the
  // raw operand list. Our clone transcribed the raw operands (an undecoded macro).
  const RAW_OPERANDS = [-32, -23, -17, -10, -5, 0, 4, 8, 13, 18, 25]
  const EXPECTED = RAW_OPERANDS.map((v) => v * 4) // [-128,-92,-68,-40,-20,0,16,32,52,72,100]

  it('PITCH_TABLE is the ROM POTDLY bytes through the .4WORD ×4 macro (RBARON.MAC:5930)', () => {
    const table = need(f.PITCH_TABLE, 'PITCH_TABLE')
    expect([...table]).toEqual(EXPECTED)
    expect(table.length).toBe(11)
    // refute the un-multiplied transcription that shipped (the FL-001 bug):
    expect([...table]).not.toEqual(RAW_OPERANDS)
  })

  it('center pot maps to step 0 — level flight is a real value, not a default', () => {
    // The classic `x || default` numeric bug: 0 is falsy but VALID. Center MUST be 0.
    expect(need(f.pitchDelta, 'pitchDelta')(0)).toBe(0)
  })

  it('full deflection hits the table extremes: dive = -128, climb = +100 (×4)', () => {
    const pitchDelta = need(f.pitchDelta, 'pitchDelta')
    expect(pitchDelta(-1)).toBe(-128) // full nose-down  (-32 × 4)
    expect(pitchDelta(1)).toBe(100) // full nose-up   (+25 × 4)
  })

  it('ASYMMETRIC — a full dive (-128) is faster than a full climb (+100)', () => {
    const pitchDelta = need(f.pitchDelta, 'pitchDelta')
    expect(Math.abs(pitchDelta(-1))).toBeGreaterThan(Math.abs(pitchDelta(1)))
  })

  it('every mapped value comes from the table and rises monotonically with the pot', () => {
    const pitchDelta = need(f.pitchDelta, 'pitchDelta')
    const table = need(f.PITCH_TABLE, 'PITCH_TABLE')
    const sweep = Array.from({ length: 41 }, (_, i) => -1 + i * 0.05)
    let prev = pitchDelta(sweep[0])
    for (const p of sweep) {
      const d = pitchDelta(p)
      expect(table).toContain(d) // discrete: no interpolation between steps
      expect(d).toBeGreaterThanOrEqual(prev) // non-decreasing as the pot swings up
      prev = d
    }
  })

  it('out-of-range pots clamp to the table ends (the ROM pot is noise-filtered/calibrated)', () => {
    const pitchDelta = need(f.pitchDelta, 'pitchDelta')
    expect(pitchDelta(5)).toBe(100) // past full up → clamps to +100 (+25 × 4)
    expect(pitchDelta(-5)).toBe(-128) // past full down → clamps to -128 (-32 × 4)
  })

  it('rounds the pot to the NEAREST step (not floor/ceil) — pinned across a boundary', () => {
    // A shifted rounding rule would still be monotonic and in-table, so pin values
    // on both sides of a step midpoint (the sweep test alone can't catch this).
    const pitchDelta = need(f.pitchDelta, 'pitchDelta')
    expect(pitchDelta(-0.74)).toBe(-92) // just below the 1→2 midpoint → step 1 (-23 × 4; ceil would give -68)
    expect(pitchDelta(-0.66)).toBe(-68) // just above it → step 2 (-17 × 4; floor would give -92)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-2 — PFROTN horizon-bank coupling = PLDELX × 8, clamped ≤ 0x100
// ───────────────────────────────────────────────────────────────────────────
describe('flight — PFROTN bank = PLDELX×8 clamped ≤ 0x100 (findings §2)', () => {
  it('BANK_LIMIT is 0x100 (256)', () => {
    expect(need(f.BANK_LIMIT, 'BANK_LIMIT')).toBe(0x100)
  })

  it('bank = turnRate × 8 below the clamp, sign preserved', () => {
    const pfrotn = need(f.pfrotn, 'pfrotn')
    expect(pfrotn(0)).toBe(0)
    expect(pfrotn(10)).toBe(80)
    expect(pfrotn(-10)).toBe(-80)
    expect(pfrotn(32)).toBe(256) // 32×8 = 256, exactly the limit (not clamped away)
  })

  it('magnitude is hard-clamped to ±0x100 past the limit (a hard bank cannot over-rotate)', () => {
    const pfrotn = need(f.pfrotn, 'pfrotn')
    const limit = need(f.BANK_LIMIT, 'BANK_LIMIT')
    expect(pfrotn(33)).toBe(256) // 33×8 = 264 → clamp
    expect(pfrotn(-33)).toBe(-256)
    expect(pfrotn(1000)).toBe(256)
    expect(pfrotn(-1000)).toBe(-256)
    for (const r of [-500, -64, -1, 0, 1, 40, 200, 999]) {
      expect(Math.abs(pfrotn(r))).toBeLessThanOrEqual(limit)
      if (r !== 0) expect(Math.sign(pfrotn(r))).toBe(Math.sign(r))
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-3 — PLDELX turn-rate inertia + hysteresis (POT.X)
// ───────────────────────────────────────────────────────────────────────────
describe('flight — PLDELX turn-rate inertia + hysteresis (POT.X, findings §2)', () => {
  it('TURN_HYSTERESIS is 2 counts', () => {
    expect(need(f.TURN_HYSTERESIS, 'TURN_HYSTERESIS')).toBe(2)
  })

  it('a full turn command does NOT snap turnRate to its target in one step (inertia)', () => {
    const step = need(f.step, 'step')
    const oneStep = step(base(), IN(1, 0)).turnRate
    const settled = run(base(), IN(1, 0), 100).turnRate
    expect(settled).toBeGreaterThan(0) // it does eventually turn
    expect(oneStep).toBeGreaterThan(0) // and it starts ramping immediately
    expect(oneStep).toBeLessThan(settled) // ...but is NOWHERE near the target after one frame
  })

  it('turnRate ramps monotonically toward the target and then plateaus (converges)', () => {
    const step = need(f.step, 'step')
    let s = base()
    const trace: number[] = []
    for (let i = 0; i < 100; i++) {
      s = step(s, IN(1, 0))
      trace.push(s.turnRate)
    }
    for (let i = 1; i < trace.length; i++) {
      expect(trace[i]).toBeGreaterThanOrEqual(trace[i - 1]) // non-decreasing ramp
    }
    // plateaued: the last few frames barely move (settled at the commanded target)
    expect(Math.abs(trace[99] - trace[95])).toBeLessThan(Math.abs(trace[5] - trace[0]) + 1)
    expect(trace[99]).toBeGreaterThan(trace[0])
  })

  it('left and right ramps are mirror images (symmetric yoke)', () => {
    const right = run(base(), IN(1, 0), 100).turnRate
    const left = run(base(), IN(-1, 0), 100).turnRate
    expect(right).toBeGreaterThan(0)
    expect(left).toBeLessThan(0)
    expect(left).toBeCloseTo(-right, 6)
  })

  it('a settled turn is jitter-free — repeating the same command is bit-stable (no oscillation)', () => {
    const step = need(f.step, 'step')
    const settled = run(base(), IN(1, 0), 100)
    const a = step(settled, IN(1, 0)).turnRate
    const b = step(step(settled, IN(1, 0)), IN(1, 0)).turnRate
    expect(a).toBe(settled.turnRate) // already at target: does not overshoot
    expect(b).toBe(settled.turnRate) // ...and stays put (hysteresis/deadband, not ringing)
  })

  it('a full hard turn saturates the bank clamp (|PLDELX|×8 reaches ±0x100)', () => {
    // The clamp exists to be hit under a hard bank (findings §2/§5: |PLDELX| ≥ 0x1C
    // is "turning hard enough"). A full-deflection settled turn must reach the limit.
    const pfrotn = need(f.pfrotn, 'pfrotn')
    const limit = need(f.BANK_LIMIT, 'BANK_LIMIT')
    const right = run(base(), IN(1, 0), 100)
    const left = run(base(), IN(-1, 0), 100)
    expect(pfrotn(right.turnRate)).toBe(limit)
    expect(pfrotn(left.turnRate)).toBe(-limit)
  })

  it('holds turnRate inside the TURN_HYSTERESIS deadband, eases just outside it (POT.X)', () => {
    // The deadband is the point of hysteresis — a change within TURN_HYSTERESIS counts of
    // the TARGET must NOT be chased. rb4-5: under the proportional POT.X the full-yoke
    // equilibrium settles `hyst` counts SHORT of the commanded range, so the deadband must
    // be read at the commanded target — command centre (turn 0 → target 0) to isolate it
    // scale-free: within `hyst` of 0 PLDELX holds, one count past it eases toward 0.
    const step = need(f.step, 'step')
    const hyst = need(f.TURN_HYSTERESIS, 'TURN_HYSTERESIS')
    expect(step(withState({ turnRate: hyst }), IN(0, 0)).turnRate).toBe(hyst) // |err| = hyst → hold
    expect(step(withState({ turnRate: -hyst }), IN(0, 0)).turnRate).toBe(-hyst)
    // one count further → outside the deadband → PLDELX eases back toward the target (0)
    expect(Math.abs(step(withState({ turnRate: hyst + 1 }), IN(0, 0)).turnRate)).toBeLessThan(hyst + 1)
  })

  it('clamps an out-of-range turn command to the yoke limits (mirrors pitchDelta)', () => {
    // FlightInput.turn is the normalized yoke ∈ [-1,1]; a caller past full deflection
    // must not over-drive PLDELX beyond a full-yoke turn.
    const full = run(base(), IN(1, 0), 100).turnRate
    const over = run(base(), IN(5, 0), 100).turnRate
    expect(over).toBe(full)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// rb4-5 AC4 — POT.X is PROPORTIONAL (arithmetic >>3), bounded [-16,+15], no MAX_TURN
//
// POT.X (RBARON.MAC:5897-5926): diff = POTVAL - PTRNGE/2 - PLDELX (target - current);
// |diff| < 3 → leave alone (the 2-count hysteresis); else the step is `LSR LSR LSR`
// = diff >> 3 (arithmetic — `ORA I,0E0` sign-extends negatives), bounded to [-16,+15]
// (`CMP I,10` / sign-extend), with a ±1 floor for a non-zero diff that shifts to 0
// (the `20$` branch). It is NOT the constant `min(TURN_ACCEL, |delta|)` ramp toward a
// `turn × MAX_TURN` target our clone shipped — the step SHRINKS as PLDELX nears the
// commanded rate, and there is no invented MAX_TURN=40 cap.
//
// These pin the LAW with input.turn = 0 (so the target is exactly 0 and the error is
// exactly -turnRate — no dependence on Dev's pot→ROM-unit scale). The constant ramp
// gives ±min(8,|error|); the ROM gives arithShr(error, 3). They diverge for |error|>8.
// ───────────────────────────────────────────────────────────────────────────
describe('rb4-5 AC4 — POT.X proportional turn step (arithmetic >>3, findings §2)', () => {
  // turn = 0 ⇒ target = 0 ⇒ error = 0 - turnRate. step must be arithShr(error, 3).
  const HOLD = (turnRate: number): number => need(f.step, 'step')(withState({ turnRate }), IN(0, 0)).turnRate

  it('the step is the error arithmetically shifted right by 3 (proportional, not a constant ramp)', () => {
    // error = -turnRate; step = error >> 3. A constant-8 ramp would give -8 for all of these.
    expect(HOLD(80)).toBe(70) // error -80 → step -10 (ramp would give 72)
    expect(HOLD(16)).toBe(14) // error -16 → step  -2 (ramp would give  8)
    expect(HOLD(8)).toBe(7) //  error  -8 → step  -1 (ramp would give  0)
    expect(HOLD(-80)).toBe(-70) // error +80 → step +10 (symmetric)
  })

  it('a non-zero error that shifts to zero still steps by ±1 (the POT.X 20$ floor)', () => {
    // |error| in [3,7] shifts to 0; the ROM forces a unit step so PLDELX still creeps in.
    expect(HOLD(-5)).toBe(-4) // error +5 → +1 floor
    expect(HOLD(-4)).toBe(-3) // error +4 → +1 floor
    expect(HOLD(5)).toBe(4) //  error -5 → -1
  })

  it('the deadband holds: |error| < 3 does not move PLDELX (2-count hysteresis)', () => {
    expect(HOLD(2)).toBe(2) // |error| 2 < 3 → leave alone
    expect(HOLD(-2)).toBe(-2)
    expect(HOLD(0)).toBe(0)
  })

  it('the step magnitude is bounded to [-16, +15] no matter how large the error', () => {
    // A huge error saturates the step, not the target — there is no MAX_TURN cap on
    // where PLDELX may sit, only a bound on how fast it moves per frame.
    expect(HOLD(200) - 200).toBe(-16) // error -200 → step floored at -16
    expect(HOLD(-200) - -200).toBe(15) // error +200 → step capped at +15
  })

  it('approach to a held full turn DECELERATES (proportional), never a flat ramp', () => {
    const step = need(f.step, 'step')
    let s = base()
    const inc: number[] = []
    for (let i = 0; i < 12; i++) {
      const before = s.turnRate
      s = step(s, IN(1, 0))
      inc.push(s.turnRate - before)
    }
    // Proportional control's per-frame increment shrinks EVERY frame while the error
    // is large; a constant ramp holds it flat at the accel step (e.g. 8,8,8,8,8,…) and
    // only drops at the tail. Comparing two EARLY frames catches it: the ramp is still
    // flat at frame 2 (inc[0] == inc[2]), proportional has already decelerated.
    expect(inc[0]).toBeGreaterThan(inc[2])
    for (let i = 1; i < inc.length; i++) expect(inc[i]).toBeLessThanOrEqual(inc[i - 1])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-4 — I4YPOS altitude clamp (PLYMIN..PLYMAX)
// ───────────────────────────────────────────────────────────────────────────
describe('flight — I4YPOS altitude clamp (findings §2, §5)', () => {
  it('the clamp bounds are PLYMIN = 0x8*4 = 32 and PLYMAX = 0x180*4 = 1536 (RBARON.MAC .RADIX 16)', () => {
    expect(need(f.ALT_MIN, 'ALT_MIN')).toBe(0x8 * 4)
    expect(need(f.ALT_MAX, 'ALT_MAX')).toBe(0x180 * 4)
  })

  it('INITIAL altitude is the ROM spawn value I4YPOS = 0x0210 = 528, inside the clamp', () => {
    const init = need(f.INITIAL_FLIGHT, 'INITIAL_FLIGHT')
    expect(init.altitude).toBe(0x0210)
    expect(init.altitude).toBeGreaterThanOrEqual(need(f.ALT_MIN, 'ALT_MIN'))
    expect(init.altitude).toBeLessThanOrEqual(need(f.ALT_MAX, 'ALT_MAX'))
  })

  it('you cannot dive through the floor — a sustained full dive never drops below ALT_MIN', () => {
    const step = need(f.step, 'step')
    const min = need(f.ALT_MIN, 'ALT_MIN')
    let s = base()
    for (let i = 0; i < 200; i++) {
      s = step(s, IN(0, -1)) // full nose-down, every frame
      expect(s.altitude).toBeGreaterThanOrEqual(min)
    }
    expect(s.altitude).toBe(min) // and it settles ON the floor
  })

  it('you cannot climb through the ceiling — a sustained full climb never exceeds ALT_MAX', () => {
    const step = need(f.step, 'step')
    const max = need(f.ALT_MAX, 'ALT_MAX')
    let s = base()
    for (let i = 0; i < 200; i++) {
      s = step(s, IN(0, 1)) // full nose-up, every frame
      expect(s.altitude).toBeLessThanOrEqual(max)
    }
    expect(s.altitude).toBe(max) // and it settles ON the ceiling
  })

  it('climbing raises altitude and diving lowers it (monotone while held)', () => {
    const up10 = run(base(), IN(0, 1), 10).altitude
    const up5 = run(base(), IN(0, 1), 5).altitude
    const down5 = run(base(), IN(0, -1), 5).altitude
    expect(up5).toBeGreaterThan(base().altitude)
    expect(up10).toBeGreaterThan(up5) // still climbing
    expect(down5).toBeLessThan(base().altitude)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-5 — DISCHK distance-scaled control feel
// ───────────────────────────────────────────────────────────────────────────
describe('flight — DISCHK distance-scaled feel (findings §2)', () => {
  // rb4-5 AC3: our DISCHK bands were INVERTED. The ROM (RBARON.MAC:3468-3496 +
  // the D7=CLOSE / D6=MIDDLE / D5=FAR band flags at :3189) scales the player's
  // deltas by CLOSE ×0.375 (BMI → "0.375 * VALUE"), MIDDLE ×0.625 (BVS → "0.625 *
  // VALUE"), FAR ×1.0 (fall-through → "1.0 * VALUE"). Something CLOSE makes the
  // controls SLUGGISH, not sharper — the opposite of what we shipped.
  it('the three proximity bands are exactly near ×0.375 / mid ×0.625 / far ×1.0', () => {
    const d = need(f.DISCHK, 'DISCHK')
    expect(d.near).toBe(0.375) // CLOSE — D7 — BMI "0.375 * VALUE"
    expect(d.mid).toBe(0.625) // MIDDLE — D6 — BVS "0.625 * VALUE"
    expect(d.far).toBe(1.0) // FAR — D5 — fall-through "1.0 * VALUE"
  })

  it('the bands are ordered near < mid < far (close is the SLOW end, far is full control)', () => {
    const d = need(f.DISCHK, 'DISCHK')
    expect(d.near).toBeLessThan(d.mid)
    expect(d.mid).toBeLessThan(d.far)
  })

  it('DISCHK covers exactly the three ProximityBand values (exhaustive union)', () => {
    const d = need(f.DISCHK, 'DISCHK')
    expect(Object.keys(d).sort()).toEqual(['far', 'mid', 'near'])
    for (const band of ['near', 'mid', 'far'] as ProximityBand[]) {
      expect(d[band]).toBeGreaterThan(0)
    }
  })

  it('controls go SLUGGISH when something is close — pan scales DOWN with proximity', () => {
    // Same turn command, three bands. The turnRate RAMP is proximity-independent;
    // DISCHK scales the WORLD pan (heading). With the ROM bands, FAR (×1.0) pans
    // farthest and NEAR (×0.375) least — the reverse of the shipped bug.
    const near = run(base(), IN(1, 0, 'near'), 20).heading
    const mid = run(base(), IN(1, 0, 'mid'), 20).heading
    const far = run(base(), IN(1, 0, 'far'), 20).heading
    expect(far).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(near)
    expect(near).toBeGreaterThan(0)
  })

  it('altitude change also scales with proximity (climb gains more altitude when FAR)', () => {
    const startAlt = base().altitude
    const near = run(base(), IN(0, 1, 'near'), 5).altitude - startAlt
    const far = run(base(), IN(0, 1, 'far'), 5).altitude - startAlt
    expect(far).toBeGreaterThan(near)
    expect(near).toBeGreaterThan(0)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-6 — turning pans the world (heading / yaw accumulation)
// ───────────────────────────────────────────────────────────────────────────
describe('flight — turning pans the world, accumulating heading (UNIV4X, findings §2)', () => {
  it('a right turn accumulates positive heading; a left turn negative', () => {
    const right = run(base(), IN(1, 0), 20).heading
    const left = run(base(), IN(-1, 0), 20).heading
    expect(right).toBeGreaterThan(0)
    expect(left).toBeLessThan(0)
  })

  it('heading keeps accumulating while the turn is held (it is a position, not a rate)', () => {
    const h10 = run(base(), IN(1, 0), 10).heading
    const h20 = run(base(), IN(1, 0), 20).heading
    expect(h20).toBeGreaterThan(h10)
  })

  it('wings level (no turn) leaves heading untouched', () => {
    expect(run(base(), IN(0, 0), 30).heading).toBe(base().heading)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-7 — drives the rb1 flightView camera (the story title)
//
// rb4-5: the camera is TRANSLATION-based. The flight→camera bridge maps heading to
// a LATERAL eye pan (UNIV4X) and altitude to eye height (I4YPOS); the ONLY rotation
// left is the bank (roll). No yaw rotation, no transient camera pitch. The
// depth-invariance of that translation is pinned behaviourally in camera-shape.test.ts;
// here we pin the BRIDGE OUTPUT (toAttitude / toEye) that produces it.
// ───────────────────────────────────────────────────────────────────────────
describe('flight — drives the rb1 flightView camera (story title, findings §2)', () => {
  /** roll of a state, robust to the interface dropping the (now-zero) pitch/yaw fields. */
  const rollOf = (s: FlightState): number => need(f.toAttitude, 'toAttitude')(s).roll
  const pitchOf = (s: FlightState): number => need(f.toAttitude, 'toAttitude')(s).pitch ?? 0
  const yawOf = (s: FlightState): number => need(f.toAttitude, 'toAttitude')(s).yaw ?? 0

  it('a neutral state is wings-level with no roll', () => {
    expect(rollOf(base())).toBeCloseTo(0, 9)
  })

  it('the transient pitchRate produces NO camera pitch — climb/dive is I4YPOS, not a rotation', () => {
    // The ROM never rotates for pitch; PLDELY only feeds I4YPOS. A state that differs
    // ONLY in pitchRate must carry the same (zero) camera pitch.
    expect(pitchOf(withState({ pitchRate: 18 }))).toBeCloseTo(0, 9)
    expect(pitchOf(withState({ pitchRate: -23 }))).toBeCloseTo(0, 9)
  })

  it('heading produces NO camera yaw — turning is the UNIV4X world pan, not a rotation', () => {
    expect(yawOf(withState({ heading: 40 }))).toBeCloseTo(0, 9)
    expect(yawOf(withState({ heading: -40 }))).toBeCloseTo(0, 9)
  })

  it('heading drives a LATERAL eye pan (UNIV4X): the eye slides in X, opposite ways L vs R', () => {
    const toEye = need(f.toEye, 'toEye')
    const level = toEye(base())
    const right = toEye(withState({ heading: 40 }))
    const left = toEye(withState({ heading: -40 }))
    expect(Math.abs(right[0] - level[0])).toBeGreaterThan(1e-3) // the world pans laterally…
    expect(Math.sign(right[0] - level[0])).toBe(-Math.sign(left[0] - level[0])) // …opposite ways
  })

  it('altitude drives eye HEIGHT (I4YPOS): climbing raises the eye', () => {
    const toEye = need(f.toEye, 'toEye')
    const eLow = toEye(withState({ altitude: 100 }))
    const eHigh = toEye(withState({ altitude: 700 }))
    expect(eHigh[1]).toBeGreaterThan(eLow[1])
    // ...and through the real camera a fixed ground point sits lower when you're higher:
    const ground: Vec3 = [0, -40, -500]
    const viaLow = transform(flightView(need(f.toAttitude, 'toAttitude')(withState({ altitude: 100 })), eLow), ground)
    const viaHigh = transform(flightView(need(f.toAttitude, 'toAttitude')(withState({ altitude: 700 })), eHigh), ground)
    expect(viaHigh[1]).toBeLessThan(viaLow[1])
  })

  it('roll follows the turn: banking rolls opposite ways L vs R and obeys the 0x100 clamp', () => {
    const flat = Math.abs(rollOf(base()))
    const rightTilt = rollOf(withState({ turnRate: 20 }))
    const leftTilt = rollOf(withState({ turnRate: -20 }))
    expect(flat).toBeLessThan(1e-6) // level ⇒ no roll
    expect(Math.abs(rightTilt)).toBeGreaterThan(1e-3) // a bank rolls
    expect(Math.sign(rightTilt)).toBe(-Math.sign(leftTilt)) // opposite banks roll oppositely
    const atLimit = Math.abs(rollOf(withState({ turnRate: 100 })))
    const beyond = Math.abs(rollOf(withState({ turnRate: 1000 })))
    expect(beyond).toBeCloseTo(atLimit, 6) // ...saturates at the clamp
  })

  it('the bridge yields a valid (finite) Math-Box view for a full maneuvering state', () => {
    const s = withState({ turnRate: 15, pitchRate: 8, heading: 12, altitude: 400 })
    const view: Mat4 = flightView(need(f.toAttitude, 'toAttitude')(s), need(f.toEye, 'toEye')(s))
    expect(view.length).toBe(16)
    for (const v of view) expect(Number.isFinite(v)).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-8 — no throttle: forward motion is implicit and constant
// ───────────────────────────────────────────────────────────────────────────
describe('flight — no throttle, forward motion implicit & constant (findings §2)', () => {
  it('the pilot commands ONLY turn + pitch — a centered yoke drifts nothing', () => {
    const s = run(base(), IN(0, 0), 50)
    expect(s.turnRate).toBe(base().turnRate)
    expect(s.pitchRate).toBe(0)
    expect(s.altitude).toBe(base().altitude)
    expect(s.heading).toBe(base().heading)
  })

  it('the model exposes no throttle/speed/velocity control (there is none in the ROM)', () => {
    const throttleLike = Object.keys(f).filter((k) => /throttle|speed|velocity/i.test(k))
    expect(throttleLike).toEqual([])
  })

  it('the stepped state carries exactly the four documented axes — no hidden throttle field', () => {
    // Export names (checked above) can't see the returned object's shape (interfaces
    // erase at runtime); lock the actual FlightState keys so a stray speed/velocity
    // field on the state itself can't slip past.
    const s = run(base(), IN(1, 1, 'mid'), 3)
    expect(Object.keys(s).sort()).toEqual(['altitude', 'heading', 'pitchRate', 'turnRate'])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-9 / rules — pure & deterministic (calc-frame sim contract)
// ───────────────────────────────────────────────────────────────────────────
describe('flight — pure & deterministic (module contract)', () => {
  it('step is deterministic — identical (state, input) give an identical result', () => {
    const s = withState({ turnRate: 7, altitude: 300, heading: 2 })
    expect(run(base(), IN(0.5, -0.3, 'mid'), 12)).toEqual(run(base(), IN(0.5, -0.3, 'mid'), 12))
    expect(need(f.step, 'step')(s, IN(1, 1))).toEqual(need(f.step, 'step')(s, IN(1, 1)))
  })

  it('step does not mutate its input state (readonly / no side effects)', () => {
    const s = withState({ turnRate: 9, pitchRate: 4, altitude: 250, heading: 5 })
    const snapshot = { ...s }
    need(f.step, 'step')(s, IN(1, -1, 'far'))
    expect(s).toEqual(snapshot) // the passed-in state is untouched
  })

  it('INITIAL_FLIGHT is a stable constant — stepping from it never mutates it', () => {
    const init = need(f.INITIAL_FLIGHT, 'INITIAL_FLIGHT')
    const snapshot = { ...init }
    run(base(), IN(1, 1, 'near'), 25)
    expect(init).toEqual(snapshot)
  })
})

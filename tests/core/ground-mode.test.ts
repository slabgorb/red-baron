// tests/core/ground-mode.test.ts
//
// Story rb3-2 — RED phase (O'Brien / TEA). GROUND-WAVE MODE ENTRY + FORCED-SLOW
// CONTROL. rb2-7 landed the MODECT/NEWCT wave alternation + the MCOUNT 4,2,3,2,1,3,4,2
// table, but every wave was a PLANE wave — the ground-parity MODECT slots were silent
// no-op waits (rb2-7 explicitly left them as "the INITGR hook rb3 will populate").
// THIS story populates them: the MODECT LSB now branches INITGR (ground) vs STPLNE
// (plane), a ground slot enters GRMODE = 0C0 (D7 ground + D6 plane-disable) so the main
// loop skips new-plane generation, and DISCHK is forced to the slow band while a ground
// wave runs. Grounded in findings §4 (INITGR/MODECT/.LEVLS, R2BRON.MAC:2254-2269,
// 1401-1407) and §2 (DISCHK "ground mode is forced to the slow band", R2BRON.MAC:3463-3491).
//
// ┌─ CONTRACT for the GREEN phase (Julia / DEV) ────────────────────────────────┐
//
// EXTEND `src/core/waves.ts` with the GRMODE ground-mode byte + the INITGR/STPLNE branch:
//
//   // GRMODE bit flags — findings §4 (INITGR, R2BRON.MAC:1401-1407).
//   // ⚠ .RADIX 16 HEX: the ROM's `GRMODE=0C0` is 0xC0 (= 192), NOT decimal 12.
//   export const GRMODE_GROUND: number         //  0x80 — D7: a ground wave is running
//   export const GRMODE_PLANE_DISABLE: number  //  0x40 — D6: main loop skips new-plane generation
//   export const GRMODE_INITGR: number         //  0xC0 — INITGR sets GRMODE = 0C0 (D7 | D6)
//   export const GRMODE_PLANE: number          //  0x00 — STPLNE / plane mode: ground bits clear
//
//   // predicates over a GRMODE byte (read the bits, not the whole value)
//   export function planeGenDisabled(grmode: number): boolean  // (grmode & GRMODE_PLANE_DISABLE) !== 0
//   export function isGroundMode(grmode: number): boolean      // (grmode & GRMODE_GROUND)        !== 0
//
//   // the INITGR/STPLNE branch: the MODECT LSB selects the GRMODE its wave slot enters (§4).
//   // Even MODECT (plane slot, isPlaneWave true)  → GRMODE_PLANE  (0x00) — planes resume.
//   // Odd  MODECT (ground slot, isPlaneWave false) → GRMODE_INITGR (0xC0) — ground mode, planes off.
//   export function grmodeForWave(modect: number): number
//
// EXTEND `src/core/flight.ts` with the forced-slow control band (reuse ProximityBand — §2):
//
//   // DISCHK is forced to the MIDDLE band in ground mode — the fixed 'mid' feel (×0.625),
//   // regardless of the nearest object's distance (findings §2 + rb4-5 AC3: PFMOTN
//   // `LDA I,40` = TEMP3 0x40 = D6 = MIDDLE, RBARON.MAC:3186-3188).
//   export const GROUND_CONTROL_BAND: ProximityBand            // 'mid'
//   export function controlBand(groundMode: boolean, liveBand: ProximityBand): ProximityBand
//     //   groundMode → GROUND_CONTROL_BAND ('mid'); else the live nearest-object band, unchanged.
//
// └─────────────────────────────────────────────────────────────────────────────┘
//
// WHY THIS SHAPE (cited — findings §2/§4, R2BRON.MAC):
//   * MODECT LSB → INITGR vs STPLNE (§4, R2BRON.MAC:2254-2269): "a NEWCT countdown steps
//     MODECT, whose LSB selects plane wave (STPLNE) vs ground wave (INITGR)." rb2-7 pinned
//     the alternation (even=plane by convention — the ROM fixes the LSB gate, not which
//     parity is the plane); rb3-2 makes the ground branch ACTIVE by entering GRMODE.
//   * GRMODE = 0C0 (§4, INITGR, R2BRON.MAC:1401-1407): "sets GRMODE=0C0 (D7 ground + D6
//     plane-disable), so the main loop skips new-plane generation and slows control." The
//     equate is .RADIX 16 — the recurring red-baron footgun: 0C0 is 0xC0 = 0x80 | 0x40,
//     NOT decimal 12. (rb3-1/rb3-8 proved the RBARON.MAC block is hex.)
//   * DISCHK forced-middle (§2 + rb4-5 AC3, RBARON.MAC:3468-3496): "player deltas scale by
//     proximity of the nearest object (close ×0.375 / mid ×0.625 / far ×1.0); ground mode is
//     forced to the MIDDLE band." The forced band is 'mid' (0x40=D6=×0.625) — this reuses the flight.ts
//     DISCHK plumbing, it does not invent a new control path.
//   * .LEVLS=5 (§4/§3): "the difficulty *ceiling* reached via kills, not discrete stages."
//     A guardrail: rb3-2 must NOT reinterpret .LEVLS as a count of ground stages.

import { describe, it, expect, beforeAll } from 'vitest'
import { MAX_GMLEVL, PLNLVL } from '../../src/core/scoring'

// ─── the GREEN contract surface (all optional so RED fails loud, not undefined-explodes) ──

type ProximityBand = 'near' | 'mid' | 'far'

interface FlightState {
  readonly turnRate: number
  readonly pitchRate: number
  readonly altitude: number
  readonly heading: number
}
interface FlightInput {
  readonly turn: number
  readonly pitch: number
  readonly proximity: ProximityBand
}

interface WavesModule {
  // rb3-2 new surface
  GRMODE_GROUND?: number
  GRMODE_PLANE_DISABLE?: number
  GRMODE_INITGR?: number
  GRMODE_PLANE?: number
  planeGenDisabled?: (grmode: number) => boolean
  isGroundMode?: (grmode: number) => boolean
  grmodeForWave?: (modect: number) => number
  // rb2-7 carry-forward the branch must stay consistent with
  isPlaneWave?: (modect: number) => boolean
  stepWaveClock?: (clock: { modect: number; countdown: number }) => {
    clock: { modect: number; countdown: number }
    spawnPlaneWave: boolean
  }
}

interface FlightModule {
  // rb3-2 new surface
  GROUND_CONTROL_BAND?: ProximityBand
  controlBand?: (groundMode: boolean, liveBand: ProximityBand) => ProximityBand
  // rb2-1 carry-forward used to prove the forced-slow band reaches real DISCHK
  DISCHK?: Readonly<Record<ProximityBand, number>>
  INITIAL_FLIGHT?: FlightState
  step?: (state: FlightState, input: FlightInput) => FlightState
}

let w: WavesModule = {}
let f: FlightModule = {}

beforeAll(async () => {
  try {
    w = (await import('../../src/core/waves')) as WavesModule
  } catch {
    w = {}
  }
  try {
    f = (await import('../../src/core/flight')) as FlightModule
  } catch {
    f = {}
  }
})

/** Fail loud-and-clear when a contract export is missing (RED-friendly). */
function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`rb3-2 RED contract: missing export ${name}`)
  }
  return value
}

const ALL_BANDS: readonly ProximityBand[] = ['near', 'mid', 'far']

// ───────────────────────────────────────────────────────────────────────────
// AC-1 — GRMODE = 0C0 is the ROM-exact hex byte 0xC0 (D7 | D6), NOT decimal 12
//        (findings §4, INITGR R2BRON.MAC:1401-1407; the recurring .RADIX 16 trap)
// ───────────────────────────────────────────────────────────────────────────
describe('rb3-2 GRMODE byte — 0C0 read as HEX (findings §4, .RADIX 16)', () => {
  it('the bit flags are the exact ROM bytes: D7=0x80 ground, D6=0x40 plane-disable, plane=0x00', () => {
    expect(need(w.GRMODE_GROUND, 'GRMODE_GROUND')).toBe(0x80)
    expect(need(w.GRMODE_PLANE_DISABLE, 'GRMODE_PLANE_DISABLE')).toBe(0x40)
    expect(need(w.GRMODE_PLANE, 'GRMODE_PLANE')).toBe(0x00)
  })

  it('INITGR sets GRMODE = 0C0 = 0xC0 = 192 — the D7|D6 union, NOT decimal 12', () => {
    const initgr = need(w.GRMODE_INITGR, 'GRMODE_INITGR')
    expect(initgr).toBe(0xc0) // hex 0C0
    expect(initgr).toBe(192) // …which is 192 decimal
    expect(initgr).not.toBe(12) // ⚠ the decimal misread of the ROM's "0C0" — must NOT be this
    expect(initgr).toBe(need(w.GRMODE_GROUND, 'GRMODE_GROUND') | need(w.GRMODE_PLANE_DISABLE, 'GRMODE_PLANE_DISABLE'))
  })

  it('GRMODE_INITGR carries BOTH the ground (D7) and plane-disable (D6) bits set', () => {
    const initgr = need(w.GRMODE_INITGR, 'GRMODE_INITGR')
    expect(initgr & need(w.GRMODE_GROUND, 'GRMODE_GROUND')).toBe(need(w.GRMODE_GROUND, 'GRMODE_GROUND'))
    expect(initgr & need(w.GRMODE_PLANE_DISABLE, 'GRMODE_PLANE_DISABLE')).toBe(need(w.GRMODE_PLANE_DISABLE, 'GRMODE_PLANE_DISABLE'))
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-2 — planeGenDisabled / isGroundMode read the RIGHT bit (findings §4)
// ───────────────────────────────────────────────────────────────────────────
describe('rb3-2 GRMODE predicates — bit-precise, not just non-zero (findings §4)', () => {
  it('INITGR (0C0) both disables plane generation AND is ground mode', () => {
    const initgr = need(w.GRMODE_INITGR, 'GRMODE_INITGR')
    expect(need(w.planeGenDisabled, 'planeGenDisabled')(initgr)).toBe(true)
    expect(need(w.isGroundMode, 'isGroundMode')(initgr)).toBe(true)
  })

  it('plane mode (0x00) neither disables plane generation NOR is ground mode', () => {
    const plane = need(w.GRMODE_PLANE, 'GRMODE_PLANE')
    expect(need(w.planeGenDisabled, 'planeGenDisabled')(plane)).toBe(false)
    expect(need(w.isGroundMode, 'isGroundMode')(plane)).toBe(false)
  })

  it('the two predicates read INDEPENDENT bits — D6-only and D7-only are distinguishable', () => {
    const planeGenDisabled = need(w.planeGenDisabled, 'planeGenDisabled')
    const isGroundMode = need(w.isGroundMode, 'isGroundMode')
    // A byte with ONLY D6 (plane-disable) set: disables planes, but is NOT ground mode.
    expect(planeGenDisabled(need(w.GRMODE_PLANE_DISABLE, 'GRMODE_PLANE_DISABLE'))).toBe(true)
    expect(isGroundMode(need(w.GRMODE_PLANE_DISABLE, 'GRMODE_PLANE_DISABLE'))).toBe(false)
    // A byte with ONLY D7 (ground) set: is ground mode, but does NOT (by that bit) disable planes.
    expect(isGroundMode(need(w.GRMODE_GROUND, 'GRMODE_GROUND'))).toBe(true)
    expect(planeGenDisabled(need(w.GRMODE_GROUND, 'GRMODE_GROUND'))).toBe(false)
  })

  it('is total on a clean byte — both predicates are false for 0 (never NaN/undefined)', () => {
    expect(need(w.planeGenDisabled, 'planeGenDisabled')(0)).toBe(false)
    expect(need(w.isGroundMode, 'isGroundMode')(0)).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-3 — grmodeForWave: MODECT LSB selects INITGR (ground) vs STPLNE (plane)
//        (findings §4, R2BRON.MAC:2254-2269)
// ───────────────────────────────────────────────────────────────────────────
describe('rb3-2 grmodeForWave — the INITGR/STPLNE branch (findings §4)', () => {
  it('the opening wave (MODECT 0) is a PLANE slot → GRMODE_PLANE (ties to isPlaneWave(0)=true)', () => {
    expect(need(w.grmodeForWave, 'grmodeForWave')(0)).toBe(need(w.GRMODE_PLANE, 'GRMODE_PLANE'))
  })

  it('even MODECT → GRMODE_PLANE (STPLNE), odd MODECT → GRMODE_INITGR (INITGR), across the schedule', () => {
    const grmodeForWave = need(w.grmodeForWave, 'grmodeForWave')
    const plane = need(w.GRMODE_PLANE, 'GRMODE_PLANE')
    const initgr = need(w.GRMODE_INITGR, 'GRMODE_INITGR')
    for (let m = 0; m < 16; m++) {
      expect(grmodeForWave(m)).toBe(m % 2 === 0 ? plane : initgr)
    }
  })

  it('returns ONLY one of the two mode bytes — never a partial/garbage GRMODE', () => {
    const grmodeForWave = need(w.grmodeForWave, 'grmodeForWave')
    const plane = need(w.GRMODE_PLANE, 'GRMODE_PLANE')
    const initgr = need(w.GRMODE_INITGR, 'GRMODE_INITGR')
    for (let m = 0; m < 16; m++) {
      expect([plane, initgr]).toContain(grmodeForWave(m))
    }
  })

  it('the branch AGREES with rb2-7 isPlaneWave — a plane slot enables planes, a ground slot disables them', () => {
    const grmodeForWave = need(w.grmodeForWave, 'grmodeForWave')
    const isPlaneWave = need(w.isPlaneWave, 'isPlaneWave')
    const planeGenDisabled = need(w.planeGenDisabled, 'planeGenDisabled')
    const isGroundMode = need(w.isGroundMode, 'isGroundMode')
    for (let m = 0; m < 16; m++) {
      const g = grmodeForWave(m)
      // isPlaneWave(m)  ⟺  planes enabled  ⟺  NOT ground mode
      expect(planeGenDisabled(g)).toBe(!isPlaneWave(m))
      expect(isGroundMode(g)).toBe(!isPlaneWave(m))
    }
  })

  it("agrees with the rb2-7 scheduler decision — stepWaveClock's spawnPlaneWave matches !planeGenDisabled(grmodeForWave)", () => {
    const grmodeForWave = need(w.grmodeForWave, 'grmodeForWave')
    const planeGenDisabled = need(w.planeGenDisabled, 'planeGenDisabled')
    const step = need(w.stepWaveClock, 'stepWaveClock')
    // On a decision frame (countdown 0), the wave that fires belongs to `clock.modect`
    // (pre-increment); the main loop must enter grmodeForWave(that same modect).
    for (let m = 0; m < 16; m++) {
      const decision = step({ modect: m, countdown: 0 })
      expect(decision.spawnPlaneWave).toBe(!planeGenDisabled(grmodeForWave(m)))
    }
  })

  it('is total on a negative MODECT (mirrors interWaveDelay) — a valid mode byte, never NaN', () => {
    const grmodeForWave = need(w.grmodeForWave, 'grmodeForWave')
    const plane = need(w.GRMODE_PLANE, 'GRMODE_PLANE')
    const initgr = need(w.GRMODE_INITGR, 'GRMODE_INITGR')
    const v = grmodeForWave(-1) // -1 is odd → a ground slot
    expect(Number.isNaN(v)).toBe(false)
    expect([plane, initgr]).toContain(v)
    expect(v).toBe(initgr)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-4 — DISCHK forced to the MIDDLE band in ground mode (findings §2)
//
// rb4-5 AC3 correction: the ROM forces ground mode to the MIDDLE band, not the
// slowest. PFMOTN `BIT GRMODE / BPL / LDA I,40` (RBARON.MAC:3186-3188) loads
// TEMP3 = 0x40 = D6 = MIDDLE = ×0.625 — a FIXED middle feel, independent of the
// nearest object. ('far' is now the FASTEST band, ×1.0, so forcing 'far' would be
// backwards; 'near' is the slowest, ×0.375.)
// ───────────────────────────────────────────────────────────────────────────
describe('rb3-2 forced control band — ground mode pins DISCHK to MIDDLE (findings §2)', () => {
  it("the ground control band is 'mid' — the MIDDLE DISCHK band (0x40 = D6 = ×0.625)", () => {
    const band = need(f.GROUND_CONTROL_BAND, 'GROUND_CONTROL_BAND')
    expect(band).toBe('mid')
    const dischk = need(f.DISCHK, 'DISCHK')
    expect(dischk[band]).toBe(0.625)
    // 'mid' is the MIDDLE scale: strictly between the near (slow) and far (fast) bands.
    expect(dischk[band]).toBeGreaterThan(dischk.near)
    expect(dischk[band]).toBeLessThan(dischk.far)
  })

  it('ground mode forces the MIDDLE band REGARDLESS of the live nearest-object band', () => {
    const controlBand = need(f.controlBand, 'controlBand')
    const ground = need(f.GROUND_CONTROL_BAND, 'GROUND_CONTROL_BAND')
    for (const live of ALL_BANDS) {
      // even a close object (which would slow control to ×0.375) is overridden to the fixed middle.
      expect(controlBand(true, live)).toBe(ground)
    }
  })

  it('outside ground mode the live nearest-object band passes through UNCHANGED', () => {
    const controlBand = need(f.controlBand, 'controlBand')
    for (const live of ALL_BANDS) {
      expect(controlBand(false, live)).toBe(live)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-5 — forced-middle REUSES the flight.ts DISCHK plumbing (integration, keep-dev-honest)
// ───────────────────────────────────────────────────────────────────────────
describe('rb3-2 forced-middle is wired to REAL DISCHK, not a fake path (findings §2)', () => {
  const LEVEL_TURN = (proximity: ProximityBand): FlightInput => ({ turn: 1, pitch: 0, proximity })

  it('feeding controlBand(true, …) into flight.step yields the SAME result as proximity:mid', () => {
    const step = need(f.step, 'step')
    const init = need(f.INITIAL_FLIGHT, 'INITIAL_FLIGHT')
    const controlBand = need(f.controlBand, 'controlBand')
    // A close object would normally slow the turn to ×0.375; ground mode overrides it to the middle band.
    const grounded = step(init, LEVEL_TURN(controlBand(true, 'near')))
    const mid = step(init, LEVEL_TURN('mid'))
    expect(grounded.heading).toBe(mid.heading) // identical — forced-middle IS the mid band
  })

  it('ground control OVERRIDES the live band — it ignores a close object and pins the middle feel', () => {
    const step = need(f.step, 'step')
    const init = need(f.INITIAL_FLIGHT, 'INITIAL_FLIGHT')
    const controlBand = need(f.controlBand, 'controlBand')
    const grounded = step(init, LEVEL_TURN(controlBand(true, 'near')))
    const near = step(init, LEVEL_TURN('near'))
    // same yoke, same frame — ground ignores the close object, so its pan (×0.625) differs
    // from the sluggish ×0.375 a 'near' object would impose (mid pans FARTHER than near).
    expect(grounded.heading).not.toBe(near.heading)
    expect(Math.abs(grounded.heading)).toBeGreaterThan(Math.abs(near.heading))
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-6 — .LEVLS = 5 is the difficulty CEILING, not a stage count (findings §4/§3)
//        REGRESSION GUARD: this already holds (scoring.MAX_GMLEVL); rb3-2 must not
//        reinterpret .LEVLS as a count of ground stages.
// ───────────────────────────────────────────────────────────────────────────
describe('rb3-2 .LEVLS guardrail — a difficulty ceiling, not discrete stages (findings §4/§3)', () => {
  it('.LEVLS = 5 is the ceiling of the kill-indexed difficulty ramp (PLNLVL top)', () => {
    expect(MAX_GMLEVL).toBe(5)
    expect(MAX_GMLEVL).toBe(Math.max(...PLNLVL))
  })

  it('5 is a CEILING reached via kills, NOT a count of stages/levels (PLNLVL has more than 5 entries)', () => {
    // If .LEVLS were "5 stages" the table would be length 5; it is a saturating ceiling
    // over a 17-entry kill-count ramp. Guard against a stage-count reinterpretation.
    expect(PLNLVL.length).not.toBe(5)
    expect(PLNLVL.length).toBeGreaterThan(5)
  })
})

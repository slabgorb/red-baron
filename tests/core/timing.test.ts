// tests/core/timing.test.ts
//
// Story rb1-3 — RED phase (Furiosa / TEA). The frame-cadence contract.
//
// CONTRACT for GREEN (DEV): create `src/core/timing.ts` exporting the ROM's
// three time bases so the runnable cockpit's loop ticks the SIM at the
// calculation-frame rate, NOT the display rate:
//
//   export const MASTER_NMI_HZ: number      // 250   — hardware NMI, every 4 ms
//   export const CALC_FRAME_NMIS: number    // 24    — CALCNT 0x18 (gameplay)
//   export const DISPLAY_FRAME_NMIS: number // 4     — FRMECNT (shipped RBGRND)
//   export const SIM_HZ: number             // 250/24 ≈ 10.42
//   export const DISPLAY_HZ: number         // 250/4  = 62.5
//   export const SIM_TIMESTEP_S: number     // 24/250 = 0.096  (96 ms fixed step)
//
// WHY THIS EXISTS — THE FIDELITY TRAP (findings §1, the load-bearing timing fact):
//   Red Baron has three clocks: a 250 Hz master NMI, a 62.5 Hz VG display refresh
//   (FRMECNT=4), and a ~10.42 Hz GAME-LOGIC / calculation frame (CALCNT=0x18=24 →
//   96 ms). The sim advances ONE step per calc-frame while the picture redraws at
//   62.5 Hz. Ticking the sim per display frame runs it ~6× too fast — the Red
//   Baron analogue of the Asteroids ÷4 trap (there the multiplier was 4; here
//   it's 62.5/10.42 ≈ 6). This module pins the constants so the loop can't fall
//   into it. Cite: RBGRND.MAC:61,102,221-235; RBARON.MAC:620.
//
// Foundation-scoped: rb1-3 owns the CADENCE CONSTANTS (the runnable cockpit loop
// needs a tick rate); the sub-dividers that key off them (enemy-shell ÷4, plane
// fire ÷2, shell sub-step ×4 — findings §1/§3) belong to rb2's combat.

import { describe, it, expect, beforeAll } from 'vitest'

interface TimingModule {
  MASTER_NMI_HZ?: number
  CALC_FRAME_NMIS?: number
  DISPLAY_FRAME_NMIS?: number
  SIM_HZ?: number
  DISPLAY_HZ?: number
  SIM_TIMESTEP_S?: number
}

let t: TimingModule = {}

beforeAll(async () => {
  try {
    t = (await import('../../src/core/timing')) as TimingModule
  } catch {
    t = {}
  }
})

function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`src/core/timing.ts must export ${name} (rb1-3 RED contract)`)
  }
  return value
}

describe('timing — the three ROM clocks (findings §1)', () => {
  it('MASTER_NMI_HZ === 250 (hardware NMI every 4 ms — RBGRND.MAC:102)', () => {
    expect(need(t.MASTER_NMI_HZ, 'MASTER_NMI_HZ')).toBe(250)
  })

  it('CALC_FRAME_NMIS === 24 (CALCNT 0x18, the gameplay calc frame — RBARON.MAC:620)', () => {
    expect(need(t.CALC_FRAME_NMIS, 'CALC_FRAME_NMIS')).toBe(24)
  })

  it('DISPLAY_FRAME_NMIS === 4 (FRMECNT, shipped RBGRND — RBGRND.MAC:61)', () => {
    expect(need(t.DISPLAY_FRAME_NMIS, 'DISPLAY_FRAME_NMIS')).toBe(4)
  })
})

describe('timing — derived rates', () => {
  it('SIM_HZ === MASTER_NMI_HZ / CALC_FRAME_NMIS ≈ 10.42 (the gameplay rate)', () => {
    expect(need(t.SIM_HZ, 'SIM_HZ')).toBeCloseTo(250 / 24, 4)
  })

  it('DISPLAY_HZ === MASTER_NMI_HZ / DISPLAY_FRAME_NMIS === 62.5 (VG refresh)', () => {
    expect(need(t.DISPLAY_HZ, 'DISPLAY_HZ')).toBeCloseTo(62.5, 6)
  })

  it('SIM_TIMESTEP_S ≈ 0.096 (96 ms — the fixed sim step the loop must use)', () => {
    expect(need(t.SIM_TIMESTEP_S, 'SIM_TIMESTEP_S')).toBeCloseTo(0.096, 6)
  })
})

describe('timing — the ÷N fidelity trap guard (do not tick the sim at display rate)', () => {
  it('the sim rate is NOT the display rate — they are distinct clocks', () => {
    const sim = need(t.SIM_HZ, 'SIM_HZ')
    const display = need(t.DISPLAY_HZ, 'DISPLAY_HZ')
    expect(sim).not.toBeCloseTo(display, 1)
  })

  it('display/sim ≈ 6 — ticking motion per display frame runs the sim ~6× too fast', () => {
    // The named trap. If a future refactor "simplifies" the loop to one tick per
    // rendered frame, this ratio collapses to 1 and the guard fires.
    const ratio = need(t.DISPLAY_HZ, 'DISPLAY_HZ') / need(t.SIM_HZ, 'SIM_HZ')
    expect(ratio).toBeCloseTo(6, 1) // 62.5 / 10.4166… = 6 exactly
  })

  it('SIM_TIMESTEP_S is the reciprocal of SIM_HZ (self-consistent step ↔ rate)', () => {
    expect(need(t.SIM_TIMESTEP_S, 'SIM_TIMESTEP_S') * need(t.SIM_HZ, 'SIM_HZ')).toBeCloseTo(1, 9)
  })
})

// tests/core/ground-collision.test.ts
//
// Story rb4-4 — RED phase (TEA). GROUND COLLISION (GREND / PLYCOL). You cannot fly
// into a mountain in the shipped clone; the ROM makes it lethal, and gates the whole
// playfield update on the flag: `BIT GREND / BVS 20$ ;PLAYER RAN INTO GROUND` runs
// BEFORE `JSR PFMOTN ;UPDATE PLAYFIELD` (RBARON.MAC:783-785) — death freezes motion.
// The collision itself is "STANDARD PLAYER COLLISION DETECT" (PLYCOL,
// RBARON.MAC:3946-3991): the mountain's silhouette POINTS are tested against a
// window around the player's position (PCDX = 0xC1 "PF CD X MIN", :457; PCDY = 0x60,
// :458), and it is only consulted at all once the mountain is CLOSE — the caller
// gates on the object's 16-bit depth against 0x0201 (`LDA OBJECT+4 / CMP I,1 /
// LDA OBJECT+5 / SBC I,2 / BCS 29$`, :4634-4638) before `JSR PLYCOL` (:4641), and a
// hit stores `D6=GROUND COLLISION` (`ORA I,0C0 / STA GREND`, :4643-4645).
//
// CONTRACT for the GREEN phase (Dev): create `src/core/ground-collision.ts`, a PURE
// module (no DOM, no time, no randomness) exporting:
//
//   // The 16-bit depth gate (:4634-4638). BEWARE the two-byte idiom — the same
//   // CPY/SBC staircase landscape.ts's MIN_DEPTH was mis-read through (0x01C0, not
//   // 0xC0): the constant here is (0x02 << 8) | 0x01 = 0x0201, and the carry-set
//   // branch means collision is only tested at depth <= 0x0200.
//   export const PLAYER_COLLISION_DEPTH = 0x0201
//
//   // One calc-frame collision test: does any ACTIVE mountain, inside the depth
//   // gate, put silhouette geometry over the player (laterally at the player's
//   // window centre, vertically at/above the eye)? Total over degenerate input.
//   export function groundCollision(eyeHeight: number, mountains: readonly Mountain[]): boolean
//
// UNITS NOTE (logged as a Delivery Finding): the silhouette heights are the SCAPE
// picture units (peaks ~24) while the live eye is I4YPOS/4 (~132) — those two scales
// only meet through the projection that story rb4-5 is rewriting (I4YPOS is
// subtracted from object Y before the divide, RBGRND.MAC:277-283). These tests
// therefore stage BOTH sides of every boundary in the mountain's own units and pin
// the RELATIONS (gate, lane, altitude, activity); the unit bridge is Dev's citation
// call, coordinated with rb4-5.

import { describe, it, expect } from 'vitest'
import { PLAYER_COLLISION_DEPTH, groundCollision } from '../../src/core/ground-collision'
import { SCAPES } from '../../src/core/topology'
import type { Mountain } from '../../src/core/landscape'

/** A staged mountain: scape 0 (peak 24 at x=-104/-88), placed by depth and lane. */
const mountain = (depth: number, x = 0, scape = 0, active = true): Mountain =>
  ({ scape, depth, x, active, onHorizon: depth >= 0x1000 }) // rb4-8: latched bit; collision ignores it

/** The tallest silhouette point of a scape — the staging peak. */
const peakOf = (scape: number): number => Math.max(...SCAPES[scape].map((p) => p[1]))

describe('the depth gate is the 16-bit constant, not its low byte (RBARON.MAC:4634-4638)', () => {
  it('PLAYER_COLLISION_DEPTH = 0x0201 — the CMP I,1 / SBC I,2 pair', () => {
    expect(PLAYER_COLLISION_DEPTH).toBe(0x0201)
    expect(PLAYER_COLLISION_DEPTH).not.toBe(0x01) // the CMP operand alone
    expect(PLAYER_COLLISION_DEPTH).not.toBe(0x02) // the SBC operand alone
  })
})

describe('groundCollision — the PLYCOL relations (RBARON.MAC:3946-3991)', () => {
  const peak = peakOf(0)
  const belowPeak = peak - 10 // an eye INSIDE the silhouette
  const abovePeak = peak + 10 // an eye safely OVER the mountain

  it('a close mountain over the player, flown into below its peak, collides', () => {
    expect(groundCollision(belowPeak, [mountain(0x0200)])).toBe(true)
  })

  it('the same mountain OUTSIDE the depth gate cannot collide — it is never even tested (:4634-4638)', () => {
    expect(groundCollision(belowPeak, [mountain(0x0201)])).toBe(false) // BCS skips at equality
    expect(groundCollision(belowPeak, [mountain(0x1000)])).toBe(false) // on the horizon
  })

  it('at depth 0x0200 — one inside the gate — the test runs (the boundary is 0x0201, not 0x0201+1)', () => {
    expect(groundCollision(belowPeak, [mountain(0x0200)])).toBe(true)
    expect(groundCollision(belowPeak, [mountain(0x0100)])).toBe(true)
  })

  it('flying ABOVE the peak clears it — altitude is the escape (the Y half of PLYCOL)', () => {
    expect(groundCollision(abovePeak, [mountain(0x0200)])).toBe(false)
  })

  it('a mountain fully off to one side never collides — the lateral window (PCDX) has a far side', () => {
    // The widest scape spans ±128; a lane 3072 out (PFOBIZ_X's outer lane) cannot
    // reach the player's window no matter how the PCDX transcription lands.
    expect(groundCollision(belowPeak, [mountain(0x0200, 3072)])).toBe(false)
    expect(groundCollision(belowPeak, [mountain(0x0200, -3072)])).toBe(false)
  })

  it('an inactive slot is dead geometry (D7 of the PFOBJ status — no test, no crash)', () => {
    expect(groundCollision(belowPeak, [mountain(0x0200, 0, 0, false)])).toBe(false)
  })

  it('is total: an empty sky, a NaN depth, and a NaN eye all read as "no collision"', () => {
    expect(groundCollision(belowPeak, [])).toBe(false)
    expect(groundCollision(belowPeak, [mountain(Number.NaN)])).toBe(false)
    expect(groundCollision(Number.NaN, [mountain(0x0200)])).toBe(false)
  })

  it('ANY colliding mountain in the list is enough (the ROM tests every PF object slot)', () => {
    const clear = mountain(0x0200, 3072)
    const deadly = mountain(0x0200, 0)
    expect(groundCollision(belowPeak, [clear, deadly])).toBe(true)
  })
})

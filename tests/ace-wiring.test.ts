// tests/ace-wiring.test.ts
//
// Story rb4-4 — RED phase (TEA). AC-1: THE RETURNING ACE IS WIRED, NOT SHELVED.
// `src/core/returning-ace.ts` — the signature mechanic, whose evade logic the
// audit's refuter confirmed CORRECT — is imported by NO source file. The ROM
// drives its check from the calc-frame loop itself: `JSR EOLSEQ ;END OF LIFE
// SEQUENCE` (RBARON.MAC:825) runs every calculation frame, and inside it the
// returning plane's attack resolves against the player's live bank
// (:1078-1094 — the ENSIDE/PLDELX test, BEFLAG's "FIRST TIME FREE", the 50/50).
//
// THE OBSERVABLE (the rb4-1 lesson — IMPORTED IS NOT OBEYED, so no import scan):
// this file boots the REAL cockpit (tests/helpers/boot-cockpit.ts), taps
// core/returning-ace with a DELEGATING recorder (the real module, watched), and
// flies a hands-off run long enough for the shipped sim's own wave to close to
// the P.MNDP floor (~977 calc frames at level 0: (4224-320)/4). What is asserted
// is what the booted loop actually DID: the module was consulted at the
// calc-frame cadence, the pass began when the plane reached the floor, the first
// dodge was the BEFLAG freebie, the attacks REPEAT, and a 'hit' verdict cost the
// pilot something the player can hear (the CRSHSN crash).
//
// AC-1 pins the DRIVE and the REACH. rb4-6 ROUND 3 adds the CADENCE: WO.RTN now
// seeds the PLSTAT+7 counter (`STA PLSTAT+7`, :2736-2737) that the evade check
// resolves at 0x0C (:1078-1080), so the WO.RTN − ACE_ATTACK_FRAMES = 4-frame
// re-entry delay is wired behaviour and is pinned below. The round-2 guard for it
// was a binding-shape regex (`/aceCountdown\s*=\s*\w+/` over main.ts — the assignment,
// not its value) — provably green with the wiring reverted (review round 2) — so the
// delay is now asserted from the recorded frame numbers. See the AC-5 note at its pin.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { bootCockpit } from './helpers/boot-cockpit'
import { WO_RTN } from '../src/core/enemy'
import { ACE_ATTACK_FRAMES } from '../src/core/returning-ace'
import type { ReturningAce, EvadeResult } from '../src/core/returning-ace'

// ─── the delegating taps ──────────────────────────────────────────────────────

const rec = vi.hoisted(() => ({
  frame: 0,
  closesPast: [] as Array<{ frame: number; depth: number; result: boolean }>,
  beginPass: [] as Array<{ frame: number; side: -1 | 1 }>,
  evade: [] as Array<{ frame: number; turnRate: number; result: string; firstPassBefore: boolean; firstPassAfter: boolean }>,
  framesConsulted: new Set<number>(),
  crashes: [] as number[],
  reset(): void {
    this.frame = 0
    this.closesPast = []
    this.beginPass = []
    this.evade = []
    this.framesConsulted = new Set()
    this.crashes = []
  },
}))

vi.mock('../src/core/returning-ace', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/core/returning-ace')>()
  return {
    ...real,
    closesPast(depth: number): boolean {
      const result = real.closesPast(depth)
      rec.closesPast.push({ frame: rec.frame, depth, result })
      rec.framesConsulted.add(rec.frame)
      return result
    },
    beginPass(side: -1 | 1): ReturningAce {
      rec.beginPass.push({ frame: rec.frame, side })
      rec.framesConsulted.add(rec.frame)
      return real.beginPass(side)
    },
    evadeCheck(ace: ReturningAce, turnRate: number, roll: number): { result: EvadeResult; ace: ReturningAce } {
      const out = real.evadeCheck(ace, turnRate, roll)
      rec.evade.push({
        frame: rec.frame,
        turnRate,
        result: out.result,
        firstPassBefore: ace.firstPass,
        firstPassAfter: out.ace.firstPass,
      })
      rec.framesConsulted.add(rec.frame)
      return out
    },
  }
})

vi.mock('../src/shell/audio', () => ({
  createAudioEngine: () => ({
    resume: () => {},
    play: (name: string) => {
      if (name === 'crash') rec.crashes.push(rec.frame)
    },
    playTone: () => {},
    setEngine: () => {},
    setGun: () => {},
    setApproach: () => {},
  }),
}))

// ─── the flight plan: hands-off, one lone plane boring in to the floor ────────

/** Probe-calibrated seed: the opening decision spawns a LONE plane at calc frame 2. */
const SEED_MS = 12345
/** Level-0 close rate is PLPOSZ[0] = -4/frame: floor at ~(4224-320)/4 + 2 ≈ frame 978. */
const RUN_FRAMES = 1300
const FLOOR_WINDOW: readonly [number, number] = [900, 1150]

let firstWaveFrame = 0

beforeAll(async () => {
  rec.reset()
  const cockpit = await bootCockpit(1600, 900, SEED_MS)
  for (let f = 1; f <= RUN_FRAMES; f++) {
    rec.frame = f
    cockpit.tick() // 96 ms — exactly one calc frame per display frame
  }
  firstWaveFrame = 2 // the opening decision (probe-calibrated; asserted loosely below)
}, 60000)

afterAll(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AC-1: the returning ace is DRIVEN from the booted sim (EOLSEQ every calc frame, :825)', () => {
  it('the module is consulted at all — zero calls means the mechanic is still dead code', () => {
    const total = rec.closesPast.length + rec.beginPass.length + rec.evade.length
    expect(
      total,
      'src/core/returning-ace.ts was never invoked by the booted cockpit across ' +
        `${RUN_FRAMES} calc frames — the signature mechanic is still shelved.`,
    ).toBeGreaterThan(0)
  })

  it('…and consulted at the calc-frame cadence, not once at boot (JSR EOLSEQ is per-frame)', () => {
    // From the opening wave to the end of the run, ≥90% of calc frames must consult
    // the module (the decision frames between waves may legitimately skip).
    const span = RUN_FRAMES - firstWaveFrame
    expect(rec.framesConsulted.size).toBeGreaterThan(span * 0.9)
  })

  it('the fly-by becomes a PASS when the plane reaches the P.MNDP floor (P.UPD0, :2727)', () => {
    expect(rec.beginPass.length, 'no pass ever began — closesPast never fired a beginPass').toBeGreaterThan(0)
    const first = rec.beginPass[0]
    expect(first.frame).toBeGreaterThanOrEqual(FLOOR_WINDOW[0])
    expect(first.frame).toBeLessThanOrEqual(FLOOR_WINDOW[1])
    expect([-1, 1]).toContain(first.side)
    // the trigger is the module's own: closesPast must have answered true by then
    const firstTrue = rec.closesPast.find((c) => c.result)
    expect(firstTrue, 'beginPass fired but closesPast never returned true').toBeDefined()
    expect((firstTrue as { frame: number }).frame).toBeLessThanOrEqual(first.frame)
  })

  it('the first dodge is the BEFLAG freebie — hands-off, level flight, and it is EVADED (:1088-1094)', () => {
    expect(rec.evade.length, 'the evade check was never REACHED').toBeGreaterThan(0)
    const first = rec.evade[0]
    expect(first.result).toBe('evaded')
    expect(first.firstPassBefore).toBe(true)
    expect(first.firstPassAfter, 'the BEFLAG freebie must be CONSUMED by the first attack').toBe(false)
    // a free dodge costs nothing the player can hear
    expect(rec.crashes.filter((c) => Math.abs(c - first.frame) <= 2)).toHaveLength(0)
  })

  it('the attacks REPEAT — one freebie, then 50/50 "thereafter" implies a second attack exists', () => {
    expect(rec.evade.length).toBeGreaterThanOrEqual(2)
    expect(rec.evade.slice(1).every((e) => !e.firstPassBefore)).toBe(true)
  })

  it('rb4-6 R3: the WO.RTN re-entry delay is WIRED — first attack lands exactly WO_RTN − 0x0C frames after arming', () => {
    // The ROM's one mechanism, two constants: the fly-past seeds PLSTAT+7 = WO.RTN = 0x10
    // ("DISABLE PLANE FOR WO.RTN FRAMES", :2736-2737) and the evade check resolves on the
    // frame the same counter reads 0x0C (`LDA PLSTAT+7 / CMP I,0C / BNE 25$`, :1078-1080).
    // The delay between arming and the first attack is therefore WO_RTN − ACE_ATTACK_FRAMES
    // = 4 calc frames — a BEHAVIOUR, not an import. (rb4-16 names the round-2 guard AC-5 indicts:
    // it was a `?raw` binding-SHAPE regex over main.ts — `/aceCountdown\s*=\s*\w+/`, matching the
    // assignment but not its RHS VALUE. That is why the review proved it green with every
    // `aceCountdown = WO_RTN` site reverted to `aceCountdown = ACE_ATTACK_FRAMES`, which collapses
    // the delay to 1 frame: the regex sees `aceCountdown = <identifier>` either way and cannot tell
    // 4 from 1. This pins the recorded frame numbers instead — the behaviour a regex can't read.)
    const delay = WO_RTN - ACE_ATTACK_FRAMES
    expect(delay, 'the two constants no longer differ by the ROM gap — re-derive :2736 vs :1078').toBe(4)
    expect(rec.beginPass.length).toBeGreaterThan(0)
    expect(rec.evade.length).toBeGreaterThan(0)
    expect(
      rec.evade[0].frame - rec.beginPass[0].frame,
      `the first attack resolved ${rec.evade[0].frame - rec.beginPass[0].frame} frames after arming — ` +
        `the WO.RTN seed (:2736) is not driving the 0x0C resolve (:1078); the re-entry delay is ${delay}`,
    ).toBe(delay)
    // The SHIPPED repeat cadence is the same 4-frame reseed. This is a KNOWN divergence from
    // the ROM (which resolves ONCE per fly-past — the `BNE 25$` fires at exactly 0x0C, then the
    // counter runs to 0 and the slot re-enters a new plane; logged as a Delivery Finding). If a
    // successor ports the once-per-pass shape, re-seat this line CONSCIOUSLY — do not delete it.
    expect(
      rec.evade[1].frame - rec.evade[0].frame,
      'the repeat cadence moved — the reseed no longer comes from WO_RTN',
    ).toBe(delay)
  })

  it("every 'hit' verdict costs the pilot — the CRSHSN crash follows within two calc frames", () => {
    // Hands-off the post-freebie attacks ride the 50/50; whichever way the seeded
    // rolls land, a recorded 'hit' MUST reach the damage channel (rb2-9 loseLife →
    // the player-hit event → the crash). A hit that costs nothing is the old bug
    // wearing new wiring.
    // REVIEW ROUND 1: the antecedent must be NON-EMPTY or this implication guard
    // is vacuous (mutation-proven: removing the attack path emptied it silently).
    expect(
      rec.evade.filter((v) => v.result === 'hit').length,
      'no hit verdict was ever recorded — the implication below would assert nothing',
    ).toBeGreaterThan(0)
    for (const e of rec.evade.filter((v) => v.result === 'hit')) {
      expect(
        rec.crashes.some((c) => c >= e.frame && c <= e.frame + 2),
        `evadeCheck returned 'hit' at calc frame ${e.frame} and no crash followed — ` +
          'the verdict is being computed and thrown away.',
      ).toBe(true)
    }
  })

  it('the evade check reads the LIVE turn rate (PLDELX), not a stale or fabricated one', () => {
    // Hands-off the yoke is centred the whole run: every consulted turnRate must be 0.
    // (POT.X ease keeps turnRate at 0 with no input — a nonzero here means the wiring
    // invented a bank.) The non-emptiness pin keeps the `every` from going vacuous
    // (review round 1 — same class as the hit-implication guard above).
    expect(rec.evade.length).toBeGreaterThan(0)
    expect(rec.evade.every((e) => e.turnRate === 0)).toBe(true)
  })
})

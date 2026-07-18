// tests/core/mission-clock.test.ts
//
// Story rb4-7 — RED phase (O'Brien / TEA). "THE MISSION CLOCK": the kill-driven
// difficulty ramp runs TWICE AS FAST as the arcade's, and waves come in RUNS, not the
// 1:1 air/ground alternation we ship. Cluster C6 (MI-003/004/005/007/008/009, CB-001,
// CD-009). Every ROM citation below is against the CITABLE byte-of-record
// ~/Projects/red-baron-source-text/RBARON.MAC (LF-only, 6293 lines, `.RADIX 16` from
// :74). The CRLF sibling reference/red-baron/ is NOT citable (staircase line drift).
//
// ── AC-1  GMLEVL = PLNLVL[min(OBJKLD >> 1, 0x10)]  (RBARON.MAC:2399-2408) ──────────
//
//   PLNZD0: LDX I,10        ; default index = 0x10 = 16 (HEX — .RADIX 16)
//           LDA OBJKLD+1
//           BNE 2$          ; kills >= 256 -> clamp
//           LDA OBJKLD
//           LSR             ; >> 1  — the ROM HALVES the kill count before the lookup
//           CMP I,10        ; compare (kills>>1) with 0x10 = 16
//           BCS 2$          ; (kills>>1) >= 16 -> clamp
//           TAX
//   2$:     LDA AX,PLNLVL   ; A = PLNLVL[ min(kills>>1, 16) ]
//           STA GMLEVL
//   PLNLVL: .BYTE 0,0,0,0,1,2,2,2,3,3,3,4,4,4,4,4,5    (:2478 — 17 entries, idx 0..16)
//
// scoring.ts today does `PLNLVL[min(objkld, 16)]` — no `>> 1`. So it takes HALF the kills
// to reach any level: our sky ramps twice as fast. The fix is one shift; this file pins the
// contrast so nobody re-introduces the direct index.
//
// ── AC-2 / AC-3  the MODECT / MCOUNT / NEWCT wave-run schedule  (RBARON.MAC:2258-2273) ─
//
//   20$: DEC NEWCT          ; NEWCT is decremented once per COMPLETED wave (three gates
//        BNE 22$            ;   above it: :2242 flight/explosion, :2244 plane-count, :2253
//        INC MODECT         ;   score-wait) — it counts WAVES, not calc frames.
//        LDA MODECT
//        AND I,0F           ; MODECT wraps modulo 16
//        STA MODECT
//        LSR                ; carry = new MODECT LSB
//        TAX                ; X = MODECT >> 1
//        LDA AX,MCOUNT      ; MCOUNT is indexed by MODECT >> 1
//        BCC 21$            ; MODECT even (plane) -> NEWCT = MCOUNT[MODECT>>1]  (a RUN)
//        LDA I,1            ; MODECT odd  (ground) -> NEWCT = 1                 (one wave)
//   21$: STA NEWCT
//   22$: LDA MODECT / LSR / BCC STPLNE / JMP INITGR   ; even = plane wave, odd = ground
//   MCOUNT: .BYTE 4,2,3,2,1,3,4,2    (:1298 — 8 entries, idx 0..7)
//   GMINIT: STX MODECT / LDA AX,MCOUNT / STA NEWCT    (:1220-1222 — opens MODECT 0, NEWCT 4)
//
// So a plane MODE fields a RUN of MCOUNT[MODECT>>1] plane waves, each ground MODE fields
// exactly ONE ground wave: run lengths 4,2,3,2,1,3,4,2 across MODECT 0,2,4,6,8,10,12,14.
// waves.ts today reads MCOUNT[modect % 8] as a per-CALC-FRAME countdown and steps MODECT
// on EVERY wave, giving a 1:1 P,G,P,G alternation with a 96-384 ms gap. Both are wrong.
//
// ── AC-4  ground mode ends on a CONDITION, not a timer  (RBARON.MAC:3269-3293, 1403-1404) ─
//
//   INITGR:  LDA I,2 / STA GRNDCT              (:1403-1404 — a ground wave deploys 2 groups)
//   PFOBMN:  LDA GRNDCT / BNE 10$              ; GRNDCT != 0  -> ground mode CONTINUES
//            <OR-fold PFOBJ+8/9/A status over N.PFOB objects> / AND I,0C0 ";CHECK FOR
//            VISIBLE GROUND OBJECTS" / BNE 10$ ; any visible ground object -> CONTINUES
//            ... STA GRMODE / STA PLSTAT+7 ";START PLANES NEXT FRAME"   ; else -> ENDS
//
// Ground mode ends only when GRNDCT is spent AND no ground object is still visible — never
// on a countdown. Our ground slot is a ~0.4 s no-op wait (one tick of the buggy frame clock).
// NOTE (routed to rb4-11): the VISIBLE-ground-object set is the PFOBJ table rb4-11 adds; until
// then the visible count is 0 and the condition reduces to "GRNDCT spent". This file pins the
// end CONDITION and GRNDCT's initial value; the object lifecycle is rb4-11's.
//
// ── CONTRACT for GREEN (Julia / DEV) ──────────────────────────────────────────────
//   src/core/scoring.ts:
//     gmlevlForKills(objkld): GMLEVL = PLNLVL[min(objkld >> 1, PLNLVL.length-1)]  (AC-1)
//   src/core/waves.ts:
//     interface WaveClock { readonly modect: number; readonly newct: number }   (AC-2/3)
//     const INITIAL_WAVE_CLOCK: WaveClock                 // { modect: 0, newct: MCOUNT[0]=4 }
//     function stepWaveClock(clock): { clock: WaveClock; spawnPlaneWave: boolean }
//        // called ONCE PER COMPLETED WAVE. DEC newct; on 0 -> modect=(modect+1)&0x0F and
//        // newct = isPlaneWave(modect) ? MCOUNT[modect>>1] : 1. spawnPlaneWave = the type
//        // of the NEXT wave to field (isPlaneWave of the post-step modect).
//     const GRNDCT_INITIAL: number                        // 2  (INITGR)                (AC-4)
//     function groundModeEnds(grndct: number, visibleGroundObjects: number): boolean
//        // grndct === 0 && visibleGroundObjects === 0   (PFOBMN) — never a timer

import { describe, it, expect, beforeAll } from 'vitest'

// ── the RED contract, kept out of the static import graph (guns.test.ts house pattern) ──

interface WaveClock {
  readonly modect: number
  // Optional so the module cast bridges the current source's WaveClock (still `countdown`)
  // during RED — `need()`/assertions catch the missing NEWCT at runtime, not tsc.
  readonly newct?: number
}

interface ScoringModule {
  PLNLVL?: readonly number[]
  gmlevlForKills?: (objkld: number) => number
}

interface WavesModule {
  MCOUNT?: readonly number[]
  isPlaneWave?: (modect: number) => boolean
  INITIAL_WAVE_CLOCK?: WaveClock
  stepWaveClock?: (clock: WaveClock) => { clock: WaveClock; spawnPlaneWave: boolean }
  GRNDCT_INITIAL?: number
  groundModeEnds?: (grndct: number, visibleGroundObjects: number) => boolean
}

let scoring: ScoringModule = {}
let waves: WavesModule = {}

beforeAll(async () => {
  try {
    scoring = (await import('../../src/core/scoring')) as ScoringModule
  } catch {
    scoring = {}
  }
  try {
    // The module's `WaveClock` is `{modect, newct}`, which structurally satisfies this file's
    // `{modect, newct?}` contract, so a single cast type-checks — keeping the compiler's drift
    // protection between this test and src/core/waves.ts. `need()` verifies each export at runtime.
    waves = (await import('../../src/core/waves')) as WavesModule
  } catch {
    waves = {}
  }
})

function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`rb4-7 RED contract: missing export ${name}`)
  return value
}

/** The ROM PLNLVL table (RBARON.MAC:2478) — 17 entries, index = min(OBJKLD>>1, 16). */
const PLNLVL_ROM: readonly number[] = [0, 0, 0, 0, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 4, 4, 5]

/** The ROM MCOUNT table (RBARON.MAC:1298) — 8 entries, index = MODECT>>1. */
const MCOUNT_ROM: readonly number[] = [4, 2, 3, 2, 1, 3, 4, 2]

/** GMLEVL the ROM computes for a kill count: PLNLVL[ min(kills>>1, 16) ]. */
const romGmlevl = (kills: number): number => PLNLVL_ROM[Math.min(kills >> 1, PLNLVL_ROM.length - 1)]

// ═══════════════════════════════════════════════════════════════════════════════
// AC-1 — the kill count is HALVED before the PLNLVL lookup (RBARON.MAC:2399-2408)
// ═══════════════════════════════════════════════════════════════════════════════
describe('rb4-7 AC-1 — GMLEVL = PLNLVL[min(OBJKLD>>1, 0x10)] (the ROM HALVES the kills)', () => {
  it('every kill count maps to PLNLVL indexed by kills>>1 — not by kills directly', () => {
    const gmlevl = need(scoring.gmlevlForKills, 'scoring.gmlevlForKills')
    for (let k = 0; k <= 40; k++) {
      expect(gmlevl(k)).toBe(romGmlevl(k))
    }
  })

  it('THE HEADLINE — reaching a level takes TWICE the kills it takes today', () => {
    // gmlevlForKills(2k) === PLNLVL[k]: the difficulty we USED to reach at k kills now
    // takes 2k. The single invariant that refutes the direct index. It fails hard on the
    // shipped `PLNLVL[min(k,16)]`, which reaches PLNLVL[k] at k kills, not 2k.
    const gmlevl = need(scoring.gmlevlForKills, 'scoring.gmlevlForKills')
    for (let k = 0; k <= PLNLVL_ROM.length - 1; k++) {
      expect(gmlevl(2 * k)).toBe(PLNLVL_ROM[k])
    }
  })

  it('specific rungs move to twice the kills: 4→0, 8→1, 16→3 (was 4→1, 8→3, 16→5)', () => {
    const gmlevl = need(scoring.gmlevlForKills, 'scoring.gmlevlForKills')
    expect(gmlevl(4)).toBe(0) // PLNLVL[2]  — was 1 (PLNLVL[4])
    expect(gmlevl(8)).toBe(1) // PLNLVL[4]  — was 3 (PLNLVL[8])
    expect(gmlevl(16)).toBe(3) // PLNLVL[8] — was 5 (PLNLVL[16])
  })

  it('the >>1 collapses adjacent kill counts in pairs — 2k and 2k+1 share a level (the LSR drops the LSB)', () => {
    const gmlevl = need(scoring.gmlevlForKills, 'scoring.gmlevlForKills')
    for (let k = 0; k <= 16; k++) {
      expect(gmlevl(2 * k)).toBe(gmlevl(2 * k + 1))
    }
  })

  it('the clamp is 0x10 = 16 on kills>>1 — MAX only at 32 kills, and 31 is still one below', () => {
    // "Test the wave after the last row": the clamp bites at kills>>1 === 16, i.e. kills === 32.
    const gmlevl = need(scoring.gmlevlForKills, 'scoring.gmlevlForKills')
    const max = Math.max(...PLNLVL_ROM) // 5
    expect(gmlevl(30)).toBe(4) // PLNLVL[15]
    expect(gmlevl(31)).toBe(4) // PLNLVL[15] — 31>>1 = 15, still below the clamp
    expect(gmlevl(32)).toBe(max) // PLNLVL[16] — 32>>1 = 16, the clamp/last rung
    expect(gmlevl(33)).toBe(max)
    for (const k of [64, 100, 10_000]) expect(gmlevl(k)).toBe(max) // never overruns the table
  })

  it('the shipped direct-index kills too early — proof the halve is REQUIRED, not cosmetic', () => {
    // A direct index would give a strictly HIGHER level than the ROM at some kill count.
    // If gmlevlForKills ever equals PLNLVL[k] (the direct read) where PLNLVL[k>>1] differs,
    // the halve is missing. Pin the first divergence: 8 kills.
    const gmlevl = need(scoring.gmlevlForKills, 'scoring.gmlevlForKills')
    const directIndex = PLNLVL_ROM[Math.min(8, PLNLVL_ROM.length - 1)] // = 3, the buggy value
    expect(gmlevl(8)).not.toBe(directIndex) // must be 1, not 3
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-2 / AC-3 — MODECT/MCOUNT/NEWCT: waves come in RUNS, NEWCT counts WAVES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Drive the schedule the way the game does: field the opening wave (MODECT 0), then call
 * stepWaveClock once per COMPLETED wave, collecting the type of each fielded wave. Returns
 * `true` for a plane wave, `false` for a ground wave. Interface-light — it only assumes the
 * stepWaveClock contract in this file's header.
 */
function fieldedWaveTypes(
  step: (c: WaveClock) => { clock: WaveClock; spawnPlaneWave: boolean },
  isPlane: (m: number) => boolean,
  init: WaveClock,
  count: number,
): boolean[] {
  const types: boolean[] = [isPlane(init.modect)] // the opening wave, fielded at boot
  let clock = init
  for (let i = 1; i < count; i++) {
    const r = step(clock)
    clock = r.clock
    types.push(r.spawnPlaneWave)
  }
  return types
}

/** Collapse a wave-type stream into plane-run lengths (grounds are the single separators). */
function planeRunLengths(types: readonly boolean[]): number[] {
  const runs: number[] = []
  let run = 0
  for (const isPlane of types) {
    if (isPlane) {
      run += 1
    } else {
      runs.push(run)
      run = 0
    }
  }
  if (run > 0) runs.push(run)
  return runs
}

describe('rb4-7 AC-2 — MCOUNT is indexed by MODECT>>1, ground reloads NEWCT=1, MODECT mod 16', () => {
  it('the opening clock is MODECT 0 with the full run loaded — { modect: 0, newct: MCOUNT[0] = 4 }', () => {
    const init = need(waves.INITIAL_WAVE_CLOCK, 'waves.INITIAL_WAVE_CLOCK')
    expect(init.modect).toBe(0)
    expect(init.newct).toBe(MCOUNT_ROM[0]) // 4 — GMINIT loads MCOUNT[0], not a frame countdown
  })

  it('a plane MODE runs MCOUNT[MODECT>>1] waves — NOT MCOUNT[MODECT] (the shipped mis-index)', () => {
    // Run length for MODECT 2 is MCOUNT[1] = 2, not MCOUNT[2] = 3. That single value separates
    // the ROM's `>>1` index from the shipped `% 8` index.
    const step = need(waves.stepWaveClock, 'waves.stepWaveClock')
    const isPlane = need(waves.isPlaneWave, 'waves.isPlaneWave')
    const init = need(waves.INITIAL_WAVE_CLOCK, 'waves.INITIAL_WAVE_CLOCK')
    const runs = planeRunLengths(fieldedWaveTypes(step, isPlane, init, 30))
    // First eight plane-mode run lengths = MCOUNT read at even MODECT (>>1): the table itself.
    expect(runs.slice(0, MCOUNT_ROM.length)).toEqual([...MCOUNT_ROM])
    // Guard the discriminating value explicitly: MODECT 2's run is 2 (MCOUNT[1]), never 3.
    expect(runs[1]).toBe(2)
  })

  it('a ground wave reloads NEWCT = 1 — every ground MODE fields exactly ONE wave', () => {
    // No two ground waves ever land back-to-back, and no plane run is interrupted by more
    // than a single ground wave. (odd MODECT -> LDA I,1, RBARON.MAC:2268.)
    const step = need(waves.stepWaveClock, 'waves.stepWaveClock')
    const isPlane = need(waves.isPlaneWave, 'waves.isPlaneWave')
    const init = need(waves.INITIAL_WAVE_CLOCK, 'waves.INITIAL_WAVE_CLOCK')
    const types = fieldedWaveTypes(step, isPlane, init, 40)
    for (let i = 1; i < types.length; i++) {
      expect(types[i] === false && types[i - 1] === false).toBe(false) // never two grounds in a row
    }
  })

  it('MODECT wraps modulo 16 — the run structure repeats after 16 modes (8 plane runs)', () => {
    // A full cycle is MODECT 0..15 -> plane runs [4,2,3,2,1,3,4,2] with 8 ground singles,
    // 29 waves; then MODECT 15 -> 0 (AND I,0F) and the very same run sequence repeats.
    const step = need(waves.stepWaveClock, 'waves.stepWaveClock')
    const isPlane = need(waves.isPlaneWave, 'waves.isPlaneWave')
    const init = need(waves.INITIAL_WAVE_CLOCK, 'waves.INITIAL_WAVE_CLOCK')
    const runs = planeRunLengths(fieldedWaveTypes(step, isPlane, init, 70))
    const cycle = [...MCOUNT_ROM]
    expect(runs.slice(0, cycle.length)).toEqual(cycle)
    expect(runs.slice(cycle.length, cycle.length * 2)).toEqual(cycle) // repeats — proves the wrap
  })

  it('MODECT never leaves 0..15 — the AND I,0F mask holds across a long run', () => {
    const step = need(waves.stepWaveClock, 'waves.stepWaveClock')
    const init = need(waves.INITIAL_WAVE_CLOCK, 'waves.INITIAL_WAVE_CLOCK')
    let clock = init
    for (let i = 0; i < 200; i++) {
      clock = step(clock).clock
      expect(clock.modect).toBeGreaterThanOrEqual(0)
      expect(clock.modect).toBeLessThanOrEqual(15)
    }
  })
})

describe('rb4-7 AC-3 — NEWCT counts WAVES, not calc frames (waves come in RUNS)', () => {
  it('THE HEADLINE — the game opens with a RUN of 4 plane waves before the first ground wave', () => {
    // Impossible under the shipped 1:1 alternation, which fires P,G,P,G,P. Refutes it outright.
    const step = need(waves.stepWaveClock, 'waves.stepWaveClock')
    const isPlane = need(waves.isPlaneWave, 'waves.isPlaneWave')
    const init = need(waves.INITIAL_WAVE_CLOCK, 'waves.INITIAL_WAVE_CLOCK')
    const types = fieldedWaveTypes(step, isPlane, init, 6)
    expect(types.slice(0, 4)).toEqual([true, true, true, true]) // four plane waves
    expect(types[4]).toBe(false) // THEN the first ground wave
  })

  it('the SECOND fielded wave is a PLANE wave — not a ground wave (kills 1:1 alternation)', () => {
    const step = need(waves.stepWaveClock, 'waves.stepWaveClock')
    const isPlane = need(waves.isPlaneWave, 'waves.isPlaneWave')
    const init = need(waves.INITIAL_WAVE_CLOCK, 'waves.INITIAL_WAVE_CLOCK')
    const r = step(init)
    expect(r.spawnPlaneWave).toBe(true)
    expect(isPlane(r.clock.modect)).toBe(true) // still MODECT 0 — the run has not ended
  })

  it('one stepWaveClock call advances ONE wave — the clock does not tick a per-frame countdown', () => {
    // NEWCT decrements per COMPLETED wave (RBARON.MAC:2258, behind three gates), so N calls =
    // N waves. In the shipped model a call was one 96 ms frame and MCOUNT was the frame gap;
    // here newct is the wave count remaining in the current run, and drops by one per call
    // while the run continues.
    const step = need(waves.stepWaveClock, 'waves.stepWaveClock')
    const init = need(waves.INITIAL_WAVE_CLOCK, 'waves.INITIAL_WAVE_CLOCK')
    // Opening run is 4 waves (newct 4). Three completions stay in MODECT 0, newct 3,2,1.
    let clock = init
    const r1 = step(clock)
    expect(r1.clock.modect).toBe(0)
    expect(r1.clock.newct).toBe(3)
    const r2 = step(r1.clock)
    expect(r2.clock.newct).toBe(2)
    const r3 = step(r2.clock)
    expect(r3.clock.newct).toBe(1)
    // The 4th completion spends the run: MODECT steps to the ground mode (1) and reloads newct = 1.
    const r4 = step(r3.clock)
    expect(r4.clock.modect).toBe(1)
    expect(r4.clock.newct).toBe(1)
    expect(r4.spawnPlaneWave).toBe(false) // the fielded wave is now a ground wave
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-4 — ground mode ends on a CONDITION (GRNDCT spent AND no visible objects), not a timer
// ═══════════════════════════════════════════════════════════════════════════════
describe('rb4-7 AC-4 — ground mode ends when GRNDCT is spent AND no ground object is visible', () => {
  it('INITGR deploys GRNDCT = 2 ground target-groups (RBARON.MAC:1403 — LDA I,2)', () => {
    expect(need(waves.GRNDCT_INITIAL, 'waves.GRNDCT_INITIAL')).toBe(2)
  })

  it('ends ONLY when BOTH are exhausted — grndct 0 and zero visible objects', () => {
    const ends = need(waves.groundModeEnds, 'waves.groundModeEnds')
    expect(ends(0, 0)).toBe(true) // GRNDCT spent AND nothing visible -> ends
    expect(ends(2, 0)).toBe(false) // GRNDCT still loaded -> continues (PFOBMN :3271 BNE 10$)
    expect(ends(1, 0)).toBe(false) // GRNDCT not yet spent -> continues
    expect(ends(0, 1)).toBe(false) // a ground object still visible -> continues (:3285 BNE 10$)
    expect(ends(0, 3)).toBe(false)
    expect(ends(2, 5)).toBe(false)
  })

  it('is NOT a timer — the outcome is a pure function of (grndct, visibleObjects), never elapsed frames', () => {
    // Property: for ANY state with grndct>0 OR a visible object, the mode keeps running,
    // no matter how much "time" passes. Only the exhausted (0,0) state ends it. This is the
    // refutation of the shipped ~0.4 s countdown wait.
    const ends = need(waves.groundModeEnds, 'waves.groundModeEnds')
    for (let g = 0; g <= 2; g++) {
      for (let v = 0; v <= 4; v++) {
        expect(ends(g, v)).toBe(g === 0 && v === 0)
      }
    }
  })

  it('is total on a clean state — returns a boolean, never NaN/undefined', () => {
    const ends = need(waves.groundModeEnds, 'waves.groundModeEnds')
    for (const [g, v] of [
      [0, 0],
      [2, 0],
      [0, 2],
    ] as const) {
      expect(typeof ends(g, v)).toBe('boolean')
    }
  })
})

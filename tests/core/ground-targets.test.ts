// tests/core/ground-targets.test.ts
//
// Story rb4-11 — RED phase (Imperator Furiosa / TEA). THE GROUND TARGETS, machine half.
//
// The ROM deploys ground targets from a small machine in the mountain scroll path
// (RBARON.MAC:3415-3455), armed by INITGR (:1403-1408) when a ground wave starts:
//
//   INITGR:  LDA I,2 / STA GRNDCT      ; 2 target-groups per ground wave  (:1403-1404)
//            LDA I,1 / STA GTIMER      ; MOUNTAIN OBJECT TIME-OUT COUNTER (:1405-1406)
//
//   per mountain step, in ground mode (A = |scroll position| via SPABS, :3424-3425):
//            DEC GTIMER                ; the pacing clock ALWAYS decrements   (:3426)
//            BMI 55$                   ; expired -> deploy ("PF OBJECT TIME-OUT", :3427)
//            CMP I,8 / BCS 60$         ; not expired: deploy only NEAR CENTRE, |pos| < 8 (:3428-3429)
//   55$:     LDA GRNDCT / BEQ 60$      ; no groups left -> nothing (the caller's gate) (:3430-3431)
//            DEC GRNDCT                ; one group spent                       (:3432)
//            ...
//            LDA I,1 / STA GTIMER      ; deploy RE-ARMS the clock to 1  (:3448-3449)
//            JSR RANDOM / AND I,3      ; group = random & 3             (:3450-3451)
//            ... STA AX,PFOBJ+7        ; RANDOM PF OBJECT GROUPS        (:3455)
//
// Group r deploys THREE targets: slot s gets object number PFOBJN[r][s] (RBARON.MAC:
// 3924-3927, pre-doubled: >>1 = type 0 pyramid / 1 house / 2 tank / 3 pill box) at screen
// offset PFOFFS[3r + s] (037007.XXX:1232-1246 — 4 groups of 3; the display code's byte
// arithmetic, 12r + 4s into 4-byte PFCOL entries, says the same thing, :3582-3591).
//
// ── CONTRACT for the GREEN phase (The Word Burgers / Dev) — NEW src/core/ground-targets.ts ──
//
//   export const GTIMER_INITIAL = 1
//   export interface GroundTarget {
//     readonly type: number        // 0 pyramid | 1 house | 2 tank | 3 pill box (PFOBJN >> 1)
//     readonly offset: Point2      // the PFOFFS screen offset this slot deployed with
//     // ...Dev may add binding/lifecycle fields; tests require only these two.
//   }
//   /** One mountain event: DEC GTIMER, deploy on expiry OR |pos| < 8; deploy re-arms to 1.
//     * The GRNDCT>0 precondition is the CALLER's (BEQ 60$), as groundModeEnds' gates are. */
//   export function deployGate(gtimer: number, absPos: number): { deploy: boolean; gtimer: number }
//   /** RANDOM AND I,3 — the group a random byte selects. */
//   export function groupFromRandom(byte: number): number
//   /** The three targets group r deploys (types PFOBJN[r]>>1, offsets PFOFFS[3r..3r+2]). */
//   export function deployGroup(group: number): readonly GroundTarget[]
//   /** Stroke a deployed group against its carrying mountain — the ONLY function the
//     * cockpit draws ground targets with (the blimpSegments/mountainSegments principle:
//     * where an object APPEARS cannot sit in main.ts untestable). */
//   export function groundTargetSegments(
//     targets: readonly GroundTarget[], mountain: Mountain,
//     attitude: Attitude, eyeHeight: number, aspect: number,
//   ): readonly SceneSegment[]
//
// The suite derives its oracles from the transcription (PFODEC/PFOBJN, pinned in
// ground-target-data.test.ts) AND pins the premises to LITERALS — never only to the
// constant under test (the tp1-27 rule).

import { describe, it, expect, beforeAll } from 'vitest'
import type { Point2, ConnectOp } from '../../src/core/topology'
import type { Mountain } from '../../src/core/landscape'
import { LEVEL, type Attitude } from '../../src/core/camera'
import type { SceneSegment } from '../../src/core/scene'

interface GroundTarget {
  readonly type: number
  readonly offset: Point2
}

interface GroundTargetsModule {
  GTIMER_INITIAL?: number
  deployGate?: (gtimer: number, absPos: number) => { deploy: boolean; gtimer: number }
  groupFromRandom?: (byte: number) => number
  deployGroup?: (group: number) => readonly GroundTarget[]
  groundTargetSegments?: (
    targets: readonly GroundTarget[],
    mountain: Mountain,
    attitude: Attitude,
    eyeHeight: number,
    aspect: number,
  ) => readonly SceneSegment[]
}

interface GroundTargetTopology {
  PFODEC?: readonly (readonly ConnectOp[])[]
  PFOBJN?: readonly (readonly number[])[]
  PFOFFS?: readonly Point2[]
}

// The module is CREATED by this story — a literal specifier would fail tsc while it does
// not exist, so the path is computed (resolved at runtime against this file, like any
// relative dynamic import). When the import rejects, every need() below is the RED.
const GROUND_TARGETS_PATH = ['..', '..', 'src', 'core', 'ground-targets'].join('/')

let gt: GroundTargetsModule = {}
let topo: GroundTargetTopology = {}
beforeAll(async () => {
  try {
    gt = (await import(/* @vite-ignore */ GROUND_TARGETS_PATH)) as GroundTargetsModule
  } catch {
    gt = {} // src/core/ground-targets.ts does not exist yet — rb4-11 RED
  }
  // `as unknown as`: RED mid-migration mirror (mission-clock.test.ts house pattern) —
  // topology.ts does not yet export the ground-target tables this suite cross-checks.
  topo = (await import('../../src/core/topology')) as unknown as GroundTargetTopology
})

function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`ground-targets does not provide ${name} yet (rb4-11 RED)`)
  return value
}

// A mountain comfortably on-screen, dead ahead: mid-approach depth (well inside
// HORZ=4096, well outside MIN_DEPTH=448), no lateral offset, past the horizon latch.
const CARRIER: Mountain = { scape: 0, depth: 2048, x: 0, active: true, onHorizon: false }
const EYE_HEIGHT = 800 // inside the PFPLOW..PFPHI flight band the ground mode clamps to
const ASPECT = 16 / 9

// ─── INITGR — the clock's armed value ─────────────────────────────────────────────────

describe('rb4-11 — GTIMER_INITIAL (INITGR, RBARON.MAC:1405-1406)', () => {
  it('a ground wave arms the deploy clock at exactly 1 — LDA I,1 / STA GTIMER', () => {
    expect(need(gt.GTIMER_INITIAL, 'GTIMER_INITIAL')).toBe(1)
  })
})

// ─── deployGate — DEC GTIMER / BMI / CMP I,8 / BCS, re-arm on deploy ──────────────────

describe('rb4-11 — deployGate (RBARON.MAC:3426-3429, :3448-3449)', () => {
  it('an armed clock, mountain far from centre: decrements only — no deploy', () => {
    // gtimer 1 -> DEC -> 0, not negative; |pos| 12 >= 8 -> BCS skips.
    expect(need(gt.deployGate, 'deployGate')(1, 12)).toEqual({ deploy: false, gtimer: 0 })
  })

  it('the NEXT far event expires the clock and deploys — DEC to -1 is BMI', () => {
    // gtimer 0 -> DEC -> -1, minus -> 55$ deploy; the deploy re-arms GTIMER to 1 (:3448-3449).
    expect(need(gt.deployGate, 'deployGate')(0, 12)).toEqual({ deploy: true, gtimer: 1 })
  })

  it('a mountain NEAR CENTRE deploys immediately, without waiting out the clock', () => {
    // gtimer 1 -> DEC -> 0 (not minus), but |pos| 7 < 8 falls through to the deploy.
    expect(need(gt.deployGate, 'deployGate')(1, 7)).toEqual({ deploy: true, gtimer: 1 })
    // ...even with plenty of clock left: gtimer 2 -> DEC -> 1, |pos| 7 < 8 still deploys.
    expect(need(gt.deployGate, 'deployGate')(2, 7)).toEqual({ deploy: true, gtimer: 1 })
  })

  it('the near-centre boundary is STRICT — |pos| 8 does not deploy (CMP I,8 / BCS)', () => {
    // BCS branches on >= : 8 is "not near centre". The bug lives where the compare ENDS.
    expect(need(gt.deployGate, 'deployGate')(1, 8)).toEqual({ deploy: false, gtimer: 0 })
    // and a loaded clock just counts down at the same position:
    expect(need(gt.deployGate, 'deployGate')(3, 20)).toEqual({ deploy: false, gtimer: 2 })
  })

  it('an already-negative clock still reads as expired — DEC keeps it minus', () => {
    // The ROM's 8-bit DEC of an already-negative GTIMER stays minus (BMI): when GRNDCT was
    // 0 at expiry the clock keeps decrementing until INITGR re-arms it. Totality on our side.
    expect(need(gt.deployGate, 'deployGate')(-2, 31).deploy).toBe(true)
  })

  it('is pure — same inputs, same answer, no hidden state', () => {
    const gate = need(gt.deployGate, 'deployGate')
    expect(gate(1, 12)).toEqual(gate(1, 12))
    expect(gate(0, 12)).toEqual(gate(0, 12))
  })
})

// ─── groupFromRandom — RANDOM AND I,3 ─────────────────────────────────────────────────

describe('rb4-11 — groupFromRandom (RBARON.MAC:3450-3451)', () => {
  it('masks a random byte to the 4 groups — AND I,3', () => {
    const group = need(gt.groupFromRandom, 'groupFromRandom')
    expect(group(0)).toBe(0)
    expect(group(1)).toBe(1)
    expect(group(2)).toBe(2)
    expect(group(3)).toBe(3)
    expect(group(4)).toBe(0) // the mask, not a clamp
    expect(group(7)).toBe(3)
    expect(group(0x53)).toBe(3)
    expect(group(0xff)).toBe(3)
  })
})

// ─── deployGroup — three targets: PFOBJN types, PFOFFS offsets ────────────────────────

describe('rb4-11 AC-2/AC-3 — deployGroup (PFOBJN :3924-3927 × PFOFFS 037007.XXX:1232-1246)', () => {
  // The literal oracle — PFOBJN rows halved. Pinned as LITERALS first (tp1-27: never derive
  // an expectation only from the constant under audit), then cross-checked against the table.
  const TYPES_BY_GROUP: readonly (readonly number[])[] = [
    [0, 1, 3], // group 0: pyramid, house,   pill box
    [0, 0, 3], // group 1: pyramid, pyramid, pill box
    [2, 1, 3], // group 2: tank,    house,   pill box
    [2, 2, 3], // group 3: tank,    tank,    pill box
  ]

  it('every group deploys exactly THREE targets', () => {
    const deploy = need(gt.deployGroup, 'deployGroup')
    for (const g of [0, 1, 2, 3]) expect(deploy(g)).toHaveLength(3)
  })

  it('slot types follow PFOBJN >> 1 — pinned literally per group', () => {
    const deploy = need(gt.deployGroup, 'deployGroup')
    TYPES_BY_GROUP.forEach((types, g) => {
      expect(deploy(g).map((t) => t.type)).toEqual(types)
    })
  })

  it('slot types agree with the transcribed PFOBJN table (both sides pinned)', () => {
    const deploy = need(gt.deployGroup, 'deployGroup')
    const pfobjn = need(topo.PFOBJN, 'topology.PFOBJN')
    pfobjn.forEach((row, g) => {
      expect(deploy(g).map((t) => t.type)).toEqual(row.map((n) => n / 2))
    })
  })

  it('slot offsets are the group’s three consecutive PFOFFS entries — PFOFFS[3g .. 3g+2]', () => {
    const deploy = need(gt.deployGroup, 'deployGroup')
    const pfoffs = need(topo.PFOFFS, 'topology.PFOFFS')
    for (const g of [0, 1, 2, 3]) {
      expect(deploy(g).map((t) => t.offset)).toEqual(pfoffs.slice(3 * g, 3 * g + 3))
    }
    // group 0 pinned literally as well — the anchors survive even a corrupted table:
    expect(deploy(0).map((t) => t.offset)).toEqual([[96, -28], [-56, -4], [-72, -4]])
  })

  it('every group’s LAST slot is the pill box — type 3, the ROM invariant', () => {
    const deploy = need(gt.deployGroup, 'deployGroup')
    for (const g of [0, 1, 2, 3]) expect(deploy(g)[2].type).toBe(3)
  })
})

// ─── groundTargetSegments — the decode-lists actually reach the screen ────────────────
//
// Routing tests alone would pass while wrong geometry ships (the renderer-migration
// lesson): these pin that each TYPE strokes ITS decode-list, via projection-free laws.

describe('rb4-11 AC-2 — groundTargetSegments strokes the transcribed decode-lists', () => {
  const at = (type: number): GroundTarget => ({ type, offset: [0, 0] }) // dead-centre staging

  const segsFor = (type: number): readonly SceneSegment[] =>
    need(gt.groundTargetSegments, 'groundTargetSegments')([at(type)], CARRIER, LEVEL, EYE_HEIGHT, ASPECT)

  it('one visible stroke per VV op — 4 / 5 / 8 / 15 for pyramid / house / tank / pill box', () => {
    // Derived from the decode-lists: DEPFPY has 4 VV ops, DEPFHS 5, DEPFTK 8, DEPFPB 15.
    // All four counts are DISTINCT, so any type→list cross-wiring changes a count.
    expect(segsFor(0)).toHaveLength(4)
    expect(segsFor(1)).toHaveLength(5)
    expect(segsFor(2)).toHaveLength(8)
    expect(segsFor(3)).toHaveLength(15)
  })

  it('the stroke counts agree with the transcribed PFODEC lists (both sides pinned)', () => {
    const pfodec = need(topo.PFODEC, 'topology.PFODEC')
    pfodec.forEach((list, type) => {
      expect(segsFor(type)).toHaveLength(list.filter((op) => op.draw).length)
    })
  })

  it('the tank keeps its centre DOT — one zero-length lit segment (BV 8 / VV 9)', () => {
    // PFTANK points 8 and 9 are both [0,0] (PFPNTS discards Z), so DEPFTK's final stroke is
    // a zero-length lit vector — the cabinet's centre dot. Do not cull it as degenerate.
    const dot = segsFor(2).filter((s) => s.x1 === s.x2 && s.y1 === s.y2)
    expect(dot).toHaveLength(1)
  })

  it('shape proportions survive projection — house 1.5× taller than pyramid, pill box 1.5× wider than tank', () => {
    // At one staging every point of a playfield object projects at the SAME depth, so the
    // screen is a uniform scale of model space and model-span RATIOS are projection-free:
    //   pyramid y: -4..4 (span 8)   house y: -4..8 (span 12)   -> 12/8 = 1.5
    //   tank   x: -4..4 (span 8)   pill box x: -6..6 (span 12) -> 12/8 = 1.5
    const spanY = (segs: readonly SceneSegment[]): number => {
      const ys = segs.flatMap((s) => [s.y1, s.y2])
      return Math.max(...ys) - Math.min(...ys)
    }
    const spanX = (segs: readonly SceneSegment[]): number => {
      const xs = segs.flatMap((s) => [s.x1, s.x2])
      return Math.max(...xs) - Math.min(...xs)
    }
    expect(spanY(segsFor(1)) / spanY(segsFor(0))).toBeCloseTo(1.5, 9)
    expect(spanX(segsFor(3)) / spanX(segsFor(2))).toBeCloseTo(1.5, 9)
  })

  it('an empty deploy strokes nothing', () => {
    expect(
      need(gt.groundTargetSegments, 'groundTargetSegments')([], CARRIER, LEVEL, EYE_HEIGHT, ASPECT),
    ).toHaveLength(0)
  })
})

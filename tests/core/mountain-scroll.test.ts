// tests/core/mountain-scroll.test.ts
//
// Story rb4-8 — RED phase (Furiosa / TEA). Cluster C7 (subsumes MI-014/015/016/018/019).
// rb4-1 ("THE RADIX SWEEP") already landed the mountain NUMBERS — PFOBIZ_DEPTHS/X,
// SPAWN_DEPTH=0x7F00 (P.OBZI), MIN_DEPTH=0x01C0, P_OBDZ=0x180, PF_FALLEN_DZ=0x20 —
// and initialMountains()/stepMountain() consume them. This story lands the two
// MACHINES those numbers feed, which rb4-1 EXPLICITLY deferred (landscape.ts:28,137):
//
//   AC-2  "on the horizon" is a LATCHED STATUS BIT with HYSTERESIS (PFOBJ+6 D7),
//         NOT a live `depth >= HORZ` comparison. The close rate follows the STORED
//         bit; the bit flips on→fallen at ONE threshold and fallen→on at ANOTHER.
//   AC-3  Mountains SCROLL LATERALLY with the player each calc frame (the ROM
//         subtracts PLYRDL from every FREE object's X) and WRAP — "ours never do,
//         which is a large part of why the world feels static."
//
// AC-1 (authored PFOBIZ) and AC-4 (recycle depth + 16-bit 0x01C0 threshold) are the
// numbers rb4-1 already shipped; they are re-guarded lightly here only where AC-2/AC-3
// touch them. The exhaustive AC-1/AC-4 constant pins live in tests/audit/radix-*.
//
// ─── PRIMARY SOURCE ──────────────────────────────────────────────────────────────
// All citations are the CITABLE copy: ~/Projects/red-baron-source-text/RBARON.MAC
// (LF-only, md5 497db9…, fingerprint :621 = `CALCNT\t=18`). The other two copies on
// this machine are the CRLF sibling and disagree on line numbers by a 1→8-line
// STAIRCASE — never resolve a citation against them. Every line below was derived at
// the symbol's DEFINITION, not copied from the story text (the story cites
// RBARON.MAC:1305-1306 for PFOBIZ — exact — and :3298-3306 for the PLYRDL subtract,
// which sits at :3299-3306 in the citable copy: the staircase, verified not trusted).
//
// PFOBMN — the per-calc-frame mountain step (RBARON.MAC:3269):
//   :3294  LDA AX,PFOBJ+6   ;STATUS      ─┐ D7 of the +6 status byte (:362 "A ACTIVE")
//   :3296  BPL 15$          ;FREE/fallen  │ is the LATCHED on-horizon bit.
//   :3297  JMP 45$          ;ON HORIZON  ─┘
//   ── on-horizon branch (45$, :3377) — NO lateral scroll:
//     :3383  LDA I,P.OBDZ&0FF ;STANDARD DELTA  → close by P.OBDZ (0x180 = 384)/frame
//     :3397  CPY I,P.MAXZ&0FF / SBC .. / BCS 35$ ;stay while depth >= P.MAXZ (0x1001)
//     :3400  AND I,0F         ;else START PF OBJECT 'FALL' → CLEARS D7 (latch → fallen)
//   ── free/fallen branch (15$, :3298) — DOES lateral scroll:
//     :3299  LDA AX,PFOBJ / :3300 SBC A,PLYRDL / :3305 SBC PLYRDL+1  → X -= PLYRDL
//     :3306  JSR WRAPIT       ;wrap X to the ±0x0C01 screen limit (:4341-4348)
//     :3341  LDA I,20         ;STANDARD DELTA  → close by 0x20 = 32 /frame once fallen
//     :3354  CPY I,0C0 / :3355 SBC I,1 ;16-bit minimum 0x01C0 = 448 (MIN_DEPTH)
//     :3358  LDA PFOBJ+6 / ORA I,80 ;else recycle: SET D7 (latch → on horizon) …
//     :3368  LDA I,P.OBZI&0FF00/100 / STA PFOBJ+5 ;… and reset depth to 0x7F00
// GMINIT initial classify (RBARON.MAC:1258-1262): CMP I,11 against the depth's Z MSB;
//   BCC → leave D7 clear (fallen); else ORA I,80 (on horizon). PFOBIZ MSBs
//   [0x82,0x06,0x32,0x0d] vs 0x11 ⇒ latch [true, false, true, false].
// Equates: P.OBZI=7F00 :443, P.OBDZ=180 :444, P.MAXZ=1001 :445 (.RADIX 16). WRAPIT
//   limit -0C01 :4347-4348 — one unit beyond the outermost authored lane ±0x0C00.
//
// CONTRACT for GREEN (The Word Burgers / DEV), src/core/landscape.ts:
//   * Mountain gains `readonly onHorizon: boolean` — the STORED latched D7 bit. The
//     `onHorizon(m)` FUNCTION that returns `m.depth >= HORZ` is SUPERSEDED (rb4-1
//     landscape.ts:150); the close rate reads the stored bit, never a depth recompute.
//   * export const P_MAXZ = 0x1001   // RBARON.MAC:445 — on→fallen threshold
//   * export const WRAP_LIMIT = 0x0c01 // RBARON.MAC:4347 — WRAPIT lateral screen limit
//   * stepMountain(m: Mountain, playerDX: number): Mountain — playerDX is the per-frame
//     scaled player X delta (PLYRDL). REQUIRED arg: the bare `mountains.map(stepMountain)`
//     in main.ts:566 (which would pass the array index) must become a real delta.

import { describe, it, expect } from 'vitest'
import { HORZ } from '../../src/core/topology'
import {
  MAX_MOUNTAINS,
  SPAWN_DEPTH,
  MIN_DEPTH,
  P_OBDZ,
  PF_FALLEN_DZ,
  P_MAXZ,
  WRAP_LIMIT,
  spawnMountain,
  initialMountains,
  stepMountain,
  type Mountain,
} from '../../src/core/landscape'

// A Mountain with the latched bit (`Mountain.onHorizon`) set explicitly.
const mtn = (over: {
  scape?: number
  depth: number
  x?: number
  active?: boolean
  onHorizon: boolean
}): Mountain => ({ scape: 0, x: 0, active: true, ...over })

// Read the latched bit off a stepped mountain (field-based; the depth-predicate function is retired).
const latch = (m: Mountain): boolean => m.onHorizon

describe('rb4-8 AC-2 — on-horizon is a LATCHED bit (PFOBJ+6 D7), not a depth test', () => {
  it('exports P_MAXZ = 0x1001, the ROM on→fallen threshold (RBARON.MAC:445)', () => {
    expect(P_MAXZ).toBe(0x1001)
    expect(P_MAXZ).toBe(4097)
    // It is HORZ+1, not HORZ — the fall fires one unit past the horizon depth.
    expect(P_MAXZ).toBe(HORZ + 1)
  })

  it('initialMountains latches per GMINIT (Z MSB vs 0x11): [horizon, fallen, horizon, fallen]', () => {
    // PFOBIZ depths [0x8200,0x06E0,0x3220,0x0D20] → MSBs [0x82,0x06,0x32,0x0D] vs 0x11
    // ⇒ two open on the horizon (0x82,0x32) and two open already fallen (0x06,0x0D).
    const fleet = initialMountains()
    expect(fleet).toHaveLength(MAX_MOUNTAINS)
    expect(fleet.map(latch)).toEqual([true, false, true, false])
  })

  it('a freshly spawned mountain latches ON the horizon (D7 set)', () => {
    expect(latch(spawnMountain(2))).toBe(true)
  })

  it('the CLOSE RATE follows the stored bit — a FALLEN mountain above HORZ still closes SLOW', () => {
    // The discriminator. depth 0x4000 is far above HORZ, so a `depth >= HORZ` model would
    // call this "on the horizon" and close it at P_OBDZ (384). The LATCH says fallen, so it
    // closes at PF_FALLEN_DZ (32) and STAYS fallen. Reading depth here is the bug.
    const next = stepMountain(mtn({ depth: 0x4000, onHorizon: false }), 0)
    expect(next.depth).toBe(0x4000 - PF_FALLEN_DZ) // 32, NOT 384
    expect(latch(next)).toBe(false) // no fallen→on transition except at recycle
  })

  it('the CLOSE RATE follows the stored bit — an ON-HORIZON mountain below HORZ closes FAST that frame', () => {
    // Mirror discriminator. depth 0x0800 is below HORZ, so a `depth >= HORZ` model closes
    // it SLOW (32). The latch says on-horizon → close FAST (P_OBDZ=384) this frame, THEN
    // fall (the ROM applies P.OBDZ before the P.MAXZ test, :3383 before :3400).
    const next = stepMountain(mtn({ depth: 0x0800, onHorizon: true }), 0)
    expect(next.depth).toBe(0x0800 - P_OBDZ) // 384, NOT 32
    expect(latch(next)).toBe(false) // 0x680 < P_MAXZ → latched to fallen this same frame
  })

  it('flips on→fallen exactly when depth drops below P_MAXZ (0x1001) — the ROM threshold', () => {
    // Land the step exactly on HORZ (0x1000): the ROM falls (0x1000 < P.MAXZ 0x1001), a
    // HORZ-based test would not. This pins P_MAXZ, not HORZ, as the fall boundary.
    const onto1000 = stepMountain(mtn({ depth: 0x1000 + P_OBDZ, onHorizon: true }), 0)
    expect(onto1000.depth).toBe(0x1000)
    expect(latch(onto1000)).toBe(false)
  })

  it('STAYS on the horizon while a step lands at/above P_MAXZ (no premature fall)', () => {
    // Land the step exactly on P.MAXZ (0x1001): still on the horizon (BCS 35$, :3399).
    const onto1001 = stepMountain(mtn({ depth: 0x1001 + P_OBDZ, onHorizon: true }), 0)
    expect(onto1001.depth).toBe(0x1001)
    expect(latch(onto1001)).toBe(true)
  })

  it('re-latches fallen→on ONLY at recycle — the near-plane wrap sets D7 AND resets depth', () => {
    // A fallen mountain reaching the 16-bit minimum (0x01C0) recycles to P.OBZI (0x7F00)
    // and, in the SAME move, sets D7 back on (ORA I,80, :3358). Hysteresis: this is the
    // only fallen→on transition — it never happens by depth alone on the way down.
    const recycled = stepMountain(mtn({ depth: MIN_DEPTH + 1, x: 999, onHorizon: false }), 0)
    expect(recycled.depth).toBe(SPAWN_DEPTH)
    expect(latch(recycled)).toBe(true)
  })

  it('an inactive mountain is returned untouched (totality)', () => {
    const dormant = mtn({ depth: 0x0800, x: 5, active: false, onHorizon: false })
    expect(stepMountain(dormant, 0x100)).toEqual(dormant)
  })
})

describe('rb4-8 AC-3 — mountains scroll laterally with PLYRDL and WRAP (WRAPIT)', () => {
  it('exports WRAP_LIMIT = 0x0C01, the WRAPIT screen limit (RBARON.MAC:4347)', () => {
    expect(WRAP_LIMIT).toBe(0x0c01)
    expect(WRAP_LIMIT).toBe(3073)
    // One unit beyond the outermost authored lane PFOBIZ_X = ±0x0C00 (RBARON.MAC:1306).
    expect(WRAP_LIMIT).toBe(0x0c00 + 1)
  })

  it('a FALLEN mountain subtracts the player delta from its X each frame (X -= PLYRDL)', () => {
    // ROM :3299-3306: SBC A,PLYRDL. Positive player delta pans the world to −X.
    expect(stepMountain(mtn({ depth: 0x0800, x: 0, onHorizon: false }), 0x100).x).toBe(-0x100)
    // …and it is a SUBTRACTION, so a negative delta moves +X.
    expect(stepMountain(mtn({ depth: 0x0800, x: 0, onHorizon: false }), -0x100).x).toBe(0x100)
  })

  it('an ON-HORIZON mountain does NOT scroll laterally (the 45$ branch skips the PLYRDL subtract)', () => {
    // Only FREE/fallen objects pan; a far horizon silhouette holds its X (:3377-3402 has
    // no SBC PLYRDL). A dev who scrolls every mountain fails here.
    expect(stepMountain(mtn({ depth: SPAWN_DEPTH, x: 500, onHorizon: true }), 0x100).x).toBe(500)
  })

  it('a zero player delta leaves X unchanged — the scroll is delta-driven, not automatic', () => {
    expect(stepMountain(mtn({ depth: 0x0800, x: 777, onHorizon: false }), 0).x).toBe(777)
  })

  it('WRAPS at the limit: crossing +WRAP_LIMIT reappears on the −side (and vice-versa)', () => {
    // Push a fallen mountain past the +limit with a negative delta (X grows): it wraps.
    const wrappedNeg = stepMountain(mtn({ depth: 0x0800, x: 0x0c00, onHorizon: false }), -0x400)
    expect(Math.abs(wrappedNeg.x)).toBeLessThanOrEqual(WRAP_LIMIT)
    expect(wrappedNeg.x).toBeLessThan(0) // crossed +limit → other side
    // Symmetric: push past the −limit with a positive delta.
    const wrappedPos = stepMountain(mtn({ depth: 0x0800, x: -0x0c00, onHorizon: false }), 0x400)
    expect(Math.abs(wrappedPos.x)).toBeLessThanOrEqual(WRAP_LIMIT)
    expect(wrappedPos.x).toBeGreaterThan(0)
  })

  it('under a sustained delta a fallen mountain MOVES and stays within ±WRAP_LIMIT (not static, not runaway)', () => {
    // Rebuild depth each frame so the slot never recycles — isolate the lateral band.
    let x = 0
    let moved = false
    for (let i = 0; i < 40; i++) {
      x = stepMountain(mtn({ depth: 0x0800, x, onHorizon: false }), -0x200).x
      if (x !== 0) moved = true
      expect(Math.abs(x)).toBeLessThanOrEqual(WRAP_LIMIT) // never escapes the screen band
    }
    expect(moved, 'a fallen mountain never moved under a sustained delta — the world is still static').toBe(true)
  })
})

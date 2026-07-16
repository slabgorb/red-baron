// tests/core/enemy-machine.test.ts
//
// Story rb4-6 — RED phase (Furiosa / TEA). "THE ENEMY IS THE WRONG MACHINE."
// The rb2-4 stepper is not a tweak away from the ROM — it is the wrong machine.
// This suite pins the FIVE ways the real PLNDEL/UPDPLN window-servo differs from
// what we ship, each derived by re-reading the CONSUMING 6502 in the CITABLE
// quarry (~/Projects/red-baron-source-text/RBARON.MAC, md5 497db93e…, 6294 lines,
// `.RADIX 16` from :74 — NOT the CRLF sibling reference/red-baron/, which is 8
// lines short in a staircase and poisoned the findings doc).
//
// CONTRACT for the GREEN phase (The Word Burgers / DEV). enemy.ts / waves.ts must
// grow the real machine:
//
//   AC-1  INNER-window reversal. The plane reverses when it comes CLOSE TO CENTRE
//         (|pos| < P.ILIM → `EOR I,0FF ;REVERSE FLAG (HEAD AWAY FROM CENTER)`,
//         RBARON.MAC:2794-2796), not only at the outer wall. P.OLIM is the
//         "RETURN TO CENTER LIMIT" (:2939); P.ILIM the "HEAD AWAY FROM CENTER
//         LIMIT" (:2945). Today we only reverse at ±P_OLIM, so the plane drifts
//         straight through centre to the far wall — the wrong shape of engagement.
//
//   AC-2  BOTH AXES. PLNDEL runs the identical window machine on Y first
//         (`2$: LDX I,2` :2747, position `SBC I,HORIZN` :2750) then `P.WITR: DEX
//         /DEX` :2865 drops to X=0 and re-runs it (:2865-2873). Our step() never
//         touches enemy.y — the planes never climb or dive.
//
//   AC-3  THE PLANE FLIES PAST. When depth closes below P.MNDP (0x140=320) the ROM
//         does NOT floor it — it DESTROYS the plane as an object (`STA PLSTAT+6
//         ;CLR PLANE` :2741), arms the returning attack (`GMEND0 = 0C0` :2729-2730)
//         and disables the slot for WO.RTN=0x10 frames (:2736-2737). We clamp depth
//         at P.MNDP with Math.max() and the plane hovers in your face forever.
//
//   AC-4  DRONES ARE A TWO-PHASE FORMATION. They spawn DEEPER than the lead, at
//         DRINZ=0x1600 (`P.1ST+5 = DRINZ/100` :2369-2370), flagged FORMATION
//         (`P.1ST+6 = 2` :2368), fly PARALLEL to the lead, and only break to FREE
//         when FRDRNE shifts `2 -> 1` and resolves their offset to an absolute
//         position (:3511-3528). We spawn them AT the lead's depth and weave them
//         exactly like leads.
//
// RETRACTED (round 2) — THIS SUITE'S OWN DESCOPE WAS WRONG. Round 1 said here that the
// per-level weave-speed magnitudes P.ODLX/P.IDLX/P.IIDL (RBARON.MAC:2948-2956) could not
// be pinned because "their `.2WORD`/`.3WORD` macros carry an unverified ×2/×3 scale and
// there is NO baked artifact to arbitrate a transcription". That claim is FALSE, and
// disproving it took one grep of the file this header already cites:
//
//     20:  .MACRO .3WORD .A,.B,.C,.D
//     21:  .WORD  3*.A,3*.B,3*.C,3*.D
//     25:  .MACRO .2WORD .A,.B,.C,.D
//     26:  .WORD  2*.A,2*.B,2*.C,2*.D
//
// The scale is DEFINED at :20-27 — 47 lines above the `.RADIX 16` at :74 that this suite
// DID read — and corroborated independently by the author writing each table's fifth entry
// LONGHAND, because the macro only takes four arguments: `.WORD 80*2` (:2949), `2C*3`
// (:2953), `40*3` (:2956). Same multiplier, spelled out. So the tables assemble with zero
// ambiguity, and AC-1's "accelerates toward the P.IIDL target by level" was skipped for a
// reason that does not exist — while `WEAVE_SPEED_CAP = 100` and
// `weaveSpeedCap(ilim) = sqrt(ACCEL*ilim)` were invented to stand in for them. We shipped a
// fabricated constant to avoid the risk of shipping a fabricated constant.
//
// A descope's RATIONALE is reviewable evidence, not context. Round 2 pins the bytes.
//
// Loaded defensively (await import in beforeAll — the flight.test.ts house pattern):
// enemy.ts EXISTS, but its NEW exports (HORIZN, DRINZ, WO_RTN) and NEW behaviours
// (inner reversal, Y motion, fly-past deactivation, two-phase drones) do not, so
// every check reports a clean assertion failure rather than a collection crash.

import { describe, it, expect, beforeAll } from 'vitest'
import { createRng, type Rng } from '@arcade/shared/rng'

// --- local mirror of the (extended) RED contract, kept out of the static import
//     graph so the file loads even as enemy.ts lacks the new surface ---

interface Enemy {
  readonly kind: 'lead' | 'drone'
  readonly x: number
  readonly y: number
  readonly depth: number
  readonly deltaX: number
  /** rb4-6 — the vertical weave velocity (round 3: the mirror gains it for the ΔY convergence pins). */
  readonly deltaY?: number
  /** rb4-6 — entry-bank frames remaining; round-3 fixtures zero it so the weave is judged, not the flourish. */
  readonly entryFrames?: number
  readonly bank: number
  readonly side: -1 | 1
  readonly active: boolean
  readonly facingAway: boolean
  /**
   * rb4-6 — the drone FORMATION phase (PLSTAT+6 D1, RBARON.MAC:2368/3512).
   * `true`  ⇔ still flying PARALLEL, locked to the lead's motion (D1 set, =2).
   * `false` ⇔ a lead, OR a drone that FRDRNE has freed (`LSR` → 1). Leads are
   * never parallel. A fresh drone is; a freed drone is not.
   */
  readonly parallel: boolean
}

interface EnemyModule {
  P_OLIM?: readonly number[]
  P_ILIM?: readonly number[]
  P_INDP?: number
  P_MNDP?: number
  /** HORIZN — the Y-axis window bias (RBARON.MAC:456, `.RADIX 16`). New in rb4-6. */
  HORIZN?: number
  /** DRINZ — the drone's initial (deeper) spawn depth (RBARON.MAC:466). New in rb4-6. */
  DRINZ?: number
  /** WO.RTN — the fly-past re-entry disable delay in calc frames (RBARON.MAC:473). New in rb4-6. */
  WO_RTN?: number
  /** P.ODLX — OUTER per-level target deltas, `.2WORD` scaled (RBARON.MAC:2948-2949). Round 2. */
  P_ODLX?: readonly number[]
  /** P.IDLX — MIDDLE per-level target deltas, `.3WORD` scaled (RBARON.MAC:2952-2953). Round 2. */
  P_IDLX?: readonly number[]
  /** P.IIDL — INNER per-level target deltas, `.3WORD` scaled (RBARON.MAC:2955-2956). Round 2. */
  P_IIDL?: readonly number[]
  spawn?: (rng: Rng, level?: number) => Enemy
  step?: (enemy: Enemy, level?: number) => Enemy
}

interface WavesModule {
  spawnWave?: (rng: Rng, score: number, level?: number) => readonly Enemy[]
  SCORE_2_PLANES?: number
  SCORE_3_PLANES?: number
  /**
   * rb4-6 RED contract — the FORMATION stepper. The lead weaves; PARALLEL drones
   * ride the lead's motion in formation; FRDRNE frees them (parallel → false) to
   * weave on their own; fly-past planes (active → false) are dropped. This is the
   * ROM's PLMOTN/FREPAR seam (:3500-3529), the natural home for cross-plane
   * formation logic that a single-enemy step() cannot see. Returns the advanced
   * wave with destroyed planes removed.
   */
  stepWave?: (enemies: readonly Enemy[], level?: number) => readonly Enemy[]
}

let m: EnemyModule = {}
let w: WavesModule = {}

beforeAll(async () => {
  try {
    m = (await import('../../src/core/enemy')) as EnemyModule
  } catch {
    m = {}
  }
  try {
    w = (await import('../../src/core/waves')) as WavesModule
  } catch {
    w = {}
  }
})

function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`rb4-6 RED contract: must export ${name}`)
  return value
}

const spawnAt = (seed = 1, level = 0): Enemy => need(m.spawn, 'spawn')(createRng(seed), level)

/** Override Enemy fields, carrying whatever extra fields Dev adds (robust hand-build). */
const withEnemy = (overrides: Partial<Enemy>, seed = 1, level = 0): Enemy => ({
  ...spawnAt(seed, level),
  ...overrides,
})

/** Advance one plane `n` frames (or until it deactivates), tracing every axis. */
function trace(seed: number, level: number, n: number): { xs: number[]; ys: number[]; depths: number[]; deltas: number[] } {
  const step = need(m.step, 'step')
  let e = spawnAt(seed, level)
  const xs = [e.x]
  const ys = [e.y]
  const depths = [e.depth]
  const deltas = [e.deltaX]
  for (let i = 0; i < n && e.active; i++) {
    e = step(e, level)
    xs.push(e.x)
    ys.push(e.y)
    depths.push(e.depth)
    deltas.push(e.deltaX)
  }
  return { xs, ys, depths, deltas }
}

const range = (xs: readonly number[]): number => Math.max(...xs) - Math.min(...xs)

// ═══════════════════════════════════════════════════════════════════════════
// AC-1 — the weave reverses at the INNER window (HEAD AWAY FROM CENTER)
// ═══════════════════════════════════════════════════════════════════════════
describe('rb4-6 AC-1 — inner-window reversal (P.INER, RBARON.MAC:2794-2796)', () => {
  it('a plane at rest INSIDE the inner window heads AWAY from centre, not toward it', () => {
    // The cleanest, deterministic separator. On the −side, inside |x| < P.ILIM, at
    // rest: the ROM flips the reverse flag to HEAD AWAY FROM CENTER, so x goes MORE
    // negative. The old machine only knows the outer wall — with ΔX=0 it reads
    // "heading +" and drives x toward (and across) centre. Opposite signs.
    const step = need(m.step, 'step')
    for (const lvl of [1, 2, 3]) {
      const ilim = need(m.P_ILIM, 'P_ILIM')[lvl]
      const e0 = withEnemy({ x: -(ilim >> 1), y: 0, deltaX: 0, kind: 'lead', parallel: false }, 1, lvl)
      const e1 = step(e0, lvl)
      expect(e1.x, `level ${lvl}: inside the inner window the plane must head AWAY from centre`).toBeLessThan(
        e0.x,
      )
    }
  })

  it('a plane approaching centre REVERSES before crossing it — it does not drift to the far wall', () => {
    // Seeded just inside the inner window on the +side, coasting inward. The ROM turns
    // it AWAY at |x| < P.ILIM, so it stays on its entry side. The old machine reverses
    // only at ±P_OLIM, so it sails through centre and out to the OPPOSITE outer wall.
    const step = need(m.step, 'step')
    const lvl = 2
    const ilim = need(m.P_ILIM, 'P_ILIM')[lvl]
    const olim = need(m.P_OLIM, 'P_OLIM')[lvl]
    let e = withEnemy({ x: ilim - 1, y: 0, deltaX: -8, kind: 'lead', parallel: false }, 1, lvl)
    let minX = e.x
    for (let f = 0; f < 60 && e.active; f++) {
      e = step(e, lvl)
      minX = Math.min(minX, e.x)
    }
    // Old machine: minX reaches ≈ −P_OLIM (drifted across and out the far side).
    // New machine: it turned away near centre and never approached the far wall.
    expect(minX, 'the plane crossed centre and drifted to the far outer wall — no inner reversal').toBeGreaterThan(
      -ilim,
    )
    expect(minX).toBeGreaterThan(-olim / 2)
  })

  it('the inner reversal actually SENDS IT BACK OUT — the turn is live, not a freeze', () => {
    // Liveness guard (the sidecar's rule: a frozen plane also "never crosses centre").
    // A plane released inside the inner window must climb back out toward the band.
    const step = need(m.step, 'step')
    const lvl = 3
    const ilim = need(m.P_ILIM, 'P_ILIM')[lvl]
    let e = withEnemy({ x: -(ilim >> 2), y: 0, deltaX: 0, kind: 'lead', parallel: false }, 1, lvl)
    const xs: number[] = [e.x]
    for (let f = 0; f < 40 && e.active; f++) {
      e = step(e, lvl)
      xs.push(e.x)
    }
    // It moved a real distance (not frozen) and its excursion is on the −side (away).
    expect(range(xs), 'the plane never moved — a frozen weave is not a reversal').toBeGreaterThan(4)
    expect(Math.min(...xs)).toBeLessThan(-(ilim >> 2)) // it did head further away from centre
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Problem item 5 — the 90° entry bank RAMPS out; it is not discarded on step 1
// ═══════════════════════════════════════════════════════════════════════════
describe('rb4-6 (item 5) — the 90° entry bank is a RAMP, not a one-frame discard', () => {
  it('frame 1 is still substantially banked — the entry roll has NOT snapped to the weave bank', () => {
    // Story problem item 5: "the 90-degree entry bank is discarded on our first step()".
    // The ROM ramps the entry Y-rotation to zero over several frames (RBARON.MAC:2620-2652)
    // before `AND I,0EF` clears D4 — it does not collapse to the shallow (≤45°) weave bank
    // on the very first calc-frame. Pin that the entry is a RAMP: after ONE step the bank is
    // still high (> 60°), not already the settled steering bank. rb4-13's facingAway gets up
    // to 8 frames of flourish; the bank must ramp over that same window, not snap at frame 1.
    const step = need(m.step, 'step')
    const e0 = spawnAt(3, 0)
    expect(Math.abs(e0.bank)).toBeCloseTo(Math.PI / 2, 6) // enters at 90°
    const e1 = step(e0, 0)
    expect(Math.abs(e1.bank), 'the 90° entry bank was discarded on the first step()').toBeGreaterThan(Math.PI / 3)
  })

  it('the entry bank DECREASES toward the weave over the flourish — it rolls out, not stays pinned at 90°', () => {
    // Liveness the other way: the ramp must actually resolve. Over the first several frames
    // the |bank| trends DOWN from 90° toward the shallow steering bank (it does not freeze at
    // 90°). Pins a genuine ramp between "snap on frame 1" and "never roll out".
    const step = need(m.step, 'step')
    let e = spawnAt(3, 0)
    const banks: number[] = [Math.abs(e.bank)]
    for (let f = 0; f < 12 && e.active; f++) {
      e = step(e, 0)
      banks.push(Math.abs(e.bank))
    }
    expect(banks[banks.length - 1], 'the entry bank never rolled out of 90°').toBeLessThan(Math.PI / 2 - 0.1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// AC-2 — the window machine runs on the Y axis too (biased by HORIZN)
// ═══════════════════════════════════════════════════════════════════════════
describe('rb4-6 AC-2 — the Y axis runs the same machine (PLNDEL LDX I,2 → P.WITR DEX/DEX)', () => {
  it('HORIZN is the byte-exact Y-axis bias — 0x40 = 64 (RBARON.MAC:456, .RADIX 16)', () => {
    expect(need(m.HORIZN, 'HORIZN')).toBe(0x40)
    expect(need(m.HORIZN, 'HORIZN')).not.toBe(40) // the decimal misreading the epic exists to kill
  })

  it('enemy planes MOVE VERTICALLY — y is not frozen under step()', () => {
    // The headline defect: our planes never climb or dive. The ROM runs the whole
    // window/servo on Y first, then X. A constant y over a long weave is the bug.
    const { ys } = trace(7, 2, 200)
    expect(new Set(ys.map((y) => Math.round(y))).size, 'enemy.y never changed — the Y axis is dead').toBeGreaterThan(1)
    expect(range(ys)).toBeGreaterThan(8) // a real vertical excursion, not float jitter
  })

  it('the Y weave is the SAME WINDOW machine — bounded and reversing, not a runaway drift', () => {
    // If Dev bolted on a linear climb the plane would fly off the top. It must weave:
    // stay inside the window and take both up and down runs.
    const { ys } = trace(7, 2, 300)
    const olimMax = Math.max(...need(m.P_OLIM, 'P_OLIM'))
    for (const y of ys) expect(Math.abs(y)).toBeLessThanOrEqual(olimMax + 1) // bounded by the window
    const up = ys.slice(1).some((y, i) => y > ys[i])
    const down = ys.slice(1).some((y, i) => y < ys[i])
    expect(up && down, 'y only moved one way — that is a drift, not the window weave').toBe(true)
  })

  // RETIRED (round 2): `the vertical weave is BIASED by HORIZN`.
  //
  // It was mutation-proven vacuous TWICE independently (Dev, then the Reviewer and
  // test-analyzer): re-adding the HORIZN bias to the Y servo left all 23 tests GREEN. It
  // asserted only that the weave's range-midpoint sits further than HORIZN/2 from zero —
  // which AC-1's ONE-SIDED weave satisfies on its own. Once |y| drops under P.ILIM the plane
  // is driven away from centre on whichever side it is already on, locking into an excursion
  // band of order hundreds of units; HORIZN/2 = 32 is swamped. It passed identically with
  // HORIZN = 0, 0x40, or 999, and would have passed with HORIZN deleted.
  //
  // Worse than vacuous: it asserted a behaviour the code DELIBERATELY does not have (the user
  // ruled the servo unbiased — `SBC I,HORIZN` NORMALIZES Y into display space, it does not
  // displace it), so it could not fail in either direction. It is not replaced by a "better
  // bias test", because there is no bias to test. What the ROM actually does with the pilot's
  // Y is subtract I4YPOS (:91, :2909-2913) — and that is pinned properly, as a real claim
  // with a real failure mode, in tests/core/display-space.test.ts (AC-R1).
  //
  // What survives here is the honest, load-bearing half: HORIZN's BYTE (above) and the Y
  // axis MOVING at all (above). Both bite under mutation.

  it('HORIZN has exactly ONE home — enemy.ts must not fork topology.ts:394 (rb4-6 round 2)', async () => {
    // topology.ts already binds this equate (RBARON.MAC:456) and is wired through
    // scene.ts:49's HORIZN_NDC. Round 1 declared a SECOND `export const HORIZN = 0x40` in
    // enemy.ts, referenced nowhere but its own doc comment and the byte assertion above.
    // One identifier, two homes: edit one, miss the other, and they drift silently — the
    // exact fragility enemy.ts's own P_MNDP comment says this epic exists to kill.
    // Dev: import/re-export from ./topology, or drop it.
    //
    // NOTE (TEA self-check, phase C): the obvious version of this test —
    //   expect(enemy.HORIZN).toBe(topology.HORIZN)
    // is VACUOUS. Both are 0x40 today, so it passes while the fork it exists to catch is
    // sitting right there; it can only ever fire AFTER the two have already drifted, which is
    // the damage. The fork is a STRUCTURAL fact, so assert structure: enemy.ts must not carry
    // its own `export const HORIZN =` binding at all.
    const src = (await import('../../src/core/enemy.ts?raw')).default as string
    const declaresOwn = /^\s*export\s+const\s+HORIZN\s*=/m.test(src)
    expect(
      declaresOwn,
      'enemy.ts declares its own `export const HORIZN` — topology.ts:394 already owns this equate ' +
        '(RBARON.MAC:456) and is wired via scene.ts:49. Import/re-export it instead of forking it.',
    ).toBe(false)
    // ...and whatever enemy.ts exposes must BE topology's value, not a copy that agrees today.
    const topo = (await import('../../src/core/topology')) as { HORIZN?: number }
    expect(topo.HORIZN, 'topology.ts lost its HORIZN — re-derive which module owns the equate').toBe(0x40)
    expect(need(m.HORIZN, 'HORIZN')).toBe(topo.HORIZN)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// AC-1 (round 2) — the per-zone, per-level TARGET DELTAS. The bytes ARE knowable.
// ═══════════════════════════════════════════════════════════════════════════
describe('rb4-6 R2 AC-1 — P.ODLX / P.IDLX / P.IIDL are transcribed, not invented', () => {
  // The three tables are CONTIGUOUS and indexed by zone x GMLEVL. P.WINDW picks the zone by
  // loading a base offset and adding SAVY (= GMLEVL*2, :2760-2761):
  //   outer  -> falls through to P.WCHK with Y = SAVY            -> P.ODLX  (:2782)
  //   middle -> `LDA I,.LEVLS*2` / `JMP P.INR0`                  -> P.IDLX  (:2791-2792)
  //   inner  -> `LDA I,.LEVLS*4` (after `EOR I,0FF`)             -> P.IIDL  (:2797)
  // with `.LEVLS = 5` (:504) — so the offsets *2 and *4 land exactly one and two 5-word
  // tables along. P.WCHK then reads `LDA AY,P.ODLX` (:2806) and servos the CURRENT delta
  // TOWARD it: "CURRENT DELTA=MAX DELTA" -> stop (:2826), else "ACCELERATE SO DELTA=MAX"
  // by +-ACCEL (:2832, :2843-2846), else snap exactly to it (:2834-2840).
  //
  // That is a per-zone TARGET, not one symmetric speed cap. `weaveSpeedCap(ilim)` must go.

  it('P.ODLX — OUTER deltas, `.2WORD 90,8C,84,7C` + `.WORD 80*2` (RBARON.MAC:2948-2949)', () => {
    expect(need(m.P_ODLX, 'P_ODLX')).toEqual([0x90 * 2, 0x8c * 2, 0x84 * 2, 0x7c * 2, 0x80 * 2])
    expect(need(m.P_ODLX, 'P_ODLX')).toEqual([288, 280, 264, 248, 256]) // the assembled decimal
  })

  it('P.IDLX — MIDDLE deltas, `.3WORD 8,14,1C,24` + `.WORD 2C*3` (RBARON.MAC:2952-2953)', () => {
    expect(need(m.P_IDLX, 'P_IDLX')).toEqual([8 * 3, 0x14 * 3, 0x1c * 3, 0x24 * 3, 0x2c * 3])
    expect(need(m.P_IDLX, 'P_IDLX')).toEqual([24, 60, 84, 108, 132])
  })

  it('P.IIDL — INNER deltas, `.3WORD 0,10,18,28` + `.WORD 40*3` (RBARON.MAC:2955-2956)', () => {
    // AC-1 names this table by name: "accelerates toward the P.IIDL target by level".
    // Note P.IIDL[0] = 0 — at GMLEVL 0 the inner target really is a dead stop. 0 is a REAL
    // target, not a missing one; a `|| ` default here would silently promote level 0 to
    // level 1's 48 and nobody would see it.
    expect(need(m.P_IIDL, 'P_IIDL')).toEqual([0 * 3, 0x10 * 3, 0x18 * 3, 0x28 * 3, 0x40 * 3])
    expect(need(m.P_IIDL, 'P_IIDL')).toEqual([0, 48, 72, 120, 192])
  })

  it('the radix is not misread — every table entry is HEX (no trailing dot)', () => {
    // The tp1-7 trap, one game over. `.RADIX 16` from :74 makes bare operands HEX; a trailing
    // dot means decimal (`L.OBJ =28.`, :462). Every operand in these three tables is bare, so
    // a decimal reading of `.3WORD ...,28` would give 84 where the ROM assembles 120.
    expect(need(m.P_IIDL, 'P_IIDL')[3], 'P.IIDL[3] read as decimal 28*3=84 — it is 0x28*3=120').toBe(120)
    expect(need(m.P_ODLX, 'P_ODLX')[1], 'P.ODLX[1] read as decimal 8C is not even a number — 0x8C*2=280').toBe(280)
  })

  it('the servo ACCELERATES THE DELTA TOWARD the zone target and holds there (P.WCHK :2806-2864)', () => {
    // The behaviour the tables exist for. Park a plane in the MIDDLE band (coast zone) where
    // the target is P.IDLX[lvl], and let the servo settle: |deltaX| must converge to that
    // target — not to sqrt(ACCEL*ilim), and not to a flat 100.
    const step = need(m.step, 'step')
    const lvl = 2
    const olim = need(m.P_OLIM, 'P_OLIM')[lvl]
    const ilim = need(m.P_ILIM, 'P_ILIM')[lvl]
    const target = need(m.P_IDLX, 'P_IDLX')[lvl]
    // start mid-band, already moving outward so the zone stays 'middle' for a while
    let e = withEnemy({ x: (ilim + olim) / 2, y: 0, deltaX: 1, kind: 'lead', parallel: false }, 1, lvl)
    let settled = Number.NaN
    for (let f = 0; f < 12 && e.active; f++) {
      e = step(e, lvl)
      const a = Math.abs(e.x)
      if (a >= ilim && a < olim) settled = Math.abs(e.deltaX)
    }
    expect(
      settled,
      `the middle-band delta settled at ${settled} instead of P.IDLX[${lvl}] = ${target} — ` +
        `the servo is still chasing the invented weaveSpeedCap, not the ROM's target`,
    ).toBeCloseTo(target, 0)
  })

  it('WEAVE_SPEED_CAP and weaveSpeedCap are GONE — no invented speed stands in for the tables', async () => {
    // TEA self-check (phase C): the export-probe version of this —
    //   expect((m as any).WEAVE_SPEED_CAP).toBeUndefined()
    // is VACUOUS. Both are module-PRIVATE `const`s, so the probe reads undefined today and
    // would keep reading undefined no matter how alive they are. It proves nothing. They are
    // source-level facts; assert the source.
    const src = (await import('../../src/core/enemy.ts?raw')).default as string
    // strip comments first: the RETRACTION above names both symbols in prose, and a raw grep
    // would match THAT and pass on a comment instead of the code (the tp1-10 trap).
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(
      /\bconst\s+WEAVE_SPEED_CAP\s*=/.test(code),
      'WEAVE_SPEED_CAP survived — the fabricated cap must be deleted in favour of P.ODLX/P.IDLX/P.IIDL',
    ).toBe(false)
    expect(
      /\bconst\s+weaveSpeedCap\s*=/.test(code),
      'weaveSpeedCap survived — the invented sqrt(ACCEL*ilim) must be deleted in favour of the ROM tables',
    ).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// AC-3 — the plane FLIES PAST P.MNDP and is destroyed (it does not hover)
// ═══════════════════════════════════════════════════════════════════════════
describe('rb4-6 AC-3 — fly-past destruction at P.MNDP (P.UPD0, RBARON.MAC:2722-2742)', () => {
  it('WO_RTN is the byte-exact re-entry delay — 0x10 = 16 frames (RBARON.MAC:473, .RADIX 16)', () => {
    expect(need(m.WO_RTN, 'WO_RTN')).toBe(0x10)
    expect(need(m.WO_RTN, 'WO_RTN')).not.toBe(10)
  })

  it('WO_RTN is actually WIRED — a constant whose only consumer is this test is not a delay', async () => {
    // Round 1 exported WO_RTN with the doc "Exported for the returning-ace arming wiring" and
    // then wired nothing: `grep -rn WO_RTN src/` returns the declaration and nothing else. Its
    // only "consumer" was the byte assertion above, which is why AC-3's "with the WO.RTN
    // re-entry delay" reads as covered while being entirely absent.
    //
    // The ROM: a fly-past stores `PLSTAT+7 = WO.RTN` (:2736) to hold the slot empty, and the
    // returning pass resolves when that same counter reaches 0x0C (`CMP I,0C`, :1078-1080 —
    // our ACE_ATTACK_FRAMES). So WO.RTN=0x10 SEEDS the counter that ACE_ATTACK_FRAMES=0x0C
    // then triggers on: a real 4-frame re-entry delay, not two unrelated constants.
    //
    // Dev: either wire it (seed the ace countdown from WO_RTN on the fly-past) or DELETE the
    // export and log the descope. Do not leave fidelity-shaped scenery.
    //
    // This reads source because "is it referenced outside its own declaration?" has no runtime
    // seam. It therefore matches an IMPORT BINDING, not the bare token: a `?raw` guard that
    // greps for a name is defeated the moment someone writes the name in a COMMENT near the
    // call site (the tp1-10 lesson — the guard then passes on prose, not code). An import list
    // is code by construction, so a comment cannot satisfy it.
    const importsWoRtn = (src: string): boolean =>
      /import\s*{[^}]*\bWO_RTN\b[^}]*}\s*from\s*['"][^'"]*enemy['"]/.test(src)
    const main = (await import('../../src/main.ts?raw')).default as string
    const ace = (await import('../../src/core/returning-ace.ts?raw')).default as string
    expect(
      importsWoRtn(main) || importsWoRtn(ace),
      "WO_RTN is imported by neither main.ts nor returning-ace.ts — AC-3's re-entry delay is unimplemented " +
        'and the export is dead. Wire it (seed the ace countdown on fly-past), or drop the export and log it.',
    ).toBe(true)
  })

  it('a closing plane is DEACTIVATED when it bores past P.MNDP — it does not stay active forever', () => {
    // The core of AC-3. Old machine: depth = Math.max(depth+Δ, P.MNDP) → the plane
    // pins at the floor with active===true for all time. New machine: it flies past,
    // PLSTAT+6 is cleared, the object is gone → active===false.
    const step = need(m.step, 'step')
    for (const level of [0, 3, 5]) {
      let e = spawnAt(7, level)
      let deactivatedAt = -1
      for (let f = 0; f < 4000 && deactivatedAt < 0; f++) {
        e = step(e, level)
        if (!e.active) deactivatedAt = f
      }
      expect(deactivatedAt, `GMLEVL ${level}: the plane hovered active forever — it never flew past`).toBeGreaterThan(
        0,
      )
    }
  })

  it('depth is NOT floored at P.MNDP — the plane closes THROUGH it on the fly-by', () => {
    // Distinguish the clamp from the fly-past directly: the plane's depth must reach
    // BELOW P.MNDP as it flies past (the ROM keeps subtracting; there is no Math.max
    // floor). We sample the depth on the frame it deactivates.
    const step = need(m.step, 'step')
    const mndp = need(m.P_MNDP, 'P_MNDP')
    let e = spawnAt(7, 5) // fastest closer, so it clears the floor decisively
    let flewPastDepth = Number.NaN
    for (let f = 0; f < 4000; f++) {
      const next = step(e, 5)
      if (!next.active) {
        flewPastDepth = next.depth
        break
      }
      e = next
    }
    expect(Number.isNaN(flewPastDepth), 'the plane never flew past to sample a depth').toBe(false)
    expect(flewPastDepth, 'depth was clamped at the P.MNDP floor — it did not bore through').toBeLessThan(mndp)
  })

  it('deactivation is COUPLED to the returning-attack trigger — only fires once past P.MNDP', () => {
    // AC-3: the fly-past ARMS the returning attack. main.ts arms it via
    // returning-ace.closesPast(depth) === depth <= P.MNDP. The plane must not vanish
    // while it is still a far, live threat — it deactivates only after closing past
    // that same threshold the pass is armed on.
    const step = need(m.step, 'step')
    const mndp = need(m.P_MNDP, 'P_MNDP')
    let e = spawnAt(7, 4)
    let lastActiveDepth = e.depth
    let deactivated = false
    for (let f = 0; f < 4000; f++) {
      const next = step(e, 4)
      if (!next.active) {
        deactivated = true
        break
      }
      lastActiveDepth = next.depth
      e = next
    }
    // BOTH HALVES (round 2). This test only ever asserted the second half — that the plane
    // is not destroyed while far away — and was mutation-proven to pass against the OLD
    // clamp-forever machine, where the loop simply runs out at 4000 frames and
    // `lastActiveDepth` settles at the clamped floor, still satisfying `<= mndp+1`. A guard
    // that holds when the behaviour it guards never happens is scenery. Assert the event.
    expect(deactivated, 'the plane NEVER deactivated in 4000 frames — it is hovering at a floor again').toBe(true)
    // ...and it was never destroyed while it was still a far, live threat.
    expect(lastActiveDepth, 'the plane deactivated while still far from the player').toBeLessThanOrEqual(mndp + 1)
  })

  it('stepping an already-destroyed plane is idempotent — no resurrection, safe for map()', () => {
    // main.ts steps the whole wave with map(); a deactivated plane stepped again must
    // stay deactivated (and unchanged), so the filter that drops it is stable.
    const step = need(m.step, 'step')
    const dead = withEnemy({ active: false, depth: 10, kind: 'lead', parallel: false }, 1, 0)
    const stepped = step(dead, 0)
    expect(stepped.active).toBe(false)
    expect(stepped).toEqual(dead)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// AC-4 — drones: a two-phase PARALLEL → FREE formation, spawned at DRINZ
// ═══════════════════════════════════════════════════════════════════════════
describe('rb4-6 AC-4 — drone two-phase formation (spawn :2362-2389, FRDRNE :3511-3528)', () => {
  const droneWave = (seed = 3, score = 1500, level = 0): { lead: Enemy; drones: Enemy[]; wave: readonly Enemy[] } => {
    const spawnWave = need(w.spawnWave, 'spawnWave')
    // Retry seeds until the 25% lone-plane roll does NOT fire, so drones are fielded.
    for (let s = seed; s < seed + 50; s++) {
      const wave = spawnWave(createRng(s), score, level)
      const drones = wave.filter((e) => e.kind === 'drone')
      if (drones.length > 0) return { lead: wave.find((e) => e.kind === 'lead')!, drones: [...drones], wave }
    }
    throw new Error('no drone wave in 50 seeds (lone roll never cleared)')
  }

  it('DRINZ is the byte-exact drone spawn depth — 0x1600 = 5632 (RBARON.MAC:466, .RADIX 16)', () => {
    expect(need(m.DRINZ, 'DRINZ')).toBe(0x1600)
    expect(need(m.DRINZ, 'DRINZ')).not.toBe(1600)
  })

  it('drones spawn DEEPER than the lead — at DRINZ, not sharing the lead depth', () => {
    // Today: waves.ts does {...lead, kind:'drone'}, so drone.depth === lead.depth ===
    // P.INDP. The ROM seeds P.1ST+5 = DRINZ/100 → the drones enter FARTHER back.
    const { lead, drones } = droneWave()
    const drinz = need(m.DRINZ, 'DRINZ')
    for (const d of drones) {
      expect(d.depth, 'the drone inherited the lead depth instead of DRINZ').toBe(drinz)
    }
    expect(drinz).toBeGreaterThan(lead.depth) // DRINZ (0x1600) is deeper than P.INDP (0x1080)
  })

  it('a fresh drone is in the PARALLEL phase; a lead never is', () => {
    // PLSTAT+6 = 2 "FORMATION FLIGHT" (:2368). The discriminant must exist and carry
    // the ROM's entry state — strict booleans so an omitted (undefined) field fails.
    const { lead, drones } = droneWave()
    expect(lead.parallel).toBe(false)
    for (const d of drones) expect(d.parallel).toBe(true)
  })

  it('PARALLEL drones hold FORMATION with the lead — they do not weave off on their own', () => {
    // While parallel, FRDRNE keeps a drone's position as a fixed OFFSET from the lead
    // (:3516-3528): it rides the lead's motion. The old code steps each drone through
    // the SAME weave from a different x, so the offset diverges immediately. Pin that
    // the lead↔drone offset stays ~constant across the early (still-parallel) frames.
    const stepWave = need(w.stepWave, 'stepWave')
    const { wave } = droneWave()
    let live = wave
    const offsetsOf = (ws: readonly Enemy[]): number[] => {
      const ld = ws.find((e) => e.kind === 'lead')!
      return ws.filter((e) => e.kind === 'drone' && e.parallel).map((d) => d.x - ld.x)
    }
    const first = offsetsOf(wave)
    // PRECONDITION (round 2). `offsetsOf` filters on `e.parallel`, so if drones are never
    // flagged parallel at spawn this test compares [] to [] and passes having asserted
    // NOTHING — mutation-proven: reverting the spawn to `{...lead, kind:'drone'}` left it
    // GREEN. Pin the precondition explicitly, or the guard is scenery.
    expect(first.length, 'no PARALLEL drone at spawn — this test would compare two empty arrays').toBeGreaterThan(0)
    for (let f = 0; f < 5; f++) live = stepWave(live, 0)
    const later = offsetsOf(live)
    expect(later.length, 'the drones left formation immediately — no PARALLEL phase').toBe(first.length)
    for (let i = 0; i < first.length; i++) {
      // In formation the offset barely moves; an independent weave would swing it by
      // tens of units within five frames.
      expect(Math.abs(later[i] - first[i]), 'a PARALLEL drone drifted out of formation — it wove independently').toBeLessThan(
        8,
      )
    }
  })

  it('drones eventually BREAK to FREE and then weave on their own (parallel → false)', () => {
    // FRDRNE shifts PLSTAT+6 2 → 1 and resolves the offset to absolute (:3514-3528);
    // thereafter the drone is a free weaver. Over a long enough flight at least one
    // drone must transition out of the formation phase.
    const stepWave = need(w.stepWave, 'stepWave')
    const { wave } = droneWave()
    let live = wave
    // PRECONDITION (round 2). `sawFree` looks for a drone with `!parallel` — which is
    // trivially TRUE from frame 0 if drones are never flagged parallel at all. Mutation-proven
    // vacuous in that state. Require the formation to EXIST before proving it breaks.
    expect(
      wave.some((e) => e.kind === 'drone' && e.parallel),
      'no PARALLEL drone at spawn — `sawFree` would be true from frame 0 having proven nothing',
    ).toBe(true)
    let sawFree = false
    for (let f = 0; f < 300 && !sawFree; f++) {
      live = stepWave(live, 0)
      sawFree = live.some((e) => e.kind === 'drone' && !e.parallel)
    }
    expect(sawFree, 'the drones never left the PARALLEL phase — the formation never broke').toBe(true)
  })

  it('stepWave drops fly-past planes — a wave does not accumulate destroyed objects', () => {
    // AC-3 at the wave layer: stepWave removes deactivated (flown-past) planes, so the
    // live wave shrinks as planes bore past rather than piling up at a depth floor.
    const stepWave = need(w.stepWave, 'stepWave')
    const { wave } = droneWave(3, 1500, 5) // fast closers
    let live: readonly Enemy[] = wave
    const start = live.length
    for (let f = 0; f < 4000 && live.length > 0; f++) live = stepWave(live, 5)
    expect(live.length, 'planes never flew past — the wave never emptied').toBeLessThan(start)
    for (const e of live) expect(e.active).toBe(true) // no destroyed object left in the wave
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Rule coverage (lang-review TS checklist) — pure-sim contract
// ═══════════════════════════════════════════════════════════════════════════
describe('rb4-6 — rule coverage (totality, 0-not-falsy, purity)', () => {
  it('#4 totality: step() survives a degenerate GMLEVL on BOTH axes (NaN/±Inf/negative)', () => {
    const step = need(m.step, 'step')
    for (const bad of [-1, 99, Number.NaN, Number.POSITIVE_INFINITY, 2.7]) {
      const s = step(spawnAt(3, bad), bad)
      expect(Number.isFinite(s.x)).toBe(true)
      expect(Number.isFinite(s.y), `a GMLEVL of ${String(bad)} leaked a non-finite y`).toBe(true)
      expect(Number.isFinite(s.depth)).toBe(true)
    }
  })

  it('#4 0-is-valid: GMLEVL 0 is honoured, not defaulted away (a falsy level is a real level)', () => {
    // 0 is a valid GMLEVL — the FIRST level, not "missing". A `level || 1` bug would skip
    // it and read the wrong window. The two windows differ (P_OLIM[1] > P_OLIM[0]), so a
    // defaulted level is observable: a level-0 plane driven through step() must stay inside
    // the NARROW level-0 window, never widen to level 1's.
    const step = need(m.step, 'step')
    const olim0 = need(m.P_OLIM, 'P_OLIM')[0]
    const olim1 = need(m.P_OLIM, 'P_OLIM')[1]
    expect(olim1).toBeGreaterThan(olim0) // the windows differ, so "defaulted to level 1" would show
    let e = spawnAt(7, 0)
    for (let f = 0; f < 200 && e.active; f++) {
      e = step(e, 0)
      expect(Math.abs(e.x), 'a level-0 plane escaped its window — GMLEVL 0 was defaulted away').toBeLessThanOrEqual(
        olim0 + 1,
      )
    }
  })

  it('#2 purity: step() does not mutate its input (readonly contract)', () => {
    const step = need(m.step, 'step')
    const e = spawnAt(3, 2)
    const snapshot = JSON.stringify(e)
    expect(step(e, 2)).toEqual(step(e, 2)) // deterministic
    expect(JSON.stringify(e)).toBe(snapshot) // input untouched
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 3 — the tables are CONSUMED, not just declared (Reviewer round 2)
// ═══════════════════════════════════════════════════════════════════════════
//
// Round 2 byte-pinned P.ODLX/P.IDLX/P.IIDL and the review proved the pins bite on the
// TABLES — but not on their CONSUMPTION: mutating `target = iidl` to `iidl || 48` (the
// exact 0-is-valid trap P_IIDL's own doc warns about) and `target = odlx` to `odlx * 2`
// inside windowServo both left all 1069 tests green. Only the middle band had a
// convergence test. These pin the other two zones END-TO-END through step().
//
// A derivation note on the OUTER zone, because the obvious test cannot work: on the X
// axis our ±P_OLIM position clamp makes the outer zone a ONE-FRAME wall event (any
// inward delta puts |x| < olim next frame), so ΔX never converges to P.ODLX — the value
// is unobservable there until the PLONSN successor removes the clamp / ports MAXDEL
// entry deltas. The Y axis is different: at GMLEVL 0 the UPDPLN altitude floor (128)
// sits ABOVE the level-0 window (olim = 64), so the plane is pinned INSIDE the outer
// zone permanently and its ΔY genuinely servos all the way to -P.ODLX[0] and holds.
// That pin is also the documented home of the round-2 audit annotation: at every level
// the eye-free servo eventually parks the altitude at a band edge (128 or 320) — the
// sustained vertical cat-and-mouse is the successor story's business (PLONSN).
describe('rb4-6 R3 — zone targets consumed through step() (P.WCHK :2806-2864)', () => {
  it('OUTER: GMLEVL 0 altitude-floored plane servos ΔY to exactly -P_ODLX[0] and HOLDS', () => {
    const step = need(m.step, 'step')
    const odlx0 = need(m.P_ODLX, 'P_ODLX')[0]
    let e = spawnAt(5, 0)
    for (let f = 0; f < 20; f++) e = step(e, 0)
    // y is pinned at the UPDPLN floor (the ROM's own [PFPLOW, PFPHI] band, :2595-2611) —
    // above the level-0 window, so the zone is OUTER forever and the target is P.ODLX[0].
    expect(
      e.deltaY,
      `ΔY settled at ${e.deltaY} instead of -P.ODLX[0] = ${-odlx0} — the outer-zone target ` +
        'is not being consumed (an over/under-scaled odlx changes nothing in the X cycle, only here)',
    ).toBe(-odlx0)
    const held = step(e, 0)
    expect(held.deltaY, 'the settled outer delta must HOLD (snap-to-target, :2826)').toBe(-odlx0)
  })

  it('INNER: a boresight-centred GMLEVL 2 plane accelerates ΔX to exactly +P_IIDL[2] inside the window', () => {
    const step = need(m.step, 'step')
    const iidl2 = need(m.P_IIDL, 'P_IIDL')[2]
    const ilim2 = need(m.P_ILIM, 'P_ILIM')[2]
    // |x| < P_ILIM[2] = 128 → inner zone; heading AWAY from centre (+1 for x >= 0), target
    // P_IIDL[2] = 72. From rest: 48, then snap to 72 (:2834-2840) — settled by frame 3,
    // still deep inside the 128-wide window, so the settle is provably an INNER-zone fact.
    let e = withEnemy({ x: 0, y: 200, deltaX: 0, deltaY: 0, entryFrames: 0, kind: 'lead', parallel: false }, 1, 2)
    for (let f = 0; f < 3; f++) e = step(e, 2)
    expect(Math.abs(e.x), 'the plane left the inner window before settling — retune the frame count').toBeLessThan(ilim2)
    expect(
      e.deltaX,
      `ΔX reached ${e.deltaX} instead of +P.IIDL[2] = ${iidl2} — the inner-zone target is not consumed`,
    ).toBe(iidl2)
  })

  it('INNER at GMLEVL 0: P_IIDL[0] = 0 is CONSUMED as a dead stop — `|| 48` would move the plane', () => {
    // The 0-is-valid trap, pinned END-TO-END: the export-level toEqual above catches a
    // corrupted TABLE, but `target = iidl || 48` inside the servo corrupts CONSUMPTION and
    // left the whole suite green (review round 2). Here a level-0 plane parked dead-centre
    // must STAY parked: want = heading × 0 = 0, so ΔX pins at 0 and x never moves.
    const step = need(m.step, 'step')
    let e = withEnemy({ x: 0, y: 200, deltaX: 0, deltaY: 0, entryFrames: 0, kind: 'lead', parallel: false }, 1, 0)
    for (let f = 0; f < 15; f++) {
      e = step(e, 0)
      expect(e.deltaX, 'a GMLEVL-0 inner plane grew ΔX — P.IIDL[0]=0 was defaulted away at the point of use').toBe(0)
      expect(e.x, 'a GMLEVL-0 inner plane MOVED — the dead stop is not being honoured').toBe(0)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 3 — STPLNE's spawn altitude is a transcription, so PIN it (Reviewer round 2)
// ═══════════════════════════════════════════════════════════════════════════
//
// Round 2 shipped `spawnAltitude` as a fully-cited byte transcription (:2310-2316) with
// ZERO tests behind it — reverting it to round 1's ±40 screen offset left 1069 green
// (Dev self-reported it; the review confirmed). A citation with no test is scenery.
//
// The pin needs no golden float and no RNG mirroring: the bit-twiddle is RECOVERABLE
// from its own output. STPLNE computes lsb = (r + 0x80) & 0xFF and msb = (lsb & 1) + 1
// + carry, where the carry from `ADC I,80` is set iff r >= 0x80 — and r >= 0x80 ⟺
// lsb < 0x80. So for every UNCLAMPED spawn, msb must equal (lsb&1) + 1 + (lsb<0x80 ? 1:0).
// Dropping the carry, mis-anding, or reverting to ±40 all break the identity.
describe('rb4-6 R3 — spawn altitude is STPLNE (RBARON.MAC:2310-2316), not an offset', () => {
  it("every spawn's y×4 sits in STPLNE's band and satisfies the bit-twiddle identity", () => {
    const spawn = need(m.spawn, 'spawn')
    const PFPLOW = 0x80 * 4 // topology.ts:396, RBARON.MAC:448 — the UPDPLN altitude floor
    const RAW_MAX = 0x37f // r=0xFF → lsb=0x7F, carry=1 → msb=3 → 0x37F: the twiddle's true max
    let unclamped = 0
    for (let seed = 1; seed <= 200; seed++) {
      const raw = spawn(createRng(seed), 0).y * 4 // undo ALT_TO_Y = 1/4 exactly (raw is integer)
      expect(Number.isInteger(raw), `seed ${seed}: y×4 = ${raw} is not an integer — not a 16-bit altitude`).toBe(true)
      expect(raw, `seed ${seed}: spawn altitude ${raw} below the PFPLOW clamp`).toBeGreaterThanOrEqual(PFPLOW)
      expect(raw, `seed ${seed}: spawn altitude ${raw} above STPLNE's reachable max`).toBeLessThanOrEqual(RAW_MAX)
      if (raw === PFPLOW) continue // the UPDPLN floor clamp — lsb not recoverable here
      unclamped++
      const lsb = raw & 0xff
      const msb = raw >> 8
      expect(
        msb,
        `seed ${seed}: msb ${msb} ≠ (lsb&1)+1+carry for lsb=0x${lsb.toString(16)} — ` +
          'the STPLNE bit-twiddle (:2312-2316, carry surviving the AND) is not what produced this altitude',
      ).toBe((lsb & 1) + 1 + (lsb < 0x80 ? 1 : 0))
    }
    // anti-vacuity: the identity branch must actually run (the clamp cannot eat every seed)
    expect(unclamped, 'every spawn hit the clamp — the identity above never ran').toBeGreaterThan(50)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 3 — step() is TOTAL on a degenerate altitude (RED for Dev: harden clamp)
// ═══════════════════════════════════════════════════════════════════════════
describe('rb4-6 R3 — totality: a NaN coordinate cannot poison the per-frame state', () => {
  it('step() returns finite x/y for a hand-built NaN fixture (clamp must not propagate NaN)', () => {
    // Review round 2 [SEC]: `clamp(NaN, lo, hi)` is NaN (Math.max/min semantics), so a NaN
    // that ever reaches enemy.x/y persists forever. Unreachable from spawn today (all
    // producers finite, levelIndex sanitizes) — this pins the boundary so it STAYS
    // unreachable when future callers hand-build fixtures or thread new inputs in.
    // RED on HEAD by design: Dev hardens the clamp (one line) to make it green.
    const step = need(m.step, 'step')
    const badY = step(withEnemy({ y: Number.NaN, entryFrames: 0 }, 1, 2), 2)
    expect(Number.isFinite(badY.y), 'a NaN altitude survived step() — clamp() propagates NaN').toBe(true)
    const badX = step(withEnemy({ x: Number.NaN, entryFrames: 0 }, 1, 2), 2)
    expect(Number.isFinite(badX.x), 'a NaN x survived step() — clamp() propagates NaN').toBe(true)
  })
})

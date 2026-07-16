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
// WHAT THIS SUITE DELIBERATELY DOES NOT PIN (logged as a deviation): the per-level
// weave-speed magnitudes P.ODLX/P.IDLX/P.IIDL (RBARON.MAC:2948-2956). Their
// `.2WORD`/`.3WORD` macros carry an unverified ×2/×3 scale and there is NO baked
// artifact to arbitrate a transcription — pinning a byte here would risk the exact
// "read the table, ship a fabricated constant" trap the epic exists to kill. The
// inner-window BEHAVIOUR (reverses away from centre, per-level) is pinned instead.
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

  it('the vertical weave is BIASED by HORIZN — it oscillates off screen-centre, not around y=0', () => {
    // `SBC I,HORIZN` (:2750) offsets the Y position before the window test, so the
    // plane weaves around y ≈ HORIZN, not around 0. Pin the CENTRE-LINE of the
    // oscillation (its range midpoint), which the mean-of-a-constant can't fake:
    // require a real vertical excursion first (fails on the frozen-y old machine),
    // then that its midpoint is displaced from 0 by order HORIZN.
    const horizn = need(m.HORIZN, 'HORIZN')
    const { ys } = trace(7, 3, 400)
    expect(range(ys), 'y never moved — the Y window machine is absent').toBeGreaterThan(8)
    const midpoint = (Math.max(...ys) + Math.min(...ys)) / 2
    expect(Math.abs(midpoint), 'the vertical weave is centred on 0 — HORIZN was not applied').toBeGreaterThan(
      horizn / 2,
    )
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
    for (let f = 0; f < 4000; f++) {
      const next = step(e, 4)
      if (!next.active) break
      lastActiveDepth = next.depth
      e = next
    }
    // On the last frame it was still alive it had already closed to (or past) P.MNDP —
    // it was never destroyed while far away.
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

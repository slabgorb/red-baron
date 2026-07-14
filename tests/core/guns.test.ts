// tests/core/guns.test.ts
//
// Story rb2-5 — RED phase (Furiosa / TEA). Machine-gun fire + hit detection: the
// player finally shoots back at rb2-4's live enemy. Alternating L/R guns, the
// GUN.ST gun-overheat model, a 13-slot shell pool that advances in Z and expires
// at S.MAXZ, shells sub-stepped 4× per calc-frame, and CDSSET/SHCDCK rotated
// collision windows that decide a hit. Grounded in findings §5 (collision/damage)
// and §1 (the load-bearing calc-frame cadence). It unblocks rb2-6 (kill →
// explosion + scoring), which consumes the hits this module reports.
//
// CONTRACT for the GREEN phase (The Word Burgers / DEV): create
// `src/core/guns.ts`, the pure player-gun sim, exporting:
//
//   // --- ROM-exact data (findings §5, §1, R2BRON.MAC) ---
//   export const SHELL_SLOTS: number        // 13 shell slots (findings §5)
//   export const S_MAXZ: number              // shells expire at S.MAXZ = 19 (findings §5)
//   export const SHELL_SUBSTEPS: number      // SHLMOT: 4× sub-step per calc-frame (findings §1/§5)
//   export const GUN_HEAT_PER_SHOT: number   // GUN.ST +1 per shot (findings §5)
//   export const GUN_COOL_RATE: number       // cools ×3 when not firing = 3 (findings §5)
//
//   export type Gun = 'left' | 'right'       // the alternating muzzles
//
//   export interface Shell {
//     readonly x: number        // aim window-X at fire (enemy.x space)
//     readonly y: number        // aim window-Y at fire (enemy.y space)
//     readonly z: number        // range progress 0..S_MAXZ; advances 4×/calc-frame, expires at S_MAXZ
//     readonly gun: Gun         // which muzzle it left
//     readonly active: boolean  // in-flight flag
//   }
//
//   export interface Guns {
//     readonly shells: readonly Shell[]  // up to SHELL_SLOTS in flight
//     readonly heat: number              // GUN.ST accumulator
//     readonly overheated: boolean       // locked out until cooled
//     readonly nextGun: Gun              // alternation cursor — the gun the NEXT shot uses
//   }
//
//   export interface Hit {
//     readonly shell: Shell     // the shell that struck (rb2-6 scores/explodes from it)
//     readonly target: number   // index into the `targets` array that was hit
//   }
//
//   export const INITIAL_GUNS: Guns
//
//   // NEWSHL / GUN.ST — one calc-frame of the trigger. `fireHeld` true: fire from the
//   // alternating gun when a slot is free AND not overheated, heat += GUN_HEAT_PER_SHOT,
//   // flip nextGun. `fireHeld` false: cool by GUN_COOL_RATE (clamped ≥ 0), clearing the
//   // overheat lockout once cool. Fires at most ONE shell per calc-frame.
//   export function fire(guns: Guns, fireHeld: boolean): Guns
//
//   // SHLMOT + SHCDCK — advance every shell in Z across SHELL_SUBSTEPS sub-steps,
//   // testing collision vs each target at EACH sub-step (so a fast shell can't tunnel
//   // past a thin enemy between calc-frames), expire shells at S_MAXZ, and remove shells
//   // that struck a target. Returns the surviving guns + the hits for rb2-6.
//   export function step(guns: Guns, targets: readonly Enemy[]): { guns: Guns; hits: readonly Hit[] }
//
//   // CDSSET / SHCDCK — is this player shell inside the enemy's rotated/projected
//   // min-max collision window? (Enemy shells are never passed here — this module holds
//   // only player shells, so "enemy shells skipped" is satisfied structurally.)
//   export function collides(shell: Shell, enemy: Enemy): boolean
//
// WHY THIS SHAPE (cited — findings §5 "Collision / damage", §1 "cadence", R2BRON.MAC):
//   * ALTERNATING L/R GUNS + GUN-OVERHEAT (NEWSHL/NWSHL1, R2BRON.MAC:2149-2233): fire
//     while held, alternating muzzles; GUN.ST climbs +1 per shot and cools ×3 when the
//     trigger is released; an overheated gun locks out and shows a warning. The exact
//     overheat THRESHOLD is not pinned by the findings doc — it is Dev tuning (like
//     enemy.ts's WEAVE_SPEED_CAP). Pinned here BEHAVIOURALLY: sustained fire eventually
//     overheats and stops firing even with slots free; releasing cools it and re-enables
//     firing. The +1 heat, the ×3 cool, the 13 slots, and S.MAXZ=19 ARE byte-pinned.
//   * 13 SHELL SLOTS, EXPIRE AT S.MAXZ=19: shells advance in Z each calc-frame and expire
//     at S.MAXZ, freeing the slot. At most 13 are ever in flight.
//   * 4× SUB-STEP (SHLMOT, RBARON.MAC:5186-5198) — the anti-tunnelling rule. A shell is
//     integrated in 4 sub-steps per calc-frame and collision is checked at each, so a
//     bullet moving a long way in one 96 ms frame cannot skip THROUGH an enemy. Pinned
//     BEHAVIOURALLY by a depth sweep: a dead-on shot must connect at EVERY reachable
//     depth with NO interior gaps — a frame-boundary-only check would leave holes.
//   * CDSSET/SHCDCK ROTATED COLLISION WINDOWS (findings §5) — NOT a per-pixel test and
//     NOT infinite-range hitscan. A hit needs the enemy inside the shell's projected x/y
//     window AND within shell range (S.MAXZ). The exact window size and the depth→range
//     projection are Dev tuning; pinned here by extremes: dead-on centred → hit; far
//     off-axis (x or y) → miss; absurd depth → miss (finite range).
//
// The ROM DATA is pinned to the byte (13, 19, 4, +1, ×3). Where the overheat threshold,
// the shell speed, the window dimensions, and the depth→range projection are Dev tuning
// (the findings doc does not pin them), the behaviour is pinned BEHAVIOURALLY — alternation,
// heat monotonicity, lockout+recovery, slot cap, monotone travel + expiry, no-tunnelling
// contiguity, off-axis/finite-range misses — not as fabricated constants.
//
// Loaded defensively (await import in beforeAll, the enemy.test.ts house pattern): during
// RED `src/core/guns.ts` does not exist, so each test reports a clean assertion failure
// instead of a suite-collection crash. enemy.ts DOES exist (rb2-4, on develop) — imported
// statically so the collision tests fire at the REAL enemy geometry.

import { describe, it, expect, beforeAll } from 'vitest'
import { createRng } from '@arcade/shared/rng'
import { spawn, type Enemy } from '../../src/core/enemy'

// --- local mirror of the RED contract (kept out of the static import graph so the file
//     loads while src/core/guns.ts does not yet exist) ---

type Gun = 'left' | 'right'

interface Shell {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly gun: Gun
  readonly active: boolean
}

interface Guns {
  readonly shells: readonly Shell[]
  readonly heat: number
  readonly overheated: boolean
  readonly nextGun: Gun
}

interface Hit {
  readonly shell: Shell
  readonly target: number
}

interface GunsModule {
  SHELL_SLOTS?: number
  S_MAXZ?: number
  SHELL_SUBSTEPS?: number
  GUN_HEAT_PER_SHOT?: number
  GUN_COOL_RATE?: number
  INITIAL_GUNS?: Guns
  fire?: (guns: Guns, fireHeld: boolean) => Guns
  step?: (guns: Guns, targets: readonly Enemy[]) => { guns: Guns; hits: readonly Hit[] }
  collides?: (shell: Shell, enemy: Enemy) => boolean
}

let m: GunsModule = {}

beforeAll(async () => {
  try {
    m = (await import('../../src/core/guns')) as GunsModule
  } catch {
    m = {}
  }
})

/** Fail loud-and-clear when a contract export is missing (RED-friendly). */
function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`src/core/guns.ts must export ${name} (rb2-5 RED contract)`)
  }
  return value
}

const initial = (): Guns => need(m.INITIAL_GUNS, 'INITIAL_GUNS')
const other = (g: Gun): Gun => (g === 'left' ? 'right' : 'left')

/** An enemy pinned at a chosen screen position + depth (real rb2-4 geometry, fixed pose). */
const enemyAt = (x: number, y: number, depth: number, bank = 0): Enemy => ({
  ...spawn(createRng(1), 0),
  x,
  y,
  depth,
  bank,
})

/** Hold the trigger for `frames` calc-frames against 0..1 targets; collect every hit. */
function runHold(target: Enemy | null, frames: number): { hits: Hit[]; guns: Guns } {
  const fire = need(m.fire, 'fire')
  const step = need(m.step, 'step')
  const targets = target ? [target] : []
  let guns = initial()
  const hits: Hit[] = []
  for (let i = 0; i < frames; i++) {
    guns = fire(guns, true)
    const r = step(guns, targets)
    guns = r.guns
    hits.push(...r.hits)
  }
  return { hits, guns }
}

/** Fire exactly ONE shell, then let it fly (no more firing) against a fixed target. */
function fireOnceThenStep(target: Enemy, frames: number): { hits: Hit[]; guns: Guns } {
  const fire = need(m.fire, 'fire')
  const step = need(m.step, 'step')
  let guns = fire(initial(), true)
  const hits: Hit[] = []
  for (let i = 0; i < frames && guns.shells.length > 0; i++) {
    const r = step(guns, [target])
    guns = r.guns
    hits.push(...r.hits)
  }
  return { hits, guns }
}

const didHit = (target: Enemy, frames = 40): boolean => runHold(target, frames).hits.length > 0

/** Fire one shell and step it against a MULTI-target list; return the first Hit (or null). */
function firstHitOf(targets: readonly Enemy[], frames = 40): Hit | null {
  const fire = need(m.fire, 'fire')
  const step = need(m.step, 'step')
  let guns = fire(initial(), true)
  for (let i = 0; i < frames && guns.shells.length > 0; i++) {
    const r = step(guns, targets)
    guns = r.guns
    if (r.hits.length > 0) return r.hits[0]
  }
  return null
}

// A wide depth sweep for the collision / no-tunnelling tests. Memoised — the sweep is the
// heaviest work in the suite, so compute the hit map once and share it.
const DEPTHS: readonly number[] = Array.from({ length: 120 }, (_, i) => 10 + i * 10) // 10..1200
let _hitMap: boolean[] | null = null
const hitMap = (): boolean[] => (_hitMap ??= DEPTHS.map((d) => didHit(enemyAt(0, 0, d))))
/** The nearest depth at which a dead-on shot actually connects (guns must work). */
const reachDepth = (): number => {
  const idx = hitMap().indexOf(true)
  if (idx < 0) throw new Error('no depth connected — the guns never hit a centred enemy')
  return DEPTHS[idx]
}

// ───────────────────────────────────────────────────────────────────────────
// AC-1 — ROM-exact constants (13 slots, S.MAXZ=19, 4× sub-step, +1 heat, ×3 cool)
// ───────────────────────────────────────────────────────────────────────────
describe('guns — ROM constants (findings §5, §1)', () => {
  it('SHELL_SLOTS is 13 (findings §5)', () => {
    expect(need(m.SHELL_SLOTS, 'SHELL_SLOTS')).toBe(13)
  })

  // rb4-1 RE-BASELINE: `S.MAXZ =19` sits in RBARON.MAC's `.RADIX 16` region (set at
  // :74), so it is 0x19 = 25. Our shells travelled 19/24 of the ROM's range and died
  // 96 ms early. Derivation audited in tests/audit/radix-transcription.test.ts.
  it('S_MAXZ — shells expire at 0x19 = 25 (S.MAXZ, RBARON.MAC:492, .RADIX 16)', () => {
    expect(need(m.S_MAXZ, 'S_MAXZ')).toBe(0x19)
    expect(need(m.S_MAXZ, 'S_MAXZ')).not.toBe(19) // the decimal misreading we shipped
  })

  it('SHELL_SUBSTEPS — SHLMOT sub-steps 4× per calc-frame (findings §1/§5, RBARON.MAC:5186-5198)', () => {
    expect(need(m.SHELL_SUBSTEPS, 'SHELL_SUBSTEPS')).toBe(4)
  })

  it('GUN_HEAT_PER_SHOT — GUN.ST climbs +1 per shot (findings §5)', () => {
    expect(need(m.GUN_HEAT_PER_SHOT, 'GUN_HEAT_PER_SHOT')).toBe(1)
  })

  it('GUN_COOL_RATE is 3 and cools 3× as fast as one shot heats (findings §5)', () => {
    const cool = need(m.GUN_COOL_RATE, 'GUN_COOL_RATE')
    expect(cool).toBe(3)
    expect(cool).toBe(3 * need(m.GUN_HEAT_PER_SHOT, 'GUN_HEAT_PER_SHOT')) // the "×3" relationship
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-2 — INITIAL_GUNS: a cold, empty, un-overheated battery
// ───────────────────────────────────────────────────────────────────────────
describe('guns — INITIAL_GUNS', () => {
  it('starts cold and empty with a valid starting muzzle (heat 0 is a REAL value, rule #4)', () => {
    const g = need(m.INITIAL_GUNS, 'INITIAL_GUNS')
    expect([...g.shells]).toEqual([]) // no shells in flight
    expect(g.heat).toBe(0) // 0 is a genuine cold gun, not a falsy "unset"
    expect(g.overheated).toBe(false)
    expect(['left', 'right']).toContain(g.nextGun) // #3 exhaustive union — a real Gun
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-3 — alternating L/R guns
// ───────────────────────────────────────────────────────────────────────────
describe('guns — alternating L/R muzzles (findings §5)', () => {
  it('consecutive shots strictly alternate from the initial cursor', () => {
    const fire = need(m.fire, 'fire')
    const start = need(m.INITIAL_GUNS, 'INITIAL_GUNS').nextGun
    let g = initial()
    const fired: Gun[] = []
    for (let i = 0; i < 6; i++) {
      const before = g.shells.length
      g = fire(g, true) // no step: shells accumulate so the newest is always shells[last]
      if (g.shells.length > before) fired.push(g.shells[g.shells.length - 1].gun)
    }
    const expected: Gun[] = Array.from({ length: 6 }, (_, i) => (i % 2 === 0 ? start : other(start)))
    expect(fired).toEqual(expected) // L,R,L,R,L,R (or R,L,… per the initial cursor)
  })

  it('a shot flips nextGun so the following shot uses the other muzzle', () => {
    const fire = need(m.fire, 'fire')
    const g0 = initial()
    const g1 = fire(g0, true)
    expect(g1.nextGun).toBe(other(g0.nextGun)) // cursor advanced by the shot
  })

  it('every spawned shell records a valid Gun (#3 exhaustive union — no stray muzzle)', () => {
    const fire = need(m.fire, 'fire')
    let g = initial()
    for (let i = 0; i < 6; i++) g = fire(g, true)
    for (const s of g.shells) expect(['left', 'right']).toContain(s.gun)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-4 — the gun-overheat model (GUN.ST +1/shot, cool ×3, lock-out + recovery)
// ───────────────────────────────────────────────────────────────────────────
describe('guns — GUN.ST overheat model (findings §5, NWSHL1 R2BRON.MAC:2149-2233)', () => {
  it('heat climbs +1 per shot', () => {
    const fire = need(m.fire, 'fire')
    expect(fire(initial(), true).heat).toBe(need(m.GUN_HEAT_PER_SHOT, 'GUN_HEAT_PER_SHOT'))
    let g = initial()
    for (let i = 0; i < 5; i++) g = fire(g, true) // no step, no cool
    expect(g.heat).toBe(5 * need(m.GUN_HEAT_PER_SHOT, 'GUN_HEAT_PER_SHOT'))
  })

  it('releasing the trigger cools by GUN_COOL_RATE per frame, clamped at 0 (never negative)', () => {
    const fire = need(m.fire, 'fire')
    const cool = need(m.GUN_COOL_RATE, 'GUN_COOL_RATE')
    let hot = initial()
    for (let i = 0; i < 5; i++) hot = fire(hot, true) // heat 5
    expect(fire(hot, false).heat).toBe(5 - cool) // cools by exactly the rate

    const barely = fire(initial(), true) // heat 1
    expect(fire(barely, false).heat).toBe(0) // 1 - 3 clamps to 0, not -2
  })

  it('sustained fire OVERHEATS and locks out — even with slots free (heat, not the slot cap)', () => {
    const fire = need(m.fire, 'fire')
    const step = need(m.step, 'step')
    // Fire + step every frame: shells expire and free slots, so the ONLY thing that can
    // stop firing is heat. A machine gun that never overheats has no overheat model.
    let g = initial()
    let firedBeforeLock = false
    for (let i = 0; i < 5000 && !g.overheated; i++) {
      const before = g.shells.length
      g = fire(g, true)
      if (g.shells.length > before) firedBeforeLock = true
      g = step(g, []).guns
    }
    expect(firedBeforeLock).toBe(true) // it really fired before locking (a real transition)
    expect(g.overheated).toBe(true) // sustained trigger-hold overheats
    expect(g.shells.length).toBeLessThan(need(m.SHELL_SLOTS, 'SHELL_SLOTS')) // slots WERE free…

    // …and while overheated + still holding, fire() spawns nothing (locked out, not slot-capped).
    const lockedAdds = fire(g, true)
    expect(lockedAdds.shells.length).toBe(g.shells.length) // no new shell
    expect(lockedAdds.overheated).toBe(true) // still locked while held
  })

  it('cools back down on release — overheat clears and firing resumes', () => {
    const fire = need(m.fire, 'fire')
    const step = need(m.step, 'step')
    let g = initial()
    for (let i = 0; i < 5000 && !g.overheated; i++) {
      g = fire(g, true)
      g = step(g, []).guns
    }
    expect(g.overheated).toBe(true) // (precondition) it overheated

    // Release for a long spell: heat must bleed off and the lockout must clear.
    for (let i = 0; i < 200; i++) {
      g = fire(g, false)
      g = step(g, []).guns
    }
    expect(g.overheated).toBe(false) // recovered
    expect(g.heat).toBe(0) // fully cooled

    const resumed = fire(g, true) // guns work again
    expect(resumed.shells.length).toBeGreaterThan(g.shells.length)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-5 — 13 shell slots (capacity + a hard cap that never overflows)
// ───────────────────────────────────────────────────────────────────────────
describe('guns — 13 shell slots (findings §5)', () => {
  it('all 13 slots are usable — 13 continuous shots put 13 shells in flight', () => {
    const fire = need(m.fire, 'fire')
    const slots = need(m.SHELL_SLOTS, 'SHELL_SLOTS')
    let g = initial()
    for (let i = 0; i < slots; i++) g = fire(g, true) // no step: nothing expires
    expect(g.shells.length).toBe(slots) // the pool really holds 13 (overheat must allow ≥ 13)
  })

  it('never overflows the pool — a 14th shot cannot exceed 13 slots', () => {
    const fire = need(m.fire, 'fire')
    const slots = need(m.SHELL_SLOTS, 'SHELL_SLOTS')
    let g = initial()
    for (let i = 0; i < slots + 6; i++) {
      g = fire(g, true)
      expect(g.shells.length).toBeLessThanOrEqual(slots) // cap holds every step of the way
    }
    expect(g.shells.length).toBe(slots)
  })

  it('a realistic fire+step run keeps the in-flight count within [1, 13]', () => {
    const fire = need(m.fire, 'fire')
    const step = need(m.step, 'step')
    let g = initial()
    let maxSeen = 0
    let sawMultiple = false
    for (let i = 0; i < 200; i++) {
      g = fire(g, true)
      g = step(g, []).guns
      maxSeen = Math.max(maxSeen, g.shells.length)
      if (g.shells.length >= 2) sawMultiple = true
    }
    expect(sawMultiple).toBe(true) // more than one shell can be in flight at once
    expect(maxSeen).toBeLessThanOrEqual(need(m.SHELL_SLOTS, 'SHELL_SLOTS')) // never over the cap
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-6 — shell motion: advances in Z, expires at S_MAXZ, frees the slot
// ───────────────────────────────────────────────────────────────────────────
describe('guns — shell travel + expiry (SHLMOT, findings §5)', () => {
  it('a fresh shell leaves the muzzle at z=0, active (0 is a real z, rule #4)', () => {
    const fire = need(m.fire, 'fire')
    const g = fire(initial(), true)
    expect(g.shells.length).toBe(1)
    expect(g.shells[0].z).toBe(0) // starts at the muzzle — z=0 is genuine, not "no shell"
    expect(g.shells[0].active).toBe(true)
  })

  it('advances monotonically in Z, stays within S_MAXZ while alive, then expires and frees the slot', () => {
    const fire = need(m.fire, 'fire')
    const step = need(m.step, 'step')
    const maxz = need(m.S_MAXZ, 'S_MAXZ')
    let g = fire(initial(), true) // one shell, no target
    const zs: number[] = [g.shells[0].z]
    let frames = 0
    while (g.shells.length > 0 && frames < 100) {
      g = step(g, []).guns
      frames++
      if (g.shells[0]) zs.push(g.shells[0].z)
    }
    expect(g.shells.length).toBe(0) // it expired and the slot is free
    expect(frames).toBeLessThan(100) // bounded lifetime — it does not live forever
    for (let i = 1; i < zs.length; i++) expect(zs[i]).toBeGreaterThan(zs[i - 1]) // advances outward
    for (const z of zs) expect(z).toBeLessThanOrEqual(maxz) // an active shell never exceeds S_MAXZ
    expect(Math.max(...zs)).toBeGreaterThan(0) // it actually moved before dying
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-7 — hit detection: dead-on hits, off-axis + finite-range misses, NO tunnelling
// ───────────────────────────────────────────────────────────────────────────
describe('guns — hit detection (CDSSET/SHCDCK, findings §5)', () => {
  it('the guns actually connect — a dead-on shot hits a centred enemy in range', () => {
    expect(hitMap().some(Boolean)).toBe(true) // there IS a depth where you can shoot the enemy
  })

  it('NO tunnelling — the connectable depth band is contiguous, no interior gaps (4× sub-step)', () => {
    // The whole point of the 4× sub-step (SHLMOT): a fast shell is integrated finely enough
    // that it can't skip THROUGH the enemy between calc-frames. Behavioural proof: sweep the
    // enemy across depth; wherever dead-on shots connect they must connect at EVERY depth in
    // the band. A frame-boundary-only collision check would leave holes between the sampled
    // frame positions — those holes would show up as false gaps here.
    const map = hitMap()
    const first = map.indexOf(true)
    const last = map.lastIndexOf(true)
    expect(first).toBeGreaterThanOrEqual(0)
    for (let i = first; i <= last; i++) {
      expect(map[i]).toBe(true) // every depth inside the band connects — no tunnelled miss
    }
  })

  it('off-axis misses — an enemy far to the side (X or Y) is never hit by a boresight shot', () => {
    const depth = reachDepth()
    expect(didHit(enemyAt(10_000, 0, depth))).toBe(false) // way off in X
    expect(didHit(enemyAt(0, 10_000, depth))).toBe(false) // way off in Y
  })

  it('finite range — an absurdly far enemy is never hit (shells expire, no infinite hitscan)', () => {
    expect(didHit(enemyAt(0, 0, 1_000_000))).toBe(false)
  })

  it('the window is TIGHT, not just finite — a moderately off-axis enemy (~100u) still misses', () => {
    // 10 000u proves only "not infinite"; a window 100× too generous would pass that. Pin a
    // moderate off-axis miss so an over-wide window is caught too (100u > the ~32u window).
    const depth = reachDepth()
    expect(didHit(enemyAt(100, 0, depth))).toBe(false)
    expect(didHit(enemyAt(0, 100, depth))).toBe(false)
  })

  it('a hit CONSUMES the shell — one shell scores at most one hit, then is gone', () => {
    const { hits, guns } = fireOnceThenStep(enemyAt(0, 0, reachDepth()), 40)
    expect(hits.length).toBe(1) // not re-counted every frame
    expect(guns.shells.length).toBe(0) // the struck shell was removed, freeing its slot
  })

  it('reports the hit with the struck shell + target index (rb2-6 scores/explodes from it)', () => {
    const { hits } = fireOnceThenStep(enemyAt(0, 0, reachDepth()), 40)
    expect(hits.length).toBeGreaterThanOrEqual(1)
    const h = hits[0]
    expect(h.target).toBe(0) // indexes into the targets array
    expect(typeof h.shell.z).toBe('number') // carries the shell that struck
    expect(['left', 'right']).toContain(h.shell.gun)
  })

  it('an empty target list is safe — shells still fly and expire, zero hits (respawn grace)', () => {
    const { hits, guns } = runHold(null, 40) // no enemy on screen (WO.CNT grace / between waves)
    expect(hits).toEqual([])
    expect(guns.shells.length).toBeLessThanOrEqual(need(m.SHELL_SLOTS, 'SHELL_SLOTS'))
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-7b — collides(): the CDSSET/SHCDCK window, in isolation
// ───────────────────────────────────────────────────────────────────────────
describe('guns — collides() window in isolation', () => {
  it('the very shell that struck collides with the centred enemy but not a far off-axis one', () => {
    const collides = need(m.collides, 'collides')
    const depth = reachDepth()
    const target = enemyAt(0, 0, depth)
    const { hits } = fireOnceThenStep(target, 40)
    const shell = hits[0].shell
    expect(collides(shell, target)).toBe(true) // inside the window
    expect(collides(shell, enemyAt(10_000, 0, depth))).toBe(false) // outside in X
    expect(collides(shell, enemyAt(0, 10_000, depth))).toBe(false) // outside in Y
  })

  it('CDSSET rotation is REAL — an offset that misses axis-aligned HITS once the enemy banks', () => {
    // Rotation must be load-bearing, not decorative. Pick an offset (40u) that sits OUTSIDE the
    // square window axis-aligned but INSIDE it rotated 45° (40 > window ≈ 32, yet 40·cos45° ≈ 28
    // < 32). If collides() ignored enemy.bank, the banked case would ALSO miss — so this test
    // FAILS if the rotation math is ever removed. (Replaces a prior test that a rotation-free
    // collides() could pass, because a dead-centre target is rotation-invariant.)
    const collides = need(m.collides, 'collides')
    const depth = reachDepth()
    const { hits } = fireOnceThenStep(enemyAt(0, 0, depth), 40)
    const shell = hits[0].shell // a real shell at a z that collides at this depth
    const off = enemyAt(shell.x + 40, 0, depth) // enemy 40u to one side of the shell's line
    expect(collides(shell, { ...off, bank: 0 })).toBe(false) // axis-aligned → outside the window
    expect(collides(shell, { ...off, bank: Math.PI / 4 })).toBe(true) // banked → rotated inside
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-7c — multi-target hit selection (firstHit precedence; matters for rb2-7 drones)
// ───────────────────────────────────────────────────────────────────────────
describe('guns — multi-target hit selection (Hit.target, findings §5)', () => {
  it('reports the index of the enemy actually struck, not just index 0', () => {
    // targets = [off-axis, dead-on]: the shell must strike index 1 (the dead-on plane), proving
    // Hit.target is the STRUCK target, not a hardcoded 0 nor the first array slot.
    const depth = reachDepth()
    const hit = firstHitOf([enemyAt(10_000, 0, depth), enemyAt(0, 0, depth)])
    expect(hit).not.toBeNull()
    expect(hit?.target).toBe(1)
  })

  it('picks the EARLIEST index among overlapping targets (firstHit precedence)', () => {
    // Two dead-on planes occupy the same window; firstHit documents "the first target" — pin that
    // the earlier array index wins and a single shell scores exactly one of them.
    const depth = reachDepth()
    const hit = firstHitOf([enemyAt(0, 0, depth), enemyAt(0, 0, depth)])
    expect(hit).not.toBeNull()
    expect(hit?.target).toBe(0)
  })

  it('a shell misses ALL targets when none is aligned — no phantom hit from a crowded sky', () => {
    const depth = reachDepth()
    const hit = firstHitOf([enemyAt(10_000, 0, depth), enemyAt(0, 10_000, depth)])
    expect(hit).toBeNull()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC-8 — purity, determinism, totality, no mutation (module contract)
// ───────────────────────────────────────────────────────────────────────────
describe('guns — pure, deterministic & total', () => {
  it('fire and step are pure — same inputs give the same outputs (no Date/Math.random leak)', () => {
    const fire = need(m.fire, 'fire')
    expect(fire(initial(), true)).toEqual(fire(initial(), true))
    const run = (): number => runHold(enemyAt(0, 0, reachDepth()), 25).hits.length
    expect(run()).toBe(run()) // a whole fire→hit sequence reproduces exactly
  })

  it('never mutates its inputs — INITIAL_GUNS is untouched after fire()/step()', () => {
    const fire = need(m.fire, 'fire')
    const step = need(m.step, 'step')
    const snapshot = JSON.stringify(initial())
    const g = fire(initial(), true)
    step(g, [enemyAt(0, 0, reachDepth())])
    expect(JSON.stringify(initial())).toBe(snapshot) // readonly contract honoured
  })

  it('never mutates a NON-frozen, fire()-derived Guns across a later step()/fire()', () => {
    // INITIAL_GUNS is Object.freeze'd, so mutating it would throw elsewhere first — that test
    // can't see an in-place mutation of a normal Guns value. Snapshot a real fire()-derived Guns
    // (with a shell in flight) and prove step()/fire() leave it byte-for-byte untouched.
    const fire = need(m.fire, 'fire')
    const step = need(m.step, 'step')
    const g = fire(initial(), true) // a fresh, un-frozen Guns holding one shell
    const snapshot = JSON.stringify(g)
    step(g, [enemyAt(0, 0, reachDepth())])
    fire(g, true)
    expect(JSON.stringify(g)).toBe(snapshot) // untouched by either call
  })

  it('is TOTAL on a degenerate enemy — collides returns FALSE (the documented value) for NaN/±Infinity depth', () => {
    // The JSDoc contract is stronger than "no throw": a degenerate depth fails the Z bound and
    // returns false. Asserting the VALUE (not just typeof boolean) catches a regression that let
    // a NaN/Infinity-depth enemy register a phantom hit.
    const collides = need(m.collides, 'collides')
    const shell = need(m.fire, 'fire')(initial(), true).shells[0]
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(collides(shell, enemyAt(0, 0, bad))).toBe(false)
    }
  })
})

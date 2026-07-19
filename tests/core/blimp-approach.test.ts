// tests/core/blimp-approach.test.ts
//
// Story rb4-15 — RED phase (Imperator Furiosa / TEA). THE BLIMP IS THE WRONG MACHINE.
//
// The blimp we ship is a constant-depth lateral drifter (CD-005 "certified-correct" —
// CONFIRMED FALSE by the coverage review: it borrowed the plane's div-by-2 fire and
// invented the cruise). The 1980 machine is an APPROACHING AIRSHIP. Every claim below
// is re-derived firsthand from the CITABLE quarry ~/Projects/red-baron-source-text/
// RBARON.MAC (md5 497db93e…, .RADIX 16 from :74 — NOT the CRLF sibling), this session:
//
//   ENTRY    INITBP :1425-1426   LDA I,10 / STA BLOBJ+5 ;Z MSB   (LSB cleared :1421)
//            → the airship ENTERS at Z = 0x1000 = 4096 — nearly the plane's own spawn
//              depth, NOT a mid-field cruise.
//   CLOSE    BLMOTN :4259-4265   CLC / LDA BLOBJ+4 / ADC I,-80 / STA BLOBJ+4 /
//            LDA BLOBJ+5 / ADC I,-1 / STA BLOBJ+5
//            → a 16-bit add of 0xFF80: Z CLOSES by 0x80 = 128 every calc-frame.
//   GONE     BLMOTN :4266-4270   CMP I,1 / BPL 55$ … 40$: LDA I,0 ;CLR BLOBJ
//            → alive while the Z MSB >= 1 (Z >= 0x100); the frame Z drops below
//              0x100 = 256, BLOBJ is CLEARED. The airship flies past you and is gone.
//   SPAWN    :2325-2331          LDA N.PLNZ / CMP I,4 / BCC 25$ / JSR RANDOM /
//            AND I,0C / BNE 25$ / JSR CINTBP ;RANDOM BLIMP
//            → TWO gates: no blimp until FOUR planes have appeared in the game
//              (N.PLNZ :129 "NUMBER OF PLANES COUNT", INC'd per plane :2398), THEN a
//              1-in-4 roll (bits 2-3 of RANDOM must be zero). The 25 % SURVIVES — it
//              is the second gate, not the whole decision.
//   FIRE     SHLAUN :4027-4030   LDA FRAME / AND I,3 ;1 OUT OF 4 FRAMES / BEQ SHLAU0
//            → the blimp's shells launch through the SHARED SHLAUN (BLMOTN calls it,
//              :4229 "LAUNCH SHELL @ PLAYER") — 1 frame in 4, NOT every 2nd frame.
//            SHLAUN :4038-4041   LDX GMLEVL / DEX / DEX / BMI SHLAUX
//            ;NO GROUND SHELLS @ LOWER LEVELS
//            → and only at GMLEVL >= 2. The shipped "no level gate" reading is false.
//
// CONTRACT for GREEN (src/core/blimp.ts):
//
//   export const BLIMP_Z_START = 0x1000     // entry Z (hex — the rb4-1 convention)
//   export const BLIMP_CLOSE_SPEED = 0x80   // Z closed per calc-frame (hex)
//   export const BLIMP_PLANE_GATE = 4       // planes that must appear first
//   export const BLIMP_SPAWN_CHANCE = 0.25  // SURVIVES — the AND 0C roll
//   export function shouldSpawnBlimp(planeCount: number, roll: number): boolean
//   export function blimpFires(frame: number, level: number): boolean
//   export function spawn(rng: Rng, aspect: number): Blimp   // depth = BLIMP_Z_START
//   export function step(blimp: Blimp): Blimp                // depth -= BLIMP_CLOSE_SPEED
//   export function reapBlimp(blimp: Blimp): Blimp | null    // null once depth < 0x100
//
// reapBlimp drops its `aspect` parameter DELIBERATELY: the ROM despawn is a question
// about DEPTH, not about the frame — and a parameter the decision ignores is exactly
// the kind of dead input the rb4-1 rounds taught us gets poisoned. (Logged as a
// design deviation — the story names the despawn's threshold, not its signature.)
//
// The blimp-approach.test.ts drafted during rb4-6's RED was NOT copied — per the
// story, this suite is re-derived from the citations above.

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRng, type Rng } from '@arcade/shared/rng'

// ─── local mirror of the rb4-15 TARGET contract ─────────────────────────────────
//
// The module EXISTS but still has the DRIFTER's shape: shouldSpawnBlimp(roll) and
// blimpFires(frame) are one-argument, reapBlimp takes an aspect. Casting the import
// to this TARGET mirror trips TS2352 — a function-typed member is contravariant in
// its parameters, so the old and new signatures reconcile in NEITHER direction. The
// honest bridge for a RED mid-signature-migration is `as unknown as` (the rb4-7
// lesson); the mirror still types every member, and the runtime `need()` + the
// assertions below do the real RED verification.

interface Blimp {
  readonly x: number
  readonly y: number
  readonly depth: number
  readonly deltaX: number
  readonly bank: number
  readonly side: -1 | 1
  readonly active: boolean
}

interface BlimpModule {
  BLIMP_Z_START?: number
  BLIMP_CLOSE_SPEED?: number
  BLIMP_PLANE_GATE?: number
  BLIMP_SPAWN_CHANCE?: number
  shouldSpawnBlimp?: (planeCount: number, roll: number) => boolean
  blimpFires?: (frame: number, level: number) => boolean
  spawn?: (rng: Rng, aspect: number) => Blimp
  step?: (blimp: Blimp) => Blimp
  reapBlimp?: (blimp: Blimp) => Blimp | null
}

let m: BlimpModule = {}

beforeAll(async () => {
  try {
    // as unknown as: source is mid-migration from the drifter's signatures — see header.
    m = (await import('../../src/core/blimp')) as unknown as BlimpModule
  } catch {
    m = {}
  }
})

/** Fail loud-and-clear when a contract export is missing (RED-friendly). */
function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`src/core/blimp.ts must export ${name} (rb4-15 RED contract)`)
  }
  return value
}

/** A 16:9 reference frame — the cabinet. */
const ASPECT = 16 / 9

/** A fresh seeded blimp in the reference frame. */
const spawnAt = (seed = 1): Blimp => need(m.spawn, 'spawn')(createRng(seed), ASPECT)

/** Override Blimp fields while carrying whatever extra fields Dev keeps (robust hand-build). */
const withBlimp = (overrides: Partial<Blimp>, seed = 1): Blimp => ({ ...spawnAt(seed), ...overrides })

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')

// ───────────────────────────────────────────────────────────────────────────
// The ROM constants — hex, exactly as the source spells them (rb4-1 convention)
// ───────────────────────────────────────────────────────────────────────────
describe('rb4-15 — the ROM constants of the approaching airship', () => {
  it('BLIMP_Z_START is 0x1000 = 4096 — the entry Z (INITBP, RBARON.MAC:1425-1426)', () => {
    expect(need(m.BLIMP_Z_START, 'BLIMP_Z_START')).toBe(0x1000)
    expect(need(m.BLIMP_Z_START, 'BLIMP_Z_START')).toBe(4096) // one value, both spellings
  })

  it('BLIMP_CLOSE_SPEED is 0x80 = 128 — Z closed per calc-frame (BLMOTN, RBARON.MAC:4259-4265)', () => {
    expect(need(m.BLIMP_CLOSE_SPEED, 'BLIMP_CLOSE_SPEED')).toBe(0x80)
  })

  it('BLIMP_PLANE_GATE is 4 — the N.PLNZ spawn gate (RBARON.MAC:2325-2327)', () => {
    expect(need(m.BLIMP_PLANE_GATE, 'BLIMP_PLANE_GATE')).toBe(4)
  })

  it('BLIMP_SPAWN_CHANCE SURVIVES at 0.25 — the AND 0C roll is the SECOND gate (RBARON.MAC:2328-2330)', () => {
    // RANDOM / AND I,0C / BNE skip — bits 2-3 must both be zero: exactly 1 in 4.
    expect(need(m.BLIMP_SPAWN_CHANCE, 'BLIMP_SPAWN_CHANCE')).toBeCloseTo(0.25, 12)
  })

  it('the Z constants are spelled in HEX in the source — the epic exists because 0x1080 was read as 1080', () => {
    // rb4-1's lesson, made mechanical for the two numbers this story adds: a `= 4096`
    // invites the next transcriber to "correct" it against a decimal misreading. The
    // source must carry the ROM's own spelling.
    const blimpTs = readFileSync(join(srcRoot, 'core', 'blimp.ts'), 'utf8')
    expect(blimpTs).toMatch(/BLIMP_Z_START\s*=\s*0x1000\b/)
    expect(blimpTs).toMatch(/BLIMP_CLOSE_SPEED\s*=\s*0x80\b/)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC — the TWO-GATE spawn: four planes first, THEN the 1-in-4 roll (:2325-2331)
// ───────────────────────────────────────────────────────────────────────────
describe('rb4-15 — shouldSpawnBlimp(planeCount, roll): the N.PLNZ gate before the roll', () => {
  // The matrix below discriminates in BOTH directions on purpose: (0, 0.1) must be
  // false (the old one-arg impl reads 0.1's slot as nothing and 0 as a winning roll —
  // it says true), and (4, 0.1) must be true (the old impl reads 4 as a losing roll —
  // it says false). An arg-swapped implementation fails both too.
  it('below FOUR planes NOTHING spawns — a certain roll cannot conjure an airship the sky has not earned', () => {
    const gate = need(m.shouldSpawnBlimp, 'shouldSpawnBlimp')
    for (const planes of [0, 1, 2, 3]) {
      expect(gate(planes, 0), `planeCount ${planes}, a winning roll`).toBe(false)
    }
  })

  it('AT four the gate opens — CMP I,4 / BCC skips only BELOW four (:2326-2327)', () => {
    const gate = need(m.shouldSpawnBlimp, 'shouldSpawnBlimp')
    expect(gate(4, 0.1)).toBe(true) // exactly four planes + a winning roll → blimp
    expect(gate(5, 0.1)).toBe(true)
    expect(gate(100, 0.1)).toBe(true)
  })

  it('the 25 % roll survives as the SECOND gate — strict at the boundary, like the old contract', () => {
    const gate = need(m.shouldSpawnBlimp, 'shouldSpawnBlimp')
    const chance = need(m.BLIMP_SPAWN_CHANCE, 'BLIMP_SPAWN_CHANCE')
    expect(gate(8, 0)).toBe(true)
    expect(gate(8, chance - 0.01)).toBe(true) // just inside the 25 % band
    expect(gate(8, chance)).toBe(false) // strict — exactly at the chance does NOT spawn
    expect(gate(8, 0.99)).toBe(false) // the common case: no blimp
  })

  it('is TOTAL — degenerate counts and rolls fail SAFE (no phantom airship), never throw', () => {
    const gate = need(m.shouldSpawnBlimp, 'shouldSpawnBlimp')
    expect(gate(Number.NaN, 0)).toBe(false) // a NaN count is not four planes
    expect(gate(4, Number.NaN)).toBe(false) // a NaN roll must not conjure a blimp
    expect(gate(4, Number.POSITIVE_INFINITY)).toBe(false)
    expect(gate(-1, 0)).toBe(false)
    expect(gate(3.999, 0)).toBe(false) // still below the gate
    for (const weird of [gate(Number.POSITIVE_INFINITY, 0.1), gate(4, -1)]) {
      expect(typeof weird).toBe('boolean') // a real decision, no throw
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC — fire: 1 frame in 4 (SHLAUN :4027-4030), and ONLY at GMLEVL >= 2 (:4038-4041)
// ───────────────────────────────────────────────────────────────────────────
describe('rb4-15 — blimpFires(frame, level): the shared SHLAUN gates, not the plane ÷2', () => {
  /** Which of frames 0..n-1 fire at `level`. */
  const fireFrames = (n: number, level: number): number[] => {
    const fires = need(m.blimpFires, 'blimpFires')
    const out: number[] = []
    for (let f = 0; f < n; f++) if (fires(f, level)) out.push(f)
    return out
  }

  it('fires 1 frame in 4 — FRAME & 3 === 0, NOT the shipped every-2nd-frame (:4027-4030)', () => {
    // 16 frames at a firing level: exactly {0, 4, 8, 12}. The drifter fired 8 of these.
    expect(fireFrames(16, 2)).toEqual([0, 4, 8, 12])
  })

  it('holds fire at GMLEVL 0 and 1 — NO GROUND SHELLS @ LOWER LEVELS (:4038-4041)', () => {
    // LDX GMLEVL / DEX / DEX / BMI skip: the early sky's blimp is a TARGET, not a threat.
    // The shipped code says the opposite in so many words ("NO level gate") — it is wrong.
    expect(fireFrames(64, 0)).toEqual([])
    expect(fireFrames(64, 1)).toEqual([])
  })

  it('opens up at GMLEVL >= 2 — DEX twice then BMI is a >= 2 test, and 2 is the first firing level', () => {
    expect(fireFrames(8, 2).length).toBeGreaterThan(0) // the boundary level fires
    expect(fireFrames(8, 3).length).toBeGreaterThan(0)
    expect(fireFrames(8, 9).length).toBeGreaterThan(0)
  })

  it('BOTH gates bind in one call — an aligned frame at a low level holds, a high level off-frame holds', () => {
    const fires = need(m.blimpFires, 'blimpFires')
    expect(fires(4, 1)).toBe(false) // frame aligned, level too low
    expect(fires(5, 2)).toBe(false) // level high enough, frame off-cadence
    expect(fires(4, 2)).toBe(true) // both gates open
  })

  it('is deterministic and TOTAL — degenerate frames and levels never crash, and fail safe', () => {
    const fires = need(m.blimpFires, 'blimpFires')
    expect(fires(0, 2)).toBe(fires(0, 2)) // deterministic
    expect(typeof fires(0, 2)).toBe('boolean') // frame 0 is a genuine decision (rule #4)
    for (const f of [-1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(typeof fires(f, 2)).toBe('boolean') // total on the frame axis
    }
    expect(fires(0, Number.NaN)).toBe(false) // a NaN level is not >= 2
  })
})

// ───────────────────────────────────────────────────────────────────────────
// AC — the machine: enter DEEP, CLOSE every calc-frame, gone below 0x100
// ───────────────────────────────────────────────────────────────────────────
describe('rb4-15 — the approach: spawn at 0x1000, close 0x80/frame, cleared below 0x100', () => {
  it('spawn ENTERS at exactly BLIMP_Z_START, every seed — the depth is transcribed, not tuned', () => {
    const z0 = need(m.BLIMP_Z_START, 'BLIMP_Z_START')
    for (const seed of [1, 2, 7, 42, 100]) {
      const b = spawnAt(seed)
      expect(b.depth, `seed ${seed}`).toBe(z0)
      expect(b.active).toBe(true)
      expect(Number.isFinite(b.x)).toBe(true)
      expect(Number.isFinite(b.y)).toBe(true)
    }
  })

  it('step CLOSES the depth by exactly BLIMP_CLOSE_SPEED — an approach, not a cruise', () => {
    const step = need(m.step, 'step')
    const close = need(m.BLIMP_CLOSE_SPEED, 'BLIMP_CLOSE_SPEED')
    let b = spawnAt(7)
    for (let i = 0; i < 5; i++) {
      const next = step(b)
      expect(next.depth, `calc-frame ${i}`).toBe(b.depth - close)
      b = next
    }
  })

  it('step is pure — the input is untouched, and the same state gives the same successor', () => {
    const step = need(m.step, 'step')
    const b = spawnAt(3)
    const snapshot = JSON.stringify(b)
    expect(step(b)).toEqual(step(b))
    expect(JSON.stringify(b)).toBe(snapshot)
  })

  it('reapBlimp keeps the airship at Z = 0x100 EXACTLY — CMP I,1 / BPL is "MSB >= 1 lives" (:4266-4267)', () => {
    const reap = need(m.reapBlimp, 'reapBlimp')
    const at = (depth: number): Blimp => withBlimp({ depth })
    expect(reap(at(0x100))).not.toBeNull() // Z = 256: MSB = 1 → alive
    expect(reap(at(0x100 + 1))).not.toBeNull()
    expect(reap(at(0x1000))).not.toBeNull() // freshly entered
  })

  it('…and CLEARS it below 0x100 — 40$: LDA I,0 ;CLR BLOBJ (:4268-4270). It flew past you.', () => {
    const reap = need(m.reapBlimp, 'reapBlimp')
    const at = (depth: number): Blimp => withBlimp({ depth })
    expect(reap(at(0x100 - 1))).toBeNull()
    expect(reap(at(0x80))).toBeNull() // the state one ROM step below the threshold
    expect(reap(at(0))).toBeNull()
    expect(reap(at(-128))).toBeNull() // behind the eye is certainly gone
  })

  it('is TOTAL — a non-finite airship is reaped, not left to close and fire forever', () => {
    const reap = need(m.reapBlimp, 'reapBlimp')
    expect(reap(withBlimp({ depth: Number.NaN }))).toBeNull()
    expect(reap(withBlimp({ x: Number.NaN }))).toBeNull()
  })

  it('THE LIFE: entry to gone is exactly 31 calc-frames — 4096 steps down to 256, then past you', () => {
    // 4096 - 128·n: n = 30 → 256 (Z MSB = 1, ALIVE — the last frame drawn); n = 31 → 128,
    // below 0x100 → CLEARED. The story prose said "~32 frames"; the two transcribed
    // constants + the :4266 threshold say exactly 31 (≈ 3.0 s at the 10.42 Hz calc rate).
    const step = need(m.step, 'step')
    const reap = need(m.reapBlimp, 'reapBlimp')
    let b: Blimp | null = withBlimp({ depth: need(m.BLIMP_Z_START, 'BLIMP_Z_START') })
    let frames = 0
    let lastAliveDepth = b.depth
    while (b !== null && frames < 100) {
      const stepped: Blimp = step(b)
      frames += 1
      b = reap(stepped)
      if (b !== null) lastAliveDepth = b.depth
    }
    expect(b).toBeNull() // it does leave — no eternal airship
    expect(frames).toBe(31) // the machine's own count, derived not copied
    expect(lastAliveDepth).toBe(0x100) // and the last state drawn sits EXACTLY on the ROM line
  })
})

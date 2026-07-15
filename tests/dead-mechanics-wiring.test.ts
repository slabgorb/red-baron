// tests/dead-mechanics-wiring.test.ts
//
// Story rb4-4 — RED phase (TEA). THE PLAYER CAN DIE, AND THE SCORE COUNTS UP.
// Two booted-cockpit runs (tests/helpers/boot-cockpit.ts), each watching only
// what the player sees and hears — the rb4-1 lesson: no import scans, no regex.
//
// RUN A (trigger held): the shipped sim downs a plane at ~calc frame 7 (seed
// 12345, probe-calibrated). TODAY the HUD score JUMPS 0→300 on the kill frame
// and no TK/TP ever sounds. The ROM queues the kill (";QUEUE SCORE",
// RBARON.MAC:3049) and SCOREM (:1531-1603) drains it +100 per big tick at half
// cadence, SOUND 0 + SOUND 4 per big tick — so the HUD must CLIMB, and the
// tones must fire. (AC-5; the machine's exact contract lives in
// tests/core/score-countup.test.ts.)
//
// RUN B (hands-off, long): the lone wave's plane floors at ~frame 978, the wired
// ace (AC-1) attacks — the freebie, then the 50/50s — and the pilot eventually
// dies for real. `lives` (INITLF[0] = 2, lives.ts) is READ: the second fatal
// verdict ends the game (ENDLFE → DEC LIVES → "else high-score entry",
// RBARON.MAC:1202-1212). Death also FREEZES the playfield — `BIT GREND / BVS`
// runs before `JSR PFMOTN` (:783-785) and EOLSEQ zeroes PLDELX/PLDELY
// (:1108-1113) — so a held bank during the death sequence must not move the
// horizon, and must move it again after the respawn.
//
// GAME OVER's on-screen form is Dev's (the ROM enters high-score entry; the
// clone minimally says so) — pinned only as: a HUD text matching /GAME OVER/i
// appears, and the war stops behind it (no further wave announce).

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { bootCockpit, type Painted, type Stroke } from './helpers/boot-cockpit'

const rec = vi.hoisted(() => ({
  frame: 0,
  tones: [] as Array<{ frame: number; tone: string }>,
  plays: [] as Array<{ frame: number; sound: string }>,
  reset(): void {
    this.frame = 0
    this.tones = []
    this.plays = []
  },
}))

vi.mock('../src/shell/audio', () => ({
  createAudioEngine: () => ({
    resume: () => {},
    play: (name: string) => rec.plays.push({ frame: rec.frame, sound: name }),
    playTone: (name: string) => rec.tones.push({ frame: rec.frame, tone: name }),
    setEngine: () => {},
    setGun: () => {},
    setApproach: () => {},
  }),
}))

afterAll(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const SEED_MS = 12345

/** The HUD score a painted frame shows, or null if none was drawn. */
function hudScore(p: Painted): number | null {
  const line = p.texts.find((t) => t.startsWith('SCORE '))
  return line ? Number.parseInt(line.slice(6), 10) : null
}

const flat = (b: readonly (readonly Stroke[])[]): Stroke[] => b.flatMap((x) => [...x])

// ═══ RUN A — the score COUNTS UP (AC-5) ═══════════════════════════════════════

describe('AC-5: a kill is QUEUED and the HUD score counts up (SCOREM, :1531-1603)', () => {
  const painted: Painted[] = []
  let killFrame = -1

  beforeAll(async () => {
    rec.reset()
    const cockpit = await bootCockpit(1600, 900, SEED_MS)
    cockpit.pressKey(' ') // hold fire — the probe-calibrated seed downs a plane at ~frame 7
    for (let f = 1; f <= 60; f++) {
      rec.frame = f
      painted.push(cockpit.tick())
    }
    killFrame = rec.plays.find((p) => p.sound === 'explosion')?.frame ?? -1
  }, 30000)

  it('the staging holds: a plane goes down early in the run (this suite is not vacuous)', () => {
    expect(killFrame, 'no kill happened — the fire-held staging broke').toBeGreaterThan(0)
    expect(killFrame).toBeLessThanOrEqual(20)
  })

  it('the HUD score NEVER jumps more than one big tick (+100) in a single calc frame', () => {
    // TODAY: the kill frame jumps +300. The ROM's largest single-frame movement is
    // LARGE_TICK = 100 (SOUND 4's unit, :1563).
    let prev = 0
    for (let i = 0; i < painted.length; i++) {
      const s = hudScore(painted[i])
      if (s === null) continue
      expect(s - prev, `calc frame ${i + 1}: the HUD score moved ${prev} → ${s} in one frame`).toBeLessThanOrEqual(100)
      expect(s, `calc frame ${i + 1}: the HUD score went BACKWARD (${prev} → ${s})`).toBeGreaterThanOrEqual(prev)
      prev = s
    }
  })

  it('…and still ARRIVES: the full 300 is on the HUD within ~15 frames of the kill', () => {
    const settled = painted
      .slice(Math.min(killFrame + 15, painted.length - 1))
      .map((p) => hudScore(p))
      .find((s) => s !== null)
    expect(settled).toBeGreaterThanOrEqual(300)
  })

  it('the big ticks SOUND: TP (SOUND 4, :1580) and TK (SOUND 0, :1577) fire during the drain', () => {
    const during = rec.tones.filter((t) => t.frame >= killFrame && t.frame <= killFrame + 15)
    expect(
      during.filter((t) => t.tone === 'TP').length,
      'a 300-point drain is three big ticks — SOUND 4 (TP) never fired',
    ).toBeGreaterThanOrEqual(1)
    expect(
      during.filter((t) => t.tone === 'TK').length,
      'SOUND 0 (TK) fires on EVERY tick (:1577) — it never fired',
    ).toBeGreaterThanOrEqual(1)
  })

  it('the 300-point reward jingle still rings (TH — findings §6A; keep-behavior guard)', () => {
    expect(rec.tones.some((t) => t.tone === 'TH' && Math.abs(t.frame - killFrame) <= 2)).toBe(true)
  })
})

// ═══ RUN B — lives are READ; death freezes; the game ENDS (AC-2) ══════════════

describe('AC-2: `lives` is read — death, the frozen playfield, and GAME OVER', () => {
  const painted: Painted[] = []
  let cockpitRef: Awaited<ReturnType<typeof bootCockpit>>
  const RUN = 4500

  /** First calc frame whose HUD carries a /GAME OVER/i text, or -1. */
  let gameOverFrame = -1
  /** The crash frames (the CRSHSN one-shot = a life actually lost). */
  let crashes: number[] = []

  beforeAll(async () => {
    rec.reset()
    cockpitRef = await bootCockpit(1600, 900, SEED_MS)
    // Hands-off: the lone plane floors at ~978 and the ace does the killing.
    // At the FIRST crash, hold a bank through the death sequence (the freeze pin),
    // release it, then re-press it briefly after the respawn (the thaw pin).
    let banking = false
    let bankFrames = 0
    for (let f = 1; f <= RUN; f++) {
      rec.frame = f
      const crashedNow = rec.plays.some((p) => p.sound === 'crash' && p.frame === f - 1)
      if (crashedNow && !banking && crashes.length === 0) {
        cockpitRef.pressKey('d')
        banking = true
        bankFrames = 0
      }
      if (banking) {
        bankFrames += 1
        if (bankFrames > 10) {
          cockpitRef.releaseKey('d')
          banking = false
        }
      }
      painted.push(cockpitRef.tick())
      if (crashes.length === 0) crashes = rec.plays.filter((p) => p.sound === 'crash').map((p) => p.frame)
    }
    crashes = rec.plays.filter((p) => p.sound === 'crash').map((p) => p.frame)
    gameOverFrame = painted.findIndex((p) => p.texts.some((t) => /game over/i.test(t))) + 1 // 0 → -1+1=0 → falsy
    if (gameOverFrame === 0) gameOverFrame = -1
  }, 120000)

  it('the pilot actually dies: the ace’s verdicts reach the damage channel (≥1 crash)', () => {
    expect(
      crashes.length,
      `no crash in ${RUN} hands-off calc frames — the ace never costs a life, the pilot is immortal`,
    ).toBeGreaterThanOrEqual(1)
    expect(crashes[0]).toBeGreaterThan(900) // no damage source exists before the floor
  })

  it('death FREEZES the playfield: a bank held through the death sequence does not move the horizon (:783-785, :1108-1113)', () => {
    expect(crashes.length).toBeGreaterThanOrEqual(1)
    const c = crashes[0]
    // frames c+2 .. c+8 are inside the shells-channel sequence (28 calc frames)
    // with 'd' held from c+1: the horizon batch must be IDENTICAL frame to frame.
    const horizon = (f: number): Stroke[] => flat([painted[f - 1].batches[0] ?? []])
    for (let f = c + 3; f <= c + 8; f++) {
      expect(horizon(f), `calc frame ${f}: the horizon moved during the death sequence`).toEqual(horizon(f - 1))
    }
  })

  it('…and THAWS after the respawn: the world answers the yoke again', () => {
    expect(crashes.length).toBeGreaterThanOrEqual(1)
    const c = crashes[0]
    if (gameOverFrame !== -1 && gameOverFrame <= c + 40) return // that death ended the game — nothing to thaw
    // Well past the 28-frame sequence: bank and watch the horizon move within a few frames.
    cockpitRef.pressKey('d')
    const before = flat([cockpitRef.tick().batches[0] ?? []])
    let moved = false
    for (let i = 0; i < 6 && !moved; i++) {
      const now = flat([cockpitRef.tick().batches[0] ?? []])
      moved = JSON.stringify(now) !== JSON.stringify(before)
    }
    cockpitRef.releaseKey('d')
    expect(moved, 'the horizon never answered the yoke after the respawn — the freeze stuck').toBe(true)
  })

  it('lives are FINITE and READ: the game ends — a GAME OVER card appears (ENDLFE :1202-1212)', () => {
    expect(
      gameOverFrame,
      `no GAME OVER in ${RUN} calc frames — \`lives\` is still write-only and the game unendable`,
    ).toBeGreaterThan(0)
  })

  it('…after the lives ran out, not before: at least INITLF[0] = 2 crashes precede it', () => {
    expect(gameOverFrame).toBeGreaterThan(0)
    expect(crashes.filter((c) => c < gameOverFrame).length).toBeGreaterThanOrEqual(2)
  })

  it('…and the war stops behind it: no wave announce (WP) after the game is over', () => {
    expect(gameOverFrame).toBeGreaterThan(0)
    const wpAfter = rec.tones.filter((t) => t.tone === 'WP' && t.frame > gameOverFrame + 28)
    expect(wpAfter, 'waves are still being announced over the GAME OVER card').toHaveLength(0)
  })
})

// src/core/waves.ts
//
// The squadron layer — story rb2-7. rb2-4 shipped ONE weaving plane; this turns the
// sky into MULTI-PLANE WAVES: score-scaled spawn counts, drone formation offsets, the
// PLNXCG "shoot the lead, a wingman takes over" promotion, and the MODECT/MCOUNT wave
// schedule that spaces waves at the calc-frame cadence. Grounded in findings §3 (enemy
// behavior, NWPLNE/STPLNE, R2BRON.MAC:2237-2386) and §4 (wave sequence, MODECT/MCOUNT,
// R2BRON.MAC:2254-2269, 1296-1297).
//
// SCORE-SCALED COUNT + 25 % LONE ROLL (findings §3): "Score ≥ 1000 → up to 3 planes
// (2 drones); ≥ 300 → ≥ 2 planes (1 drone)", and a RANDOM roll gives a 25 % lone plane
// (enemy.ts LONE_PLANE_CHANCE) that can knock any high score down to one plane. Drones
// fly the byte-pinned formation offsets PLANE1 -100,+100 / PLANE2 -100,-100.
//
// PLNXCG (findings §3, UPPLEX, R2BRON.MAC:2957-3030): killing the lead hands the fight
// to a wingman — a surviving drone is promoted to the next lead.
//
// MODECT / MCOUNT (findings §4): a NEWCT countdown steps MODECT, whose LSB alternates
// PLANE waves vs GROUND waves, spaced by the MCOUNT frame counts. GROUND waves are rb3
// (out of scope here) — the alternation MECHANISM is pinned, but a ground slot is a
// silent no-op wait; only plane waves field planes in rb2.
//
// FRAME CADENCE (findings §1 — load-bearing): the wave clock ticks ONCE per calculation
// frame (~10.42 Hz / 96 ms), NOT per 62.5 Hz display frame. `stepWaveClock` is the
// per-calc-frame reducer.
//
// PURE and deterministic — the ONLY randomness is the seeded Rng handed to `spawnWave`.

import { type Rng, nextFloat } from '@arcade/shared/rng'
import { spawn, LONE_PLANE_CHANCE, type Enemy } from './enemy'

// ─── ROM-exact data (findings §3, §4) ────────────────────────────────────────

/** Score at/above which a wave fields ≥ 2 planes (1 drone) — findings §3. */
export const SCORE_2_PLANES = 300

/** Score at/above which a wave fields up to 3 planes (2 drones) — findings §3. */
export const SCORE_3_PLANES = 1000

/**
 * Drone formation offsets from the lead's spawn point (x, y): PLANE1 -100,+100 and
 * PLANE2 -100,-100 (findings §3, R2BRON.MAC). Two drones — the object budget is 1 lead
 * + 2 drones.
 */
export const DRONE_OFFSETS: readonly (readonly [number, number])[] = Object.freeze([
  Object.freeze([-100, 100]) as readonly [number, number],
  Object.freeze([-100, -100]) as readonly [number, number],
])

/** MCOUNT — inter-wave frame counts, cycled by wave index (findings §4, R2BRON.MAC:1296-1297). */
export const MCOUNT: readonly number[] = Object.freeze([4, 2, 3, 2, 1, 3, 4, 2])

// ─── score-scaled wave size ───────────────────────────────────────────────────

/**
 * How many planes this wave fields for the running score (findings §3): < 300 → 1,
 * [300, 1000) → 2, ≥ 1000 → 3 (the 3-object budget: 1 lead + 2 drones). Total — a
 * NaN score reads as a single plane; +Infinity saturates at the budget.
 */
export function planeCountForScore(score: number): number {
  if (Number.isNaN(score)) return 1
  if (score >= SCORE_3_PLANES) return 3
  if (score >= SCORE_2_PLANES) return 2
  return 1
}

// ─── spawn a wave (NWPLNE/STPLNE, findings §3) ────────────────────────────────

/**
 * Spawn one wave. First the 25 % RANDOM lone-plane roll (LONE_PLANE_CHANCE) — if it
 * fires, a single lead regardless of score; otherwise a score-scaled count: a 'lead'
 * plane (from enemy.spawn) plus drones at DRONE_OFFSETS, each sharing the lead's depth
 * and flight state. Consumes the seeded Rng (the lone roll, then enemy.spawn for the
 * lead; drones are deterministic offsets). Pure per seed.
 */
export function spawnWave(rng: Rng, score: number, level = 0): readonly Enemy[] {
  const lone = nextFloat(rng) < LONE_PLANE_CHANCE
  const lead = spawn(rng, level)
  const count = lone ? 1 : planeCountForScore(score)
  const wave: Enemy[] = [lead]
  for (let i = 0; i < count - 1; i++) {
    const [dx, dy] = DRONE_OFFSETS[i]
    wave.push({ ...lead, kind: 'drone', x: lead.x + dx, y: lead.y + dy })
  }
  return wave
}

/**
 * PLNXCG — when the lead is gone, promote the first surviving drone into the new lead
 * (findings §3, UPPLEX/PLNXCG). Idempotent when a lead is already present; pure — it
 * never mutates the input array or its planes.
 */
export function promoteLead(survivors: readonly Enemy[]): readonly Enemy[] {
  if (survivors.some((e) => e.kind === 'lead')) return survivors
  const idx = survivors.findIndex((e) => e.kind === 'drone')
  if (idx < 0) return survivors
  return survivors.map((e, i) => (i === idx ? { ...e, kind: 'lead' } : e))
}

// ─── MODECT / MCOUNT schedule (findings §4) ───────────────────────────────────

/**
 * MODECT LSB alternation: a plane wave vs a (deferred, rb3) ground wave (findings §4).
 * Even MODECT is a plane wave — isPlaneWave(0) is true, so the game opens with planes.
 * (Which parity is the plane is inferred; the ROM pins that the LSB selects.)
 */
export function isPlaneWave(modect: number): boolean {
  return modect % 2 === 0
}

/** MCOUNT inter-wave frame count for a wave index, cycling the table (findings §4). */
export function interWaveDelay(modect: number): number {
  const len = MCOUNT.length
  return MCOUNT[((Math.floor(modect) % len) + len) % len]
}

/** The calc-frame wave clock: the current MODECT and the frames left until the next wave. */
export interface WaveClock {
  readonly modect: number
  readonly countdown: number
}

/** The opening clock — MODECT 0 with a spent countdown, so the first plane wave is due now. */
export const INITIAL_WAVE_CLOCK: WaveClock = Object.freeze({ modect: 0, countdown: 0 })

/**
 * Advance the wave clock one calculation frame (findings §1 cadence). While the
 * countdown is running it just ticks down (no wave). When it reaches 0 the current
 * MODECT's wave fires — `spawnPlaneWave` is true for a plane slot, false for a silent
 * (rb3-deferred) ground slot — then MODECT advances and the countdown reloads from
 * MCOUNT for the next wave. Pure — returns a fresh clock.
 */
export function stepWaveClock(clock: WaveClock): { clock: WaveClock; spawnPlaneWave: boolean } {
  if (clock.countdown > 0) {
    return { clock: { modect: clock.modect, countdown: clock.countdown - 1 }, spawnPlaneWave: false }
  }
  const spawnPlaneWave = isPlaneWave(clock.modect)
  const nextModect = clock.modect + 1
  return { clock: { modect: nextModect, countdown: interWaveDelay(nextModect) }, spawnPlaneWave }
}

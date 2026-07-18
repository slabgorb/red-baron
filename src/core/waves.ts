// src/core/waves.ts
//
// The squadron layer — story rb2-7. rb2-4 shipped ONE weaving plane; this turns the
// sky into MULTI-PLANE WAVES: score-scaled spawn counts, drone formation offsets, the
// PLNXCG "shoot the lead, a wingman takes over" promotion, and the MODECT/MCOUNT wave
// schedule that spaces waves at the calc-frame cadence. Grounded in findings §3 (enemy
// behavior, NWPLNE/STPLNE, RBARON.MAC:2241/2274) and §4 (wave sequence, MODECT/MCOUNT,
// RBARON.MAC:157/1298).
//
// SCORE-SCALED COUNT + 25 % LONE ROLL (findings §3): "Score ≥ 1000 → up to 3 planes
// (2 drones); ≥ 300 → ≥ 2 planes (1 drone)", and a RANDOM roll gives a 25 % lone plane
// (enemy.ts LONE_PLANE_CHANCE) that can knock any high score down to one plane. Drones
// fly the byte-pinned formation offsets PLANE1 -100,+100 / PLANE2 -100,-100.
//
// PLNXCG (UPPLEX, RBARON.MAC:2961/3139): killing the lead hands the fight
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
import type { Vec3 } from '@arcade/shared/math3d'
import { spawn, step, LONE_PLANE_CHANCE, DRINZ, type Enemy } from './enemy'

/** The pilot's eye when no caller threads one — the boresight (enemy.ts BORESIGHT / guns EYE_ORIGIN). */
const BORESIGHT: Vec3 = Object.freeze([0, 0, 0]) as Vec3

// ─── ROM-exact data (findings §3, §4) ────────────────────────────────────────

/** Score at/above which a wave fields ≥ 2 planes (1 drone) — findings §3. */
export const SCORE_2_PLANES = 300

/** Score at/above which a wave fields up to 3 planes (2 drones) — findings §3. */
export const SCORE_3_PLANES = 1000

/**
 * Drone formation offsets from the lead's spawn point (x, y).
 * RBARON.MAC:2480-2481, .RADIX 16 region (set at :74) — these are HEX:
 *
 *     PLANE1: .WORD -100,100     ->  -0x100, +0x100  =  -256, +256
 *     PLANE2: .WORD -100,-100    ->  -0x100, -0x100  =  -256, -256
 *
 * The four bytes are copied into P.1ST/P.2ST as the drone's X and Y LSB/MSB
 * (RBARON.MAC:2372-2373). Read as decimal 100 every drone flew 2.56× closer to its
 * lead than the arcade's — the formation was far too tight.
 */
const DRONE_OFFSET = 0x100

export const DRONE_OFFSETS: readonly (readonly [number, number])[] = Object.freeze([
  Object.freeze([-DRONE_OFFSET, DRONE_OFFSET]) as readonly [number, number],
  Object.freeze([-DRONE_OFFSET, -DRONE_OFFSET]) as readonly [number, number],
])

/** MCOUNT — inter-wave frame counts, cycled by wave index (MCOUNT, RBARON.MAC:1298). */
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
 * plane (from enemy.spawn) plus drones at DRONE_OFFSETS. Consumes the seeded Rng (the
 * lone roll, then enemy.spawn for the lead; drones are deterministic offsets). Pure per seed.
 */
export function spawnWave(rng: Rng, score: number, level = 0): readonly Enemy[] {
  const lone = nextFloat(rng) < LONE_PLANE_CHANCE
  const lead = spawn(rng, level)
  const count = lone ? 1 : planeCountForScore(score)
  const wave: Enemy[] = [lead]
  for (let i = 0; i < count - 1; i++) {
    const [dx, dy] = DRONE_OFFSETS[i]
    // rb4-6: a drone enters FARTHER back than the lead (`LDA I,DRINZ/100 / STA P.1ST+5`,
    // RBARON.MAC:2369-2370 — the depth MSB, so 0x1600) and flagged FORMATION FLIGHT
    // (`LDA I,2 / STA P.1ST+6`, :2367-2368) — it flies PARALLEL until FREPAR frees it.
    // Both Zs at DRINZ: the ROM's drone init overrides only the picture MSB (`LDA I,DRINZ/100 /
    // STA P.1ST+5`, RBARON.MAC:2369-2370) over a PLNXCG-initialized record whose +19/+1A seed is
    // NOT yet verified firsthand — so the drone keeps the coherent single-depth pose it has today
    // rather than guessing a split (rb4-17 Delivery Finding: Question, for the drone story).
    wave.push({ ...lead, kind: 'drone', x: lead.x + dx, y: lead.y + dy, depth: DRINZ, positionZ: DRINZ, parallel: true })
  }
  return wave
}

/**
 * Advance the whole wave one calculation frame — the PLMOTN/FREPAR seam (RBARON.MAC:3500-3529) a
 * single-enemy step() cannot see. Each plane weaves (enemy.step); a PARALLEL drone RIDES the lead's
 * motion, holding its entry (x, y) offset instead of weaving independently, until FREPAR frees it.
 * Planes that bore past P.MNDP deactivate in step() and are DROPPED here, so the live wave shrinks
 * rather than piling up destroyed objects at a depth floor. Pure — the input array and its planes
 * are untouched.
 *
 * WHAT FREES A DRONE. `FRDRNE` itself (:3511-3528) carries NO distance or timer test — it frees a
 * parallel drone (`LSR ZX,PLOBDB+6 ;FREE DRONE`) unconditionally and resolves its stored offset to
 * an absolute position by adding the lead's. So the break is decided entirely by WHEN `FREPAR` is
 * called, and the ROM calls it in exactly two places:
 *
 *   1. :2652-2653 — the frame the LEAD's entry rotation finishes ramping to zero: `AND I,0EF`
 *      (";D4=0 (PLANE FACING AWAY)") is immediately followed by `JSR FREPAR ;FREE PARALLEL DRONES`.
 *      The formation holds for exactly as long as the lead is still rotating in, and breaks the
 *      instant it settles — so problem item 5's entry ramp and AC-4's break are ONE event.
 *   2. :5587 — a shell kills the lead (`JSR PLNSCR` / `SPIRAL`): the survivors go free.
 *
 * Both are keyed on the LEAD, never on the drone's own depth. An earlier draft of this story
 * proxied the break as a fixed `DRINZ - 0x30` closing distance; that constant is not in the ROM
 * (see the story deviation), and inventing a depth is the exact failure rb4-1 exists to prevent.
 */
export function stepWave(enemies: readonly Enemy[], level = 0, eye: Vec3 = BORESIGHT): readonly Enemy[] {
  const preLead = enemies.find((e) => e.kind === 'lead' && e.active)
  // rb4-16: thread the pilot's eye down to each plane's servo — it decides its zone from the plane's
  // POST-DIVIDE SCREEN position (world − pilot, ÷ depth), so the stick can finally move the boresight.
  const stepped = enemies.map((e) => step(e, level, eye))
  const postLead = stepped.find((e) => e.kind === 'lead' && e.active)
  // FREPAR fires when the lead's entry rotation has finished ramping (call site 1), or when there
  // is no live lead left to fly formation on at all (call site 2 — the shell that killed it).
  const freed = !postLead || (postLead.entryFrames ?? 0) === 0
  return stepped
    .map((s, i): Enemy => {
      if (s.kind !== 'drone' || !s.active || !s.parallel) return s
      if (freed) return { ...s, parallel: false } // FRDRNE: 2 → 1, offset resolved to absolute
      // Still PARALLEL: ride the lead — re-impose the drone's pre-step offset onto the new lead
      // position (a fixed offset, so the formation holds exactly across the frame).
      if (preLead && postLead) {
        const pre = enemies[i]
        return { ...s, x: postLead.x + (pre.x - preLead.x), y: postLead.y + (pre.y - preLead.y) }
      }
      return s
    })
    .filter((e) => e.active)
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

// ─── GRMODE — the ground-wave mode byte (rb3-2, findings §4) ───────────────────
//
// rb2-7 pinned the MODECT alternation but left the ground-parity slots as silent no-op
// waits. rb3-2 makes them ACTIVE: a ground slot enters GRMODE, the mode byte INITGR sets
// (GRMODE, RBARON.MAC:134). The main loop reads GRMODE to skip new-plane generation and to
// force the slow control band (findings §2/§4).
//
// ⚠ .RADIX 16 HEX: the ROM's `GRMODE=0C0` is 0xC0 (= 192), NOT decimal 12. The RBARON.MAC
// equate block is hex (proven in rb3-1: sibling `.STAR0=1B`, `P.MAXZ=1001`=HORZ+1).

/** GRMODE D7 — a ground wave is running (findings §4, INITGR). */
export const GRMODE_GROUND = 0x80

/** GRMODE D6 — the main loop skips new-plane generation (findings §4, INITGR). */
export const GRMODE_PLANE_DISABLE = 0x40

/** INITGR sets GRMODE = 0C0 = 0xC0 — D7 ground + D6 plane-disable both set (findings §4). */
export const GRMODE_INITGR = GRMODE_GROUND | GRMODE_PLANE_DISABLE

/** STPLNE / plane mode — the ground bits are clear, planes are generated normally. */
export const GRMODE_PLANE = 0x00

/** Is new-plane generation disabled in this GRMODE? Reads the D6 plane-disable bit (findings §4). */
export function planeGenDisabled(grmode: number): boolean {
  return (grmode & GRMODE_PLANE_DISABLE) !== 0
}

/** Is a ground wave running in this GRMODE? Reads the D7 ground bit (findings §4). */
export function isGroundMode(grmode: number): boolean {
  return (grmode & GRMODE_GROUND) !== 0
}

/**
 * The INITGR/STPLNE branch: the MODECT LSB selects the GRMODE its wave slot enters
 * (MODECT, RBARON.MAC:157). A plane slot (isPlaneWave) enters GRMODE_PLANE so
 * planes resume; a ground slot enters GRMODE_INITGR (0C0) so plane-generation is disabled
 * and control slows. Total — delegates to isPlaneWave, so it never returns NaN on any modect.
 */
export function grmodeForWave(modect: number): number {
  return isPlaneWave(modect) ? GRMODE_PLANE : GRMODE_INITGR
}

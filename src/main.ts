// src/main.ts
//
// The runnable cockpit — flown by the rb2-1 flight model, now with a live enemy.
// The yoke is the keyboard (←/→ or A/D turn, ↑/↓ or W/S climb-dive); its input
// feeds a FlightInput the sim steps ONCE per calculation frame (timing.ts
// SIM_TIMESTEP_S — findings §1: the sim ticks at ~10.42 Hz, NOT per display frame,
// or it runs ~6× too fast — the ÷N fidelity trap). The stepped attitude drives the
// rb1 tilting horizon; MULTI-PLANE WAVES of weaving enemy biplanes (rb2-7) are
// spawned, stepped in the SAME calc-frame loop, and drawn through the rb2-3 biplane
// substrate.
//
// The NEAREST plane's live depth feeds DISCHK: proximityBand(nearestDepth) sets
// FlightInput.proximity, so the control feel SHARPENS as the closest enemy closes in
// (findings §2). No throttle: forward motion is implicit; the pilot commands only
// turn and pitch (findings §2).
//
// THE KILL PAYOFF (rb2-6): a shell that connects SCORES the plane BY ITS KIND (rb2-7 —
// PLVALU for a close lead, the flat DRONE_SCORE for a drone), bumps the kill count that
// ramps the difficulty (OBJKLD → gmlevlForKills → GMLEVL, widening the weave), and hands
// the plane to its UPPLEX wreck — it falls, spins, bursts into the PIECE0-3 debris.
//
// THE WAVE (rb2-7): score-scaled counts (300 → 2 planes, 1000 → 3), drones in the
// PLANE1/PLANE2 formation, PLNXCG lead promotion, and the MODECT/MCOUNT schedule
// (stepWaveClock) that brings the next wave in after its inter-wave gap (waves.ts).

import { flightView, type Attitude } from './core/camera'
import { horizonSegments } from './core/horizon'
import { INITIAL_FLIGHT, step, toAttitude, controlBand, type FlightInput } from './core/flight'
import { step as stepEnemy, proximityBand, type Enemy } from './core/enemy'
import {
  spawnWave, promoteLead, INITIAL_WAVE_CLOCK, stepWaveClock,
  grmodeForWave, planeGenDisabled, isGroundMode, GRMODE_PLANE,
} from './core/waves'
import { biplaneLOD, renderModel } from './core/biplane'
import { initialMountains, stepMountain, mountainSegments, type Mountain } from './core/landscape'
import { sceneProjection, projectSegment, type SceneSegment } from './core/scene'
import { SIM_TIMESTEP_S } from './core/timing'
import { INITIAL_GUNS, fire, step as stepGuns, S_MAXZ, type Guns, type Shell } from './core/guns'
import { explode, stepWreck, EXPL2_FRAMES, type Wreck } from './core/explosion'
import { scoreKill, gmlevlForKills } from './core/scoring'
import { EXPLOSION_PIECES } from './core/topology'
import { multiply, translation, rotationZ, type Vec3, type Mat4 } from '@arcade/shared/math3d'
import { createRng } from '@arcade/shared/rng'

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')

/**
 * World depth a shell at z = S.MAXZ is drawn at — mirrors guns.ts's internal
 * SHELL_RANGE_DEPTH so a tracer appears at the same depth as the enemy it will hit.
 */
const SHELL_DRAW_FAR = 800

/** Each of the four PIECE0-3 debris fragments flies out along a distinct diagonal. Inferred. */
const DEBRIS_DIRS: readonly (readonly [number, number])[] = [
  [-1, 1],
  [1, 1],
  [-1, -1],
  [1, -1],
]
/** Window units each debris fragment spreads per exploding frame — the burst expands. Inferred. */
const DEBRIS_SPREAD = 4

function resize(): void {
  canvas.width = canvas.clientWidth || window.innerWidth
  canvas.height = canvas.clientHeight || window.innerHeight
}

/** NDC ([-1, 1], +y up) → canvas pixels (y down). */
function toPixel(nx: number, ny: number, width: number, height: number): [number, number] {
  return [((nx + 1) / 2) * width, ((1 - ny) / 2) * height]
}

/** Stroke a list of NDC segments as glowing vectors on the current context. */
function strokeSegments(segs: readonly SceneSegment[], width: number, height: number): void {
  if (!ctx) return
  ctx.beginPath()
  for (const seg of segs) {
    const [x1, y1] = toPixel(seg.x1, seg.y1, width, height)
    const [x2, y2] = toPixel(seg.x2, seg.y2, width, height)
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
  }
  ctx.stroke()
}

/**
 * Project a player shell to a short glowing tracer streak. The shell's z (0..S.MAXZ)
 * maps to a world depth; the streak trails one z-unit behind so it reads as motion.
 * The shell's (x, y) are world-window units — the same space the enemy lives in.
 */
function shellSegments(shell: Shell, viewProj: Mat4): readonly SceneSegment[] {
  const wd = (shell.z / S_MAXZ) * SHELL_DRAW_FAR
  const wdBack = (Math.max(0, shell.z - 1) / S_MAXZ) * SHELL_DRAW_FAR
  const front: Vec3 = [shell.x, shell.y, -wd]
  const back: Vec3 = [shell.x, shell.y, -wdBack]
  const seg = projectSegment(front, back, viewProj)
  return seg ? [seg] : []
}

/**
 * Draw the downed enemy (rb2-6): a spinning biplane while it FALLS, then the four
 * authentic PIECE0-3 explosion-debris models bursting outward while it EXPLODES
 * (findings §3). Nothing once the wreck is 'done'. renderModel accepts any
 * {points, connect} picture, so the topology debris pieces render like the plane.
 */
function drawWreck(wreck: Wreck, projView: Mat4, width: number, height: number): void {
  if (wreck.phase === 'falling') {
    const model = multiply(translation(wreck.x, wreck.y, -wreck.depth), rotationZ(wreck.spin))
    strokeSegments(renderModel(biplaneLOD(wreck.depth), multiply(projView, model)), width, height)
    return
  }
  if (wreck.phase === 'exploding') {
    const spread = (EXPL2_FRAMES - wreck.timer) * DEBRIS_SPREAD // grows as the burst opens
    EXPLOSION_PIECES.forEach((piece, i) => {
      const [dx, dy] = DEBRIS_DIRS[i]
      const model = multiply(
        translation(wreck.x + dx * spread, wreck.y + dy * spread, -wreck.depth),
        rotationZ(wreck.spin),
      )
      strokeSegments(renderModel(piece, multiply(projView, model)), width, height)
    })
  }
}

function draw(
  attitude: Attitude,
  enemies: readonly Enemy[],
  mountains: readonly Mountain[],
  wrecks: readonly Wreck[],
  shells: readonly Shell[],
  overheated: boolean,
  score: number,
): void {
  if (!ctx) return
  const { width, height } = canvas
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)

  const aspect = height === 0 ? 1 : width / height
  ctx.strokeStyle = '#33ff66'
  ctx.lineWidth = 2
  ctx.shadowColor = '#33ff66'
  ctx.shadowBlur = 8

  // the tilting horizon
  strokeSegments(horizonSegments(attitude, aspect), width, height)

  // the scrolling ground-wave landscape (rb3-3) — up to 4 SCAPE mountains falling
  // from the horizon, projected through the SAME rb1 substrate as everything else.
  // Empty (renders nothing) outside a ground wave.
  strokeSegments(mountainSegments(mountains, attitude, [0, 0, 0], aspect), width, height)

  // the wave — each live plane is a camera-relative screen-window object (x, y) at
  // `depth`, banked, tilting with the player's attitude. MVP = projection · view · model;
  // the LOD is picked by depth (biplaneLOD). Downed planes fall away as UPPLEX wrecks
  // (rb2-6) that coexist with the survivors still weaving (rb2-7 multi-plane waves).
  const view = flightView(attitude, [0, 0, 0])
  const projView = multiply(sceneProjection(aspect), view)
  for (const wreck of wrecks) {
    drawWreck(wreck, projView, width, height)
  }
  for (const enemy of enemies) {
    const model = multiply(translation(enemy.x, enemy.y, -enemy.depth), rotationZ(enemy.bank))
    strokeSegments(renderModel(biplaneLOD(enemy.depth), multiply(projView, model)), width, height)
  }

  // the player's tracers — bright bullets streaking out along the boresight (rb2-5)
  for (const shell of shells) {
    strokeSegments(shellSegments(shell, projView), width, height)
  }

  // GUN.ST overheat warning — the ROM "shows a warning" when the guns lock out
  // (findings §5); it clears as they cool, so the cue doubles as the cooldown signal.
  if (overheated) {
    ctx.save()
    ctx.fillStyle = '#ff5533'
    ctx.shadowColor = '#ff5533'
    ctx.shadowBlur = 12
    ctx.font = 'bold 24px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('GUNS HOT', width / 2, height * 0.16)
    ctx.restore()
  }

  // the running score (rb2-6) — PLVALU accrues per kill (closer = more). A minimal
  // readout until the ROM HUD glyph font (findings §7) arrives in a later story.
  ctx.save()
  ctx.fillStyle = '#33ff66'
  ctx.shadowColor = '#33ff66'
  ctx.shadowBlur = 8
  ctx.font = 'bold 20px monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(`SCORE ${score}`, 16, 12)
  ctx.restore()
}

// ─── the yoke: keyboard → FlightInput ─────────────────────────────────────────

const held = new Set<string>()
const CONTROL_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'a', 'A', 'd', 'D', 'w', 'W', 's', 'S',
  ' ', // Space = fire — must not scroll the page
])
const axis = (pos: boolean, neg: boolean): number => (pos ? 1 : 0) - (neg ? 1 : 0)

window.addEventListener('keydown', (e) => {
  held.add(e.key)
  if (CONTROL_KEYS.has(e.key)) e.preventDefault() // arrows must fly, not scroll
})
window.addEventListener('keyup', (e) => held.delete(e.key))

/** Depth of the CLOSEST live plane (smallest depth), or +Infinity when the sky is clear. */
function nearestDepth(planes: readonly Enemy[]): number {
  let d = Number.POSITIVE_INFINITY
  for (const e of planes) if (e.depth < d) d = e.depth
  return d
}

/**
 * The pilot's yoke plus the DISCHK band. Normally the live band from the nearest enemy's
 * depth ('far' when clear); while a ground wave runs (GRMODE D7) the control is forced to
 * the slow band regardless of the nearest object (rb3-2, findings §2).
 */
function readInput(enemies: readonly Enemy[], grmode: number): FlightInput {
  return {
    turn: axis(held.has('ArrowRight') || held.has('d') || held.has('D'), held.has('ArrowLeft') || held.has('a') || held.has('A')),
    pitch: axis(held.has('ArrowUp') || held.has('w') || held.has('W'), held.has('ArrowDown') || held.has('s') || held.has('S')),
    proximity: controlBand(isGroundMode(grmode), proximityBand(nearestDepth(enemies))),
  }
}

// ─── the loop: render at display rate, step the sim at the calc-frame rate ────

resize()
window.addEventListener('resize', resize)

let flight = INITIAL_FLIGHT
let kills = 0 // OBJKLD — each kill bumps this; gmlevlForKills(kills) drives the GMLEVL ramp
let score = 0 // running PLVALU total (closer kills score more)
let enemies: readonly Enemy[] = [] // the live wave (rb2-7); the schedule spawns the opening wave
let mountains: readonly Mountain[] = [] // the scrolling ground-wave landscape (rb3-3); populated only in GRMODE
let wrecks: Wreck[] = [] // downed planes falling/exploding as UPPLEX wrecks, coexisting with survivors
let waveClock = INITIAL_WAVE_CLOCK // MODECT/MCOUNT schedule — spaces waves at the calc-frame cadence
let grmode = GRMODE_PLANE // GRMODE ground-wave byte — set to INITGR (0C0) on a ground slot, cleared (STPLNE) on a plane slot (rb3-2)
let guns: Guns = INITIAL_GUNS
let lastMs: number | null = null
let accumulator = 0

function frame(nowMs: number): void {
  if (lastMs === null) lastMs = nowMs
  // Cap the catch-up so a stalled tab (huge dt) can't spiral the fixed-step loop.
  accumulator += Math.min((nowMs - lastMs) / 1000, 0.25)
  lastMs = nowMs

  const input = readInput(enemies, grmode)
  const fireHeld = held.has(' ')
  while (accumulator >= SIM_TIMESTEP_S) {
    flight = step(flight, input)
    guns = fire(guns, fireHeld)
    // advance any dying planes (fall → PIECE0-3 burst → done); drop the finished wrecks.
    wrecks = wrecks.map((w) => stepWreck(w)).filter((w) => w.phase !== 'done')

    // rb3-3: the scrolling landscape runs ONLY while a ground wave is up (GRMODE D7,
    // rb3-2). It seeds on the first ground calc-frame, scrolls toward the eye each
    // frame at the calc-frame cadence, and clears when the wave returns to the sky.
    if (isGroundMode(grmode)) {
      if (mountains.length === 0) mountains = initialMountains()
      mountains = mountains.map(stepMountain)
    } else if (mountains.length > 0) {
      mountains = []
    }

    const level = gmlevlForKills(kills)
    if (enemies.length > 0) {
      // A live wave: weave every plane at the kill-ramped level, then fire + collide the
      // shells (4× sub-step) against ALL of them. Each hit SCORES the downed plane BY ITS
      // KIND (drone flat 300, close lead more), bumps OBJKLD so the sky ramps, and hands
      // that plane to its wreck. If the lead falls, PLNXCG promotes a wingman to lead.
      enemies = enemies.map((e) => stepEnemy(e, level))
      const shotResult = stepGuns(guns, enemies)
      guns = shotResult.guns
      if (shotResult.hits.length > 0) {
        const downed = new Set<number>(shotResult.hits.map((h) => h.target))
        for (const idx of downed) {
          const plane = enemies[idx]
          score += scoreKill(plane.kind, plane.depth)
          kills += 1
          wrecks.push(explode(plane))
        }
        enemies = promoteLead(enemies.filter((_, i) => !downed.has(i)))
      }
    } else {
      // Sky clear of live planes: shells keep flying (strike nothing). Once the wrecks
      // finish, the MODECT/MCOUNT schedule brings the next plane wave in after its gap.
      guns = stepGuns(guns, []).guns
      if (wrecks.length === 0) {
        // A wave DECISION fires when the countdown has elapsed (pre-step countdown 0); it
        // advances MODECT, so capture the firing slot's modect BEFORE stepping.
        const decisionModect = waveClock.modect
        const wasDecision = waveClock.countdown === 0
        const sched = stepWaveClock(waveClock)
        waveClock = sched.clock
        // On a decision the slot enters its GRMODE: a plane slot clears ground mode (STPLNE),
        // a ground slot sets INITGR (0C0) so plane-gen is skipped + control slows. GRMODE holds
        // between decisions — only a decision transitions it (rb3-2, findings §4).
        if (wasDecision) grmode = grmodeForWave(decisionModect)
        // Plane waves spawn only when new-plane generation is enabled (D6 clear); a ground
        // slot's INITGR disables it, so the ground interval is an empty-sky, slow-control wait
        // until the next plane slot (ground-wave CONTENT lands in rb3-3..rb3-6).
        if (sched.spawnPlaneWave && !planeGenDisabled(grmode)) {
          enemies = spawnWave(createRng((Date.now() + kills) >>> 0), score, gmlevlForKills(kills))
        }
      }
    }
    accumulator -= SIM_TIMESTEP_S
  }

  draw(toAttitude(flight), enemies, mountains, wrecks, guns.shells, guns.overheated, score)
  window.requestAnimationFrame(frame)
}
window.requestAnimationFrame(frame)

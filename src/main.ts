// src/main.ts
//
// The runnable cockpit — flown by the rb2-1 flight model, now with a live enemy.
// The yoke is the keyboard (←/→ or A/D turn, ↑/↓ or W/S climb-dive); its input
// feeds a FlightInput the sim steps ONCE per calculation frame (timing.ts
// SIM_TIMESTEP_S — findings §1: the sim ticks at ~10.42 Hz, NOT per display frame,
// or it runs ~6× too fast — the ÷N fidelity trap). The stepped attitude drives the
// rb1 tilting horizon; a single weaving enemy biplane (rb2-4) is spawned, stepped
// in the SAME calc-frame loop, and drawn through the rb2-3 biplane substrate.
//
// The enemy's live depth feeds DISCHK: proximityBand(enemy.depth) sets
// FlightInput.proximity, so the control feel SHARPENS as the enemy closes in
// (findings §2). No throttle: forward motion is implicit; the pilot commands only
// turn and pitch (findings §2).
//
// THE KILL PAYOFF (rb2-6): a shell that connects SCORES the plane (PLVALU — closer
// kills are worth more), bumps the kill count that ramps the difficulty (OBJKLD →
// gmlevlForKills → GMLEVL, widening the weave), and hands the plane to its UPPLEX
// wreck — it falls, spins, bursts into the PIECE0-3 debris, then a fresh plane enters
// (explosion.ts + scoring.ts, replacing rb2-5's instant respawn).

import { flightView, type Attitude } from './core/camera'
import { horizonSegments } from './core/horizon'
import { INITIAL_FLIGHT, step, toAttitude, type FlightInput } from './core/flight'
import { spawn, step as stepEnemy, proximityBand, type Enemy } from './core/enemy'
import { biplaneLOD, renderModel } from './core/biplane'
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
  enemy: Enemy,
  wreck: Wreck | null,
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

  // the enemy — a camera-relative screen-window object (x, y) at `depth`, banked,
  // tilting with the player's attitude. MVP = projection · view · model; the LOD is
  // picked by depth (biplaneLOD). At level attitude the view is identity, so the plane
  // sits where its window pose puts it. Once it is shot down the live plane is replaced
  // by its UPPLEX wreck — falling, then bursting into PIECE0-3 debris (rb2-6).
  const view = flightView(attitude, [0, 0, 0])
  const projView = multiply(sceneProjection(aspect), view)
  if (wreck) {
    drawWreck(wreck, projView, width, height)
  } else {
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

/** The pilot's yoke plus the live DISCHK band from the nearest enemy's depth. */
function readInput(enemy: Enemy): FlightInput {
  return {
    turn: axis(held.has('ArrowRight') || held.has('d') || held.has('D'), held.has('ArrowLeft') || held.has('a') || held.has('A')),
    pitch: axis(held.has('ArrowUp') || held.has('w') || held.has('W'), held.has('ArrowDown') || held.has('s') || held.has('S')),
    proximity: proximityBand(enemy.depth),
  }
}

// ─── the loop: render at display rate, step the sim at the calc-frame rate ────

resize()
window.addEventListener('resize', resize)

let flight = INITIAL_FLIGHT
let kills = 0 // OBJKLD — each kill bumps this; gmlevlForKills(kills) drives the GMLEVL ramp
let score = 0 // running PLVALU total (closer kills score more)
let enemy = spawn(createRng(Date.now() >>> 0), gmlevlForKills(kills))
let wreck: Wreck | null = null // the downed enemy's falling/exploding UPPLEX wreck, or null when a plane is live
let guns: Guns = INITIAL_GUNS
let lastMs: number | null = null
let accumulator = 0

function frame(nowMs: number): void {
  if (lastMs === null) lastMs = nowMs
  // Cap the catch-up so a stalled tab (huge dt) can't spiral the fixed-step loop.
  accumulator += Math.min((nowMs - lastMs) / 1000, 0.25)
  lastMs = nowMs

  const input = readInput(enemy)
  const fireHeld = held.has(' ')
  while (accumulator >= SIM_TIMESTEP_S) {
    flight = step(flight, input)
    guns = fire(guns, fireHeld)
    if (wreck) {
      // The enemy is dead — animate its UPPLEX wreck (fall → PIECE0-3 burst → done);
      // shells keep flying but strike nothing until a fresh plane enters.
      wreck = stepWreck(wreck)
      guns = stepGuns(guns, []).guns
      if (wreck.phase === 'done') {
        wreck = null
        enemy = spawn(createRng((Date.now() + kills) >>> 0), gmlevlForKills(kills))
      }
    } else {
      // A live plane: weave it at the kill-ramped level, then fire + collide the shells
      // (4× sub-step) against it. A hit SCORES the kill (closer = more), bumps OBJKLD so
      // the sky ramps, and hands the plane to the wreck — replacing rb2-5's instant respawn.
      enemy = stepEnemy(enemy, gmlevlForKills(kills))
      const shotResult = stepGuns(guns, [enemy])
      guns = shotResult.guns
      if (shotResult.hits.length > 0) {
        score += scoreKill('lead', enemy.depth)
        kills += 1
        wreck = explode(enemy)
      }
    }
    accumulator -= SIM_TIMESTEP_S
  }

  draw(toAttitude(flight), enemy, wreck, guns.shells, guns.overheated, score)
  window.requestAnimationFrame(frame)
}
window.requestAnimationFrame(frame)

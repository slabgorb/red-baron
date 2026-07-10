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

import { flightView, type Attitude } from './core/camera'
import { horizonSegments } from './core/horizon'
import { INITIAL_FLIGHT, step, toAttitude, type FlightInput } from './core/flight'
import { spawn, step as stepEnemy, proximityBand, type Enemy } from './core/enemy'
import { biplaneLOD, renderModel } from './core/biplane'
import { sceneProjection, type SceneSegment } from './core/scene'
import { SIM_TIMESTEP_S } from './core/timing'
import { multiply, translation, rotationZ } from '@arcade/shared/math3d'
import { createRng } from '@arcade/shared/rng'

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')

/** GMLEVL 0 — score-scaled difficulty is rb2-7; this story flies the lone plane. */
const LEVEL = 0

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

function draw(attitude: Attitude, enemy: Enemy): void {
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
  // picked by depth (biplaneLOD). At LEVEL attitude the view is identity, so the
  // plane sits where its window pose puts it.
  const view = flightView(attitude, [0, 0, 0])
  const model = multiply(translation(enemy.x, enemy.y, -enemy.depth), rotationZ(enemy.bank))
  const mvp = multiply(multiply(sceneProjection(aspect), view), model)
  strokeSegments(renderModel(biplaneLOD(enemy.depth), mvp), width, height)
}

// ─── the yoke: keyboard → FlightInput ─────────────────────────────────────────

const held = new Set<string>()
const CONTROL_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'a', 'A', 'd', 'D', 'w', 'W', 's', 'S',
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
let enemy = spawn(createRng(Date.now() >>> 0), LEVEL)
let lastMs: number | null = null
let accumulator = 0

function frame(nowMs: number): void {
  if (lastMs === null) lastMs = nowMs
  // Cap the catch-up so a stalled tab (huge dt) can't spiral the fixed-step loop.
  accumulator += Math.min((nowMs - lastMs) / 1000, 0.25)
  lastMs = nowMs

  const input = readInput(enemy)
  while (accumulator >= SIM_TIMESTEP_S) {
    flight = step(flight, input)
    enemy = stepEnemy(enemy, LEVEL)
    accumulator -= SIM_TIMESTEP_S
  }

  draw(toAttitude(flight), enemy)
  window.requestAnimationFrame(frame)
}
window.requestAnimationFrame(frame)

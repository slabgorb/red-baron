// src/main.ts
//
// The runnable cockpit — now FLOWN by the authentic rb2-1 flight model. The yoke
// is the keyboard (←/→ or A/D turn, ↑/↓ or W/S climb-dive); its input feeds a
// FlightInput that the sim steps ONCE per calculation frame (timing.ts
// SIM_TIMESTEP_S — findings §1: the sim ticks at ~10.42 Hz, NOT per display
// frame, or it runs ~6× too fast — the ÷N fidelity trap). The stepped attitude
// drives the rb1 tilting horizon through the flight camera. No throttle: forward
// motion is implicit; the pilot commands only turn and pitch (findings §2).
//
// Still an EMPTY cockpit: horizon only, no enemy/biplane geometry (blocked on the
// picture-ROM source, findings §9 gap #1 — a later rb2 story). With nothing near,
// DISCHK sits in the slow 'far' band; the control feel sharpens near combat once
// enemies arrive (rb2-4+).

import { type Attitude } from './core/camera'
import { horizonSegments } from './core/horizon'
import { INITIAL_FLIGHT, step, toAttitude, type FlightInput, type ProximityBand } from './core/flight'
import { SIM_TIMESTEP_S } from './core/timing'

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')

function resize(): void {
  canvas.width = canvas.clientWidth || window.innerWidth
  canvas.height = canvas.clientHeight || window.innerHeight
}

/** NDC ([-1, 1], +y up) → canvas pixels (y down). */
function toPixel(nx: number, ny: number, width: number, height: number): [number, number] {
  return [((nx + 1) / 2) * width, ((1 - ny) / 2) * height]
}

function draw(attitude: Attitude): void {
  if (!ctx) return
  const { width, height } = canvas
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)

  const aspect = height === 0 ? 1 : width / height
  ctx.strokeStyle = '#33ff66'
  ctx.lineWidth = 2
  ctx.shadowColor = '#33ff66'
  ctx.shadowBlur = 8
  ctx.beginPath()
  for (const seg of horizonSegments(attitude, aspect)) {
    const [x1, y1] = toPixel(seg.x1, seg.y1, width, height)
    const [x2, y2] = toPixel(seg.x2, seg.y2, width, height)
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
  }
  ctx.stroke()
}

// ─── the yoke: keyboard → FlightInput ─────────────────────────────────────────

/** Nothing near in the empty cockpit → DISCHK's slow air band (findings §2). */
const proximity: ProximityBand = 'far'

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

function readInput(): FlightInput {
  return {
    turn: axis(held.has('ArrowRight') || held.has('d') || held.has('D'), held.has('ArrowLeft') || held.has('a') || held.has('A')),
    pitch: axis(held.has('ArrowUp') || held.has('w') || held.has('W'), held.has('ArrowDown') || held.has('s') || held.has('S')),
    proximity,
  }
}

// ─── the loop: render at display rate, step the sim at the calc-frame rate ────

resize()
window.addEventListener('resize', resize)

let flight = INITIAL_FLIGHT
let lastMs: number | null = null
let accumulator = 0

function frame(nowMs: number): void {
  if (lastMs === null) lastMs = nowMs
  // Cap the catch-up so a stalled tab (huge dt) can't spiral the fixed-step loop.
  accumulator += Math.min((nowMs - lastMs) / 1000, 0.25)
  lastMs = nowMs

  const input = readInput()
  while (accumulator >= SIM_TIMESTEP_S) {
    flight = step(flight, input)
    accumulator -= SIM_TIMESTEP_S
  }

  draw(toAttitude(flight))
  window.requestAnimationFrame(frame)
}
window.requestAnimationFrame(frame)

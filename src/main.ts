// src/main.ts
//
// rb1-3 — the runnable empty cockpit. Boots a black canvas and flies the
// tilting horizon foundation: the flight camera (src/core/camera) feeds the
// horizon substrate (src/core/horizon), whose NDC segments the shell strokes as
// glowing vectors. A gentle demonstrator bank shows the horizon tilting — the
// rb1 epic's exit criterion, "a runnable banking cockpit flying over vector
// terrain". No enemies, no biplane geometry (blocked on the absent picture-ROM
// source, findings §9 gap #1); the authentic flight model is rb2.

import { LEVEL, type Attitude } from './core/camera'
import { horizonSegments } from './core/horizon'

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

resize()
window.addEventListener('resize', resize)

// Gentle demonstrator bank so the tilting horizon is visible in the empty cockpit.
// (The authentic PLDELX/PLDELY flight model that drives attitude arrives in rb2.)
function frame(nowMs: number): void {
  const roll = Math.sin(nowMs / 1500) * 0.35
  draw({ ...LEVEL, roll })
  window.requestAnimationFrame(frame)
}
window.requestAnimationFrame(frame)

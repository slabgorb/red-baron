// src/tools/contactSheet.ts
//
// ROM|PORT vector-picture contact sheet — a standalone dev page (/models.html)
// that renders every entry of the baked ROM_PICTURES registry (rom-picture-
// contact-sheet story) side by side with red-baron's own ported geometry
// (core/topology.ts + core/biplane.ts). The plane's connect-lists already
// have a passing test oracle (tests/rom-models/oracle-red-baron.test.mjs) —
// but the propeller, the four explosion pieces, the two star-debris shapes,
// and the blimp were hand-transcribed and never checked. This sheet is that
// check, rendered so the geometry can be eyeballed, not just diffed.
//
// UNLIKE star-wars's contact sheet (where the port's edges were GUESSED, so
// drift is expected and interesting), red-baron's port edges were PORTED
// directly from the same ROM tables this sheet's left half reads. Zero drift
// is therefore the expected, unremarkable PASS here — any drift shown is a
// real transcription bug, not something to "fix" by editing the port.
//
//   [C]      toggle ROM|PORT compare ↔ ROM-only (full-width single view)
//   [SPACE]  pause / resume rotation
//
// Draws through red-baron's REAL projection substrate (core/scene.ts's
// sceneProjection + projectSegment — the exact functions src/main.ts uses),
// stroked with the game's own green glow (#33ff66, lineWidth 2, shadowBlur 8
// — see src/main.ts's draw()). DOM/dev-tool code — never imported by the
// deterministic core or its tests.

import { sceneProjection, projectSegment, type SceneSegment } from '../core/scene'
import { multiply, rotationX, rotationY, translation, type Mat4, type Vec3 } from '@arcade/shared/math3d'
import { withGlow } from '@arcade/shared/glow'
import { modelBounds, fitDistance, cellRects } from './sheetLayout'
import { pairPictures, verdictFor, type PicturePair } from './romCompare'

// Matches core/scene.ts's own (private) VERTICAL_FOV — the cockpit's 60°
// window. Duplicated here as a literal because scene.ts doesn't export it;
// sceneProjection itself IS reused, so the projection math never drifts.
const FOV_Y = Math.PI / 3
const COLS = 4
const SPIN_RATE = 0.6 // radians per second
// Fixed 3/4-view pitch so flat pictures (STAR0/STAR1's z=0 plane, COLLD's
// z=-40 plane) never spin edge-on to the camera — same reasoning as
// star-wars's contact sheet VIEW_TILT.
const VIEW_TILT = -Math.PI / 6
const LABEL_FONT = '700 13px monospace'
const HINT_COLOR = '#7a8699'
const DRIFT_COLOR = '#ff5a5a'
const GLOW_COLOR = '#33ff66' // src/main.ts's cabinet green
const DOT_RADIUS = 2.5

const canvas = document.getElementById('sheet') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!

let dpr = Math.min(2, window.devicePixelRatio || 1)
let W = window.innerWidth
let H = window.innerHeight

function resize(): void {
  dpr = Math.min(2, window.devicePixelRatio || 1)
  W = window.innerWidth
  H = window.innerHeight
  canvas.width = Math.floor(W * dpr)
  canvas.height = Math.floor(H * dpr)
  canvas.style.width = `${W}px`
  canvas.style.height = `${H}px`
}
window.addEventListener('resize', resize)
resize()

let spinning = true
let spinAngle = 0
let compareMode = true // ROM|PORT split (default) vs ROM-only full-width

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault()
    spinning = !spinning
  } else if (e.key === 'c' || e.key === 'C') {
    compareMode = !compareMode
  }
})

const pairs = pairPictures()
// Geometry is static — measure each pair's bounding sphere once. Always
// sourced from the ROM points (the authoritative geometry per this file's own
// header) so a genuine ROM/port scale mismatch stays VISIBLE instead of being
// normalised away — both halves of a cell share ONE bound.
const bounds = pairs.map((p) => modelBounds(p.rom.points))

/** NDC ([-1, 1], +y up) → cell-local canvas pixels (y down). Mirrors
 * src/main.ts's own toPixel — the same NDC→pixel convention the game uses. */
function toPixel(nx: number, ny: number, w: number, h: number): [number, number] {
  return [((nx + 1) / 2) * w, ((1 - ny) / 2) * h]
}

/** Compose this cell/half's view: recentre on the shared bound -> spin ->
 * fixed 3/4 tilt -> push back to the fit distance. Matrices compose
 * right-to-left (mirrors star-wars contactSheet.ts's modelView build). */
function buildModelView(center: Vec3, dist: number): Mat4 {
  const recentre = translation(-center[0], -center[1], -center[2])
  const spun = multiply(rotationY(spinAngle), recentre)
  const tilted = multiply(rotationX(VIEW_TILT), spun)
  return multiply(translation(0, 0, -dist), tilted)
}

/** Stroke a picture's edges through the real scene.ts substrate. */
function drawEdges(
  points: readonly Vec3[],
  edges: readonly (readonly [number, number])[],
  mvp: Mat4,
  w: number,
  h: number,
): void {
  withGlow(ctx, { stroke: GLOW_COLOR, width: 2, blur: 8 }, () => {
    ctx.beginPath()
    for (const [a, b] of edges) {
      const seg: SceneSegment | null = projectSegment(points[a], points[b], mvp)
      if (!seg) continue
      const [x1, y1] = toPixel(seg.x1, seg.y1, w, h)
      const [x2, y2] = toPixel(seg.x2, seg.y2, w, h)
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
    }
    ctx.stroke()
  })
}

/** Draw a points-only picture's vertices as unconnected glowing dots — no
 * edges, so no connectivity is fabricated for a picture the ROM itself only
 * ever draws as a point-set (Collision pts). Reuses projectSegment(v, v, mvp)
 * (same point twice) so it still goes through the real projection substrate,
 * not a hand-rolled clip-space reimplementation. */
function drawDots(points: readonly Vec3[], mvp: Mat4, w: number, h: number): void {
  withGlow(ctx, { stroke: GLOW_COLOR, width: 2, blur: 8 }, () => {
    ctx.fillStyle = GLOW_COLOR
    for (const v of points) {
      const seg = projectSegment(v, v, mvp)
      if (!seg) continue
      const [x, y] = toPixel(seg.x1, seg.y1, w, h)
      ctx.beginPath()
      ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2)
      ctx.fill()
    }
  })
}

/** Draw one half (ROM or PORT) of a comparison cell — or the whole cell in
 * ROM-only mode. `pointsOnly` picks dots vs edges; both sides of Collision
 * pts render as dots (the port has no connect-list for it either). */
function drawSide(
  points: readonly Vec3[],
  edges: readonly (readonly [number, number])[],
  pointsOnly: boolean,
  center: Vec3,
  radius: number,
  w: number,
  h: number,
): void {
  const dist = fitDistance(radius, FOV_Y)
  const proj = sceneProjection(w / h)
  const modelView = buildModelView(center, dist)
  const mvp = multiply(proj, modelView)
  if (pointsOnly) drawDots(points, mvp, w, h)
  else drawEdges(points, edges, mvp, w, h)
}

function drawLabel(text: string, x: number, y: number, color: string): void {
  ctx.font = LABEL_FONT
  ctx.textAlign = 'left'
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

function drawCell(p: PicturePair, bound: { center: Vec3; radius: number }, r: { x: number; y: number; w: number; h: number }): void {
  const { center, radius } = bound
  const romEdgeCount = p.rom.edges.length
  const portEdgeCount = p.portEdges.length

  ctx.save()
  ctx.beginPath()
  ctx.rect(r.x, r.y, r.w, r.h)
  ctx.clip()
  ctx.translate(r.x, r.y)

  if (compareMode && p.port) {
    const half = r.w / 2
    drawSide(p.rom.points, p.rom.edges, p.pointsOnly, center, radius, half, r.h)
    ctx.save()
    ctx.translate(half, 0)
    drawSide(p.port.points, p.portEdges, p.pointsOnly, center, radius, half, r.h)
    ctx.restore()

    drawLabel('ROM', 8, r.h - 34, HINT_COLOR)
    drawLabel(`V:${p.rom.points.length} E:${p.pointsOnly ? '—' : romEdgeCount}`, 8, r.h - 20, HINT_COLOR)
    drawLabel('PORT', half + 8, r.h - 34, HINT_COLOR)
    drawLabel(`V:${p.port.points.length} E:${p.pointsOnly ? '—' : portEdgeCount}`, half + 8, r.h - 20, HINT_COLOR)

    // centre divider so the ROM|PORT split is legible on any picture
    ctx.strokeStyle = '#1c2430'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(half, 0)
    ctx.lineTo(half, r.h)
    ctx.stroke()
  } else {
    drawSide(p.rom.points, p.rom.edges, p.pointsOnly, center, radius, r.w, r.h)
    drawLabel(compareMode ? 'ROM (no port mapping)' : 'ROM', 8, r.h - 34, HINT_COLOR)
    drawLabel(`V:${p.rom.points.length} E:${p.pointsOnly ? '—' : romEdgeCount}`, 8, r.h - 20, HINT_COLOR)
  }

  drawLabel(p.name.toUpperCase(), 8, 18, GLOW_COLOR)
  if (p.pointsOnly) drawLabel('points only', 8, 34, HINT_COLOR)

  const verdict = verdictFor(p)
  drawLabel(verdict.text, 8, r.h - 6, verdict.drift ? DRIFT_COLOR : HINT_COLOR)

  ctx.restore()
}

let last = 0
function frame(now: number): void {
  const dt = last ? (now - last) / 1000 : 0
  last = now
  if (spinning) spinAngle += SPIN_RATE * dt

  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  const rects = cellRects(W, H, pairs.length, COLS)
  for (let i = 0; i < pairs.length; i++) {
    drawCell(pairs[i], bounds[i], rects[i])
  }

  ctx.font = LABEL_FONT
  ctx.textAlign = 'center'
  ctx.fillStyle = HINT_COLOR
  ctx.shadowBlur = 0
  ctx.fillText(
    `RED BARON ROM|PORT COMPARE   ·   [C] ${compareMode ? 'compare' : 'ROM-only'}   ·   [SPACE] ${spinning ? 'pause' : 'play'}`,
    W / 2,
    H - 8,
  )

  ctx.restore()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

// src/main.ts
// rb1-1 scaffold entry: paints the black canvas and proves the @arcade/shared
// pipe bundles under `vite build` — not just under vitest. rb1-3 replaces this
// placeholder with the real first-person flight camera built on the shared Math
// Box (roll/pitch/yaw → viewMatrix → the tilting horizon).
import { IDENTITY } from '@arcade/shared/math3d'

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')
if (ctx) {
  canvas.width = canvas.clientWidth
  canvas.height = canvas.clientHeight
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
}

// Reference the shared Math Box so the consumer link is real in the production
// bundle, not only in tests. IDENTITY is a length-16 row-major mat4.
export const MATH_BOX_DIMENSION = IDENTITY.length

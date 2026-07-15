// tests/landscape-wiring.test.ts
//
// Story rb3-3 — RED phase (Furiosa / TEA). The "keep the sneaky dev honest" guard:
// the pure mountain sim + render (tests/core/landscape.test.ts) and the transcribed
// connect-tables (tests/core/mountain-render-data.test.ts) are worthless if main.ts
// never scrolls the pass into the cockpit loop — or if landscape.ts quietly forks a
// SECOND renderer instead of reusing the rb1 scene substrate (the story's headline
// constraint: "Reuse the rb1 render substrate … do NOT add a new renderer").
//
// vitest runs under environment:'node' (no DOM), so main.ts can't be imported and
// executed — like tests/ground-mode-wiring.test.ts, this reads the source as TEXT
// and asserts the wiring structurally.
//
// SCOPE NOTE: rb3-3 renders the ground-wave landscape. It rides on rb3-2's GRMODE
// entry, so the mountains must be stepped + drawn while a GROUND wave runs (findings
// §4). This pins that the pass REACHES the runnable loop and that the render goes
// through scene.projectSegment — not that the exact per-frame feel is correct.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// tests/landscape-wiring.test.ts → repo root is one level up from tests/.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string): string => {
  try {
    return readFileSync(join(root, rel), 'utf8')
  } catch {
    return ''
  }
}
const mainText = read(join('src', 'main.ts'))
const landscapeText = read(join('src', 'core', 'landscape.ts'))

describe('rb3-3 wiring — main.ts scrolls the mountain pass into the cockpit loop', () => {
  it('main.ts exists and is non-empty', () => {
    expect(mainText.length).toBeGreaterThan(0)
  })

  it('imports the landscape module', () => {
    expect(/from\s+['"]\.\/core\/landscape['"]/.test(mainText)).toBe(true)
  })

  it('ADVANCES the pass each calc-frame — references stepMountain', () => {
    expect(/stepMountain/.test(mainText)).toBe(true)
  })

  it('actually DRAWS the mountains — strokes the mountainSegments output', () => {
    // Not merely computed and dropped: the projected segments must be stroked.
    expect(/mountainSegments/.test(mainText)).toBe(true)
    expect(/strokeSegments\s*\(\s*mountainSegments/.test(mainText)).toBe(true)
  })

  it('gates the landscape to a GROUND wave — the pass rides on rb3-2 GRMODE', () => {
    // The mountains belong to the ground sequence; a plane wave shows empty sky.
    expect(/isGroundMode|grmode|GRMODE/.test(mainText)).toBe(true)
  })
})

describe('rb3-3 wiring — landscape.ts REUSES the rb1 substrate (no new renderer)', () => {
  it('landscape.ts exists and is non-empty', () => {
    expect(landscapeText.length).toBeGreaterThan(0)
  })

  it('projects through the scene substrate (projectWorldSegment, imported from ./scene)', () => {
    // rb4-5: mountains are PLAYFIELD objects, so they take the ROM's POSITH HORIZN lift —
    // projectWorldSegment (scene.ts), still the shared rb1 substrate, not a new renderer.
    expect(/project(World)?Segment/.test(landscapeText)).toBe(true)
    expect(/from\s+['"]\.\/scene['"]/.test(landscapeText)).toBe(true)
  })

  it('does NOT fork a second projector — no direct perspective()/new sceneProjection', () => {
    // The one perspective matrix of the game lives in scene.ts. A mountain-specific
    // perspective(...) call or a rival sceneProjection definition IS a new renderer.
    expect(/\bperspective\s*\(/.test(landscapeText)).toBe(false)
    expect(/function\s+sceneProjection/.test(landscapeText)).toBe(false)
  })

  it('composes the camera view via camera.flightView, not a bespoke view matrix', () => {
    expect(/flightView/.test(landscapeText)).toBe(true)
  })
})

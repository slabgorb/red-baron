// tests/cockpit-boot.test.ts
//
// Story rb1-3 — RED phase (Furiosa / TEA). The "runnable empty cockpit" wiring +
// the scope fence around the picture-ROM gap.
//
// The exit criterion of the rb1 foundation epic is "a runnable banking cockpit
// flying over vector terrain" (design brief §4). The DETERMINISTIC pieces (camera,
// scene, horizon, timing) are pinned by tests/core/*. This suite proves the pieces
// are actually WIRED INTO the runnable entry — the flight camera and the tilting
// horizon reach the canvas — and fences off what rb1-3 must NOT build.
//
// vitest runs under environment:'node' (no DOM), so main.ts can't be imported and
// executed. Like the rb1-1 scaffold suite, this reads src/ as TEXT and asserts the
// wiring structurally — the "keep the sneaky dev honest" integration guard.
//
// SCOPE FENCE (findings §9, open gap #1): the picture-ROM SOURCE (RBPICS.MAC /
// RBCHAR.MAC — the biplane face/line connect-lists) is ABSENT from the quarry, so
// the plane's connect topology is not yet enumerable. Authentic biplane geometry
// is a follow-up story, explicitly BLOCKED before rb1-3. "Empty cockpit" is literal:
// horizon + terrain substrate, NO enemy/biplane models. This suite fails if a
// biplane geometry module sneaks in.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// tests/cockpit-boot.test.ts → repo root is one level up from tests/.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(root, 'src')

/** Every .ts file under src/, as { relPath, text }. */
function srcFiles(): ReadonlyArray<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = []
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry.endsWith('.ts')) out.push({ path: full.slice(root.length + 1), text: readFileSync(full, 'utf8') })
    }
  }
  walk(SRC)
  return out
}

const files = srcFiles()
const anyMatch = (re: RegExp): boolean => files.some((f) => re.test(f.text))

describe('cockpit boot — the runnable entry exists', () => {
  it('src/main.ts exists (the module index.html boots)', () => {
    expect(existsSync(join(SRC, 'main.ts')), 'red-baron/src/main.ts must exist').toBe(true)
  })
})

describe('cockpit boot — the flight camera + tilting horizon are wired to the screen', () => {
  it('some src module consumes the flight camera (imports ./core/camera)', () => {
    expect(anyMatch(/from\s+['"][./]*core\/camera['"]/), 'the runnable cockpit must use src/core/camera').toBe(true)
  })

  it('some src module consumes the tilting horizon (imports ./core/horizon)', () => {
    expect(anyMatch(/from\s+['"][./]*core\/horizon['"]/), 'the runnable cockpit must render src/core/horizon').toBe(true)
  })

  it('the shell strokes vectors on a 2D canvas (getContext("2d") + a vector stroke)', () => {
    // "Glowing vector lines on black", not just a filled rectangle: the render
    // path must actually draw the horizon as strokes/paths, somewhere in src.
    expect(anyMatch(/getContext\(\s*['"]2d['"]\s*\)/), 'must acquire a 2D canvas context').toBe(true)
    expect(anyMatch(/\.(stroke|lineTo|moveTo)\s*\(/), 'must stroke vector paths (moveTo/lineTo/stroke)').toBe(true)
  })
})

describe('cockpit boot — scope fence: NO biplane geometry (findings §9 gap #1)', () => {
  it('ships no biplane geometry module (plane.ts / biplane.ts / plane-points.ts)', () => {
    // The 42 vertices are known, but the connect topology lives in the absent
    // RBPICS.MAC/RBCHAR.MAC — a BLOCKED follow-up, not rb1-3.
    const banned = /(^|\/)(plane|biplane|plane-points)\.ts$/
    const offenders = files.filter((f) => banned.test(f.path)).map((f) => f.path)
    expect(offenders, `biplane geometry is out of scope (blocked on the absent picture-ROM source): ${offenders.join(', ')}`).toEqual([])
  })

  it('no src module imports a biplane geometry model', () => {
    expect(anyMatch(/from\s+['"][^'"]*(biplane|plane-points)['"]/), 'no biplane/plane-points import in rb1-3').toBe(false)
  })
})

describe('cockpit boot — the flight model drives the camera at the calc-frame rate (rb2-1)', () => {
  it('the runnable cockpit consumes the rb2 flight model (imports ./core/flight)', () => {
    expect(anyMatch(/from\s+['"][./]*core\/flight['"]/), 'the cockpit must be flown by src/core/flight').toBe(true)
  })

  it('steps the sim inside a SIM_TIMESTEP_S accumulator, NOT once per display frame (÷N-trap guard, findings §1)', () => {
    // Ticking step() per requestAnimationFrame runs the sim ~6× too fast (the Red
    // Baron analogue of the Asteroids ÷4 trap). The fix is a fixed-step accumulator
    // gated on the calc-frame timestep — pin it structurally so a refactor back to
    // "one step per rendered frame" fails loudly here.
    expect(anyMatch(/from\s+['"][./]*core\/timing['"]/), 'the cockpit must import the calc-frame cadence (SIM_TIMESTEP_S)').toBe(true)
    expect(
      anyMatch(/while\s*\([^)]*SIM_TIMESTEP_S[^)]*\)/),
      'step() must run inside a while-accumulator gated on SIM_TIMESTEP_S, not per rAF frame',
    ).toBe(true)
  })
})

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
// SCOPE FENCE (RETIRED in rb2-3): rb1-3 fenced off biplane geometry while findings
// §9 gap #1 was open — the picture-ROM connect-lists were thought absent. That gap
// is now CLOSED: rb2-2 transcribed the connect-lists (topology.ts) and rb2-3 the 42
// plane vertices + LOD render (biplane.ts, covered by tests/core/biplane.test.ts).
// The "NO biplane geometry" fence has served its purpose and is removed; the wiring
// checks below still keep the runnable cockpit honest.

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

describe('cockpit boot — the single enemy is spawned, flown, drawn, and felt (rb2-4)', () => {
  const mainTs = files.find((f) => f.path.endsWith('main.ts'))?.text ?? ''

  // NOTE: these guards test `mainTs` (the runnable entry's OWN text), NOT `anyMatch`
  // across all of src/. `renderModel`/`proximityBand` are DECLARED in core modules
  // (biplane.ts / enemy.ts), so an `anyMatch(/\brenderModel\s*\(/)` would be satisfied
  // by those declarations and pass even if main.ts never wired anything (rb2-4 review
  // finding). Scoping to main.ts's text makes each guard actually fail if the cockpit
  // drops the wiring. The `renderModel(` / `proximityBand(` forms match the CALL, not
  // the `import { renderModel }` line (no `(` after the name there).

  it('the cockpit consumes the enemy AI (imports ./core/enemy)', () => {
    expect(/from\s+['"][./]*core\/enemy['"]/.test(mainTs), 'main.ts must import src/core/enemy').toBe(true)
  })

  it('the enemy is actually DRAWN — main.ts renders the biplane model (renderModel from ./core/biplane)', () => {
    expect(/from\s+['"][./]*core\/biplane['"]/.test(mainTs), 'main.ts must import src/core/biplane to draw the enemy').toBe(true)
    expect(/\brenderModel\s*\(/.test(mainTs), 'main.ts must CALL renderModel to stroke the enemy geometry').toBe(true)
  })

  it('the live enemy depth drives DISCHK — proximity is COMPUTED in main.ts, not the hardcoded rb2-1 "far"', () => {
    // rb2-1 pinned `proximity: 'far'` because there were no enemies. rb2-4 wires the
    // nearest-enemy depth through proximityBand so the control feel sharpens on approach.
    expect(/\bproximityBand\s*\(/.test(mainTs), 'main.ts must CALL proximityBand(enemy.depth) for FlightInput.proximity').toBe(true)
    // and the dead rb2-1 hardcode must be gone — proximity is no longer a fixed 'far' const.
    expect(/const\s+proximity\s*:\s*ProximityBand\s*=\s*['"]far['"]/.test(mainTs), 'main.ts must not hardcode proximity to a constant "far"').toBe(false)
  })

  it('the stale "empty cockpit / no enemy geometry" comment is retired from main.ts', () => {
    // The context calls out the now-false rb2-1 comment. Once the enemy is wired, the
    // "Still an EMPTY cockpit ... no enemy/biplane geometry ... a later rb2 story" note
    // is a lie — it must be updated.
    expect(/no enemy\/biplane geometry/i.test(mainTs), 'main.ts still claims it has no enemy geometry').toBe(false)
    expect(/Still an EMPTY cockpit/i.test(mainTs), 'main.ts still calls itself an empty cockpit').toBe(false)
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
    // Require the step() call to appear INSIDE the while-block body — a bare
    // `while(…SIM_TIMESTEP_S…)` existing somewhere doesn't prove the sim ticks in
    // it (step() could be moved outside a vestigial loop and still match).
    expect(
      anyMatch(/while\s*\([^)]*SIM_TIMESTEP_S[^)]*\)\s*\{[^}]*\bstep\s*\(/),
      'step() must be called INSIDE the SIM_TIMESTEP_S accumulator block, not once per rAF frame',
    ).toBe(true)
  })
})

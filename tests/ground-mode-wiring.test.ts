// tests/ground-mode-wiring.test.ts
//
// Story rb3-2 — RED phase (O'Brien / TEA). The "keep the sneaky dev honest" integration
// guard: the pure GRMODE / forced-slow logic (tests/core/ground-mode.test.ts) is worthless
// if main.ts never wires it into the cockpit loop. rb2-7 left main.ts spawning a plane wave
// on EVERY scheduler decision; rb3-2 must (a) enter GRMODE on a ground slot, (b) SKIP the
// new-plane spawn while plane-generation is disabled, and (c) force the slow DISCHK band on
// the pilot's FlightInput while a ground wave runs. Grounded in findings §4 (INITGR sets
// GRMODE=0C0 so the main loop skips new-plane generation) and §2 (ground mode forced to slow).
//
// vitest runs under environment:'node' (no DOM), so main.ts can't be imported and executed —
// like tests/multiplane-wiring.test.ts / tests/cockpit-boot.test.ts, this reads main.ts as
// TEXT and asserts the wiring structurally.
//
// SCOPE NOTE: rb3-2 is MODE ENTRY only — the ground-wave CONTENT (scrolling landscape,
// ground targets, terrain-crash death) is rb3-3..rb3-6. This pins that the mode byte and the
// forced-slow band REACH the runnable loop, not that ground combat exists.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// tests/ground-mode-wiring.test.ts → repo root is one level up from tests/.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mainText = ((): string => {
  try {
    return readFileSync(join(root, 'src', 'main.ts'), 'utf8')
  } catch {
    return ''
  }
})()

describe('rb3-2 wiring — main.ts enters GRMODE and forces slow control (findings §2/§4)', () => {
  it('main.ts exists and is non-empty', () => {
    expect(mainText.length).toBeGreaterThan(0)
  })

  it('branches the wave mode by MODECT — main.ts references the INITGR/STPLNE GRMODE branch', () => {
    // The ground-parity slot must now DO something (enter ground mode), not silently wait.
    expect(/grmodeForWave|GRMODE_INITGR|GRMODE_GROUND/.test(mainText)).toBe(true)
  })

  it('SKIPS new-plane generation while a ground wave runs — main.ts gates the spawn on the mode', () => {
    // findings §4: "sets GRMODE=0C0 … so the main loop skips new-plane generation." The
    // spawnWave call must be guarded by the plane-disable / ground-mode predicate.
    expect(/planeGenDisabled|isGroundMode/.test(mainText)).toBe(true)
  })

  it('forces the SLOW DISCHK band in ground mode — main.ts feeds controlBand into the FlightInput', () => {
    // findings §2: ground mode is forced to the slow band. The pilot's proximity must route
    // through the forced-slow helper, not straight from proximityBand(nearestDepth(...)).
    expect(/controlBand|GROUND_CONTROL_BAND/.test(mainText)).toBe(true)
  })
})

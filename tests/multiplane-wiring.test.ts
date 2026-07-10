// tests/multiplane-wiring.test.ts
//
// Story rb2-7 — RED phase (O'Brien / TEA). The "keep the sneaky dev honest"
// integration guard: the pure wave/formation/firing logic (tests/core/waves.test.ts,
// tests/core/enemy-fire.test.ts) is worthless if main.ts never wires it in. rb2-6
// left main.ts spawning ONE plane and hardcoding scoreKill('lead', …); rb2-7 must
// spawn WAVES and score each downed plane by ITS kind.
//
// vitest runs under environment:'node' (no DOM), so main.ts can't be imported and
// executed — like tests/cockpit-boot.test.ts, this reads main.ts as TEXT and asserts
// the wiring structurally.
//
// SCOPE NOTE: this pins that the wave layer REACHES the runnable cockpit. The enemy
// FIRING decision (planeFires) is pure-logic-only in rb2-7 — its shell/player-damage
// channel is deferred to rb2-8 (evade) / rb2-9 (lives), so it is NOT gated here.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// tests/multiplane-wiring.test.ts → repo root is one level up from tests/.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mainText = ((): string => {
  try {
    return readFileSync(join(root, 'src', 'main.ts'), 'utf8')
  } catch {
    return ''
  }
})()

describe('rb2-7 wiring — main.ts flies multi-plane waves, not a lone plane', () => {
  it('main.ts exists and is non-empty', () => {
    expect(mainText.length).toBeGreaterThan(0)
  })

  it('spawns a WAVE — main.ts uses spawnWave (replacing rb2-4/rb2-6 single spawn)', () => {
    expect(/spawnWave/.test(mainText)).toBe(true)
  })

  it('scores a kill by the downed plane KIND — main.ts reads .kind, not a hardcoded lead literal', () => {
    // The kill payoff must route through the hit target's kind so a drone scores the
    // flat DRONE_SCORE and a close lead its depth bonus — the rb2-6 blocking seam, closed.
    expect(/\.kind\b/.test(mainText)).toBe(true)
    // and the old hardcoded lead literal must be gone from the scoreKill call site.
    expect(/scoreKill\(\s*['"]lead['"]/.test(mainText)).toBe(false)
  })

  it('runs the MODECT/MCOUNT wave schedule — main.ts references the wave clock', () => {
    // Waves are spaced by MCOUNT at the calc-frame cadence — main must drive the schedule,
    // not respawn instantly. Any of the schedule primitives satisfies the wiring.
    expect(/stepWaveClock|WaveClock|interWaveDelay|isPlaneWave|MCOUNT/.test(mainText)).toBe(true)
  })
})

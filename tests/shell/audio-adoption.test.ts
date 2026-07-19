// tests/shell/audio-adoption.test.ts
//
// SH2-18 — red-baron adopts @arcade/shared/synth (AC-8).
//
// Red Baron is the DONOR: its engine already carried the no-throw contract that the
// shared skeleton was lifted from, so adoption here is a genuine refactor and the
// existing suite (tests/shell/audio.test.ts) is the safety net. What this file adds is
// the fence:
//   • The VERB must leave  — the skeleton comes from @arcade/shared/synth now.
//   • The NUMBERS must stay — every ROM seam and all POKEY math is Red Baron's alone.
//     The shared engine has no idea what a POKEY is, and must never learn.
//
// ── REVIEW ROUND 1: the surface/NUMBERS checks were VACUOUS and are rebuilt ──
// They scanned source TEXT with un-anchored regexes, so a bare mention in a COMMENT
// satisfied them, and the "full cabinet surface" check matched the AudioEngine INTERFACE
// declaration rather than the object `createAudioEngine()` actually returns — the
// reviewer proved the equivalent battlezone check passed while a renamed method key made
// `engine.stopEngine()` throw at runtime. Now: the surface is asserted on the real object,
// the ROM seams are asserted by BEHAVIOUR (they are exported and pure), and the remaining
// source checks are anchored to declaration forms.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  createAudioEngine,
  gunStrobe,
  explosionLevel,
  approachWhine,
  engineHumParams,
} from '../../src/shell/audio'

const audioSrc = () =>
  readFileSync(fileURLToPath(new URL('../../src/shell/audio.ts', import.meta.url)), 'utf8')

describe('SH2-18 — red-baron consumes the shared synthesis skeleton (AC-8)', () => {
  it('imports the engine from @arcade/shared/synth', () => {
    expect(audioSrc(), 'red-baron must consume the shared VERB it donated').toMatch(
      /from\s+['"]@arcade\/shared\/synth['"]/,
    )
  })

  it('no longer hand-writes the engine skeleton', () => {
    const src = audioSrc()
    const skeleton = [
      { name: 'resolveContextCtor', re: /\bfunction\s+resolveContextCtor\s*\(/ },
      { name: 'noiseBuffer', re: /\bfunction\s+noiseBuffer\s*\(/ },
      { name: 'guard', re: /\bfunction\s+guard\s*\(/ },
      { name: 'live', re: /\bfunction\s+live\s*\(/ },
    ]
    const stillLocal = skeleton.filter((s) => s.re.test(src)).map((s) => s.name)
    expect(
      stillLocal,
      `still hand-written locally instead of imported from @arcade/shared/synth: ${stillLocal.join(', ')}`,
    ).toEqual([])
  })

  it('does not build its own AudioContext — the shared engine owns the gesture gate', () => {
    expect(audioSrc(), 'the shared engine owns context construction').not.toMatch(
      /new\s+(AudioContext|Ctor)\s*\(/,
    )
  })
})

describe('SH2-18 — red-baron KEEPS its full cabinet surface (runtime, not source text)', () => {
  it('createAudioEngine() returns every method the cabinet had before the extraction', () => {
    const engine = createAudioEngine()
    expect(typeof engine.resume).toBe('function')
    expect(typeof engine.play).toBe('function')
    // playTone / setGun / setApproach are Red Baron's alone — easiest to lose in a rewrite.
    expect(typeof engine.playTone).toBe('function')
    expect(typeof engine.setEngine).toBe('function')
    expect(typeof engine.setGun).toBe('function')
    expect(typeof engine.setApproach).toBe('function')
  })

  it('every method is a silent no-op before the gesture gate opens', () => {
    // Proves the methods are really WIRED to the shared engine, not merely present.
    const engine = createAudioEngine()
    expect(() => {
      engine.play('explosion')
      engine.play('crash')
      engine.playTone('TK')
      engine.setEngine(true)
      engine.setGun(true)
      engine.setGun(false)
      engine.setApproach(100)
    }).not.toThrow()
  })
})

describe('SH2-18 — red-baron KEEPS its NUMBERS (no over-extraction)', () => {
  it('still owns every ROM-verified analog seam, and they still compute', () => {
    // Asserted by BEHAVIOUR, not by grepping for the name. These are ROM facts about ONE
    // cabinet (findings §6B): no other game has an INTCNT&8 gun strobe or an EXPVAL ramp.
    expect(gunStrobe(8), 'the D2 gun bit is gated by INTCNT & 8').toBe(true)
    expect(gunStrobe(0)).toBe(false)

    // rb4-10: per-victim duration + hard cutoff (SN-016). EXPVAL still loads $F0.
    expect(explosionLevel(0, 10), 'EXPVAL is loaded with $F0').toBe(0xf0)
    expect(explosionLevel(999, 10), 'and is silent past the burst').toBe(0)

    // rb4-10 (SN-014): the whine is a PITCH ramp at CONSTANT volume — nearer ⇒ HIGHER
    // pitch (not louder); an UNKNOWN distance idles at the hum, never a garbage sweep.
    expect(approachWhine(10).frequency).toBeGreaterThan(approachWhine(1000).frequency)
    expect(approachWhine(10).gain, 'volume is flat, not distance-scaled').toBeCloseTo(
      approachWhine(1000).gain,
      6,
    )
    expect(Number.isFinite(approachWhine(Number.NaN).frequency)).toBe(true)

    // The DETUNED pair — divisors one apart, so the voices beat. That beat IS the engine.
    const hum = engineHumParams()
    expect(hum.frequencies[0]).not.toBe(hum.frequencies[1])
  })

  it('still owns its POKEY math — the shared engine must never learn what a POKEY is', () => {
    const src = audioSrc()
    // Anchored to declaration forms: a mention in a comment must not satisfy these.
    expect(src).toMatch(/\bconst\s+POKEY_CLOCK_HZ\s*=/)
    expect(src).toMatch(/\bfunction\s+audfToHz\s*\(/)
    expect(src).toMatch(/\bfunction\s+audcToGain\s*\(/)
    // And the cabinet's own voice builders stay home.
    expect(src).toMatch(/\bfunction\s+pokeyTone\s*\(/)
    expect(src).toMatch(/\bfunction\s+gunVoice\s*\(/)
    expect(src).toMatch(/\bfunction\s+explosionBurst\s*\(/)
  })
})

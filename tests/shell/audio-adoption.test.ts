// tests/shell/audio-adoption.test.ts
//
// SH2-18 — red-baron adopts @arcade/shared/synth (AC-8).
//
// Red Baron is the DONOR: its engine already carries the no-throw contract (live(),
// guard(), the ctor try/catch, the resume().catch()) that battlezone lacks, and the
// shared skeleton is lifted from it. So unlike battlezone, adoption here is a genuine
// refactor — no behaviour changes, and the existing suite (tests/shell/audio.test.ts)
// is the safety net that proves it. What this file adds is the fence:
//
//   • The VERB must leave  — the skeleton comes from @arcade/shared/synth now.
//   • The NUMBERS must stay — every ROM seam (gunStrobe / explosionLevel /
//     approachWhine / engineHumParams) and all POKEY math is Red Baron's alone and
//     must NOT be pushed up into the shared package. The shared engine has no idea
//     what a POKEY is, and must never learn.
//
// RED until Dev rewrites src/shell/audio.ts on top of the shared skeleton.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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
      { name: 'resolveContextCtor', re: /function\s+resolveContextCtor\s*\(/ },
      { name: 'noiseBuffer', re: /function\s+noiseBuffer\s*\(/ },
      { name: 'guard', re: /function\s+guard\s*\(/ },
      { name: 'live', re: /function\s+live\s*\(/ },
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

describe('SH2-18 — red-baron KEEPS its NUMBERS (no over-extraction)', () => {
  it('still owns every ROM-verified analog seam', () => {
    const src = audioSrc()
    // These are ROM facts about ONE cabinet (findings §6B). They are the definition of
    // a NUMBER: no other game has an INTCNT&8 gun strobe or an EXPVAL ramp.
    for (const seam of ['gunStrobe', 'explosionLevel', 'approachWhine', 'engineHumParams']) {
      expect(src, `${seam} is a ROM seam and must stay in red-baron`).toMatch(
        new RegExp(`export\\s+function\\s+${seam}\\s*\\(`),
      )
    }
  })

  it('still owns its POKEY math — the shared engine must never learn what a POKEY is', () => {
    const src = audioSrc()
    expect(src).toMatch(/POKEY_CLOCK_HZ/)
    expect(src).toMatch(/audfToHz/)
    expect(src).toMatch(/audcToGain/)
  })

  it('still exposes the full cabinet surface it had before the extraction', () => {
    const src = audioSrc()
    // setGun / setApproach / playTone are Red Baron's alone — easy to lose in a rewrite.
    for (const method of ['resume', 'play', 'playTone', 'setEngine', 'setGun', 'setApproach']) {
      expect(src, `AudioEngine.${method} must survive the extraction`).toMatch(
        new RegExp(`\\b${method}\\s*\\(`),
      )
    }
  })
})

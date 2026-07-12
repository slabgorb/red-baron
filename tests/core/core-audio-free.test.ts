// tests/core/core-audio-free.test.ts
//
// Story rb2-11 — RED phase (Han Solo / TEA). The story's own purity AC, encoded
// as a grep the suite runs forever: sound is IO (shell), never simulation (core).
// The deterministic flight sim emits `GameEvent` DATA (core/events.ts); the
// shell's audio engine (shell/audio.ts) consumes it. Any Web Audio symbol, or any
// import reaching from core/ into shell/, would invert that one-way boundary.
//
// GUARD SWEEP: this PASSES against the pre-GREEN tree by design (core/ has no
// audio today) — its job is to stay green while shell/audio.ts + core/events.ts
// land, and forever after. Battlezone bz1-11 shipped the identical sweep; this is
// its Red Baron twin (the two cabinets share the discrete-analog/POKEY sound model).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const coreDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'core')

// Web Audio / HTMLAudio surface — none of it may appear under core/.
const BANNED_AUDIO = [
  'AudioContext', // covers webkitAudioContext and OfflineAudioContext too
  'OscillatorNode',
  'AudioBuffer', // covers AudioBufferSourceNode
  'GainNode',
  'BiquadFilterNode',
  'createOscillator',
  'createGain',
  'new Audio',
  'HTMLAudioElement',
]

// The audio boundary is one-way: core emits events, shell listens. Any import
// reaching from core/ into shell/ would invert it.
const BANNED_SHELL_IMPORT = ["from '../shell", 'from "../shell', "from './shell", 'from "./shell']

const coreFiles = readdirSync(coreDir).filter((f) => f.endsWith('.ts'))

describe('core/ stays audio-free (rb2-11 AC — grep-checkable, swept)', () => {
  it('scans a non-empty core/ (the sweep must have teeth)', () => {
    expect(coreFiles.length).toBeGreaterThan(0)
  })

  it.each(coreFiles)('%s contains no Web Audio references', (file) => {
    const source = readFileSync(join(coreDir, file), 'utf8')
    for (const banned of BANNED_AUDIO) {
      expect(source, `${file} must not reference "${banned}"`).not.toContain(banned)
    }
  })

  it.each(coreFiles)('%s never imports from shell/', (file) => {
    const source = readFileSync(join(coreDir, file), 'utf8')
    for (const banned of BANNED_SHELL_IMPORT) {
      expect(source, `${file} must not import shell code`).not.toContain(banned)
    }
  })
})

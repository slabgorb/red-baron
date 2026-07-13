// tests/shell/audio.test.ts
//
// Story rb2-11 — RED phase (Han Solo / TEA). The shell's WebAudio engine: it
// SYNTHESISES the discrete analog board (§6B — gun, explosion, spiral, engine
// hum, enemy-approach whine) and PLAYS the POKEY reward tones (pokey.ts, §6A)
// through Web Audio. Tested against a recording fake AudioContext — no real
// audio hardware in CI (sibling AudioEngine convention from battlezone bz1-11 /
// tempest, adapted to Red Baron's inventory).
//
// The engine surface pinned here (context-story-rb2-11.md Technical Approach):
//
//   createAudioEngine(): AudioEngine
//     .resume()                     — lazily builds the ONE AudioContext;
//                                     idempotent (autoplay-policy gesture gate)
//     .play('explosion'|'crash')    — analog one-shots (noise bursts); no-op pre-resume
//     .playTone('TK'|'TP'|'BN'|'WP'|'TH') — a POKEY reward tone; no-op pre-resume
//     .setEngine(on)                — the continuous detuned engine hum ($F8/$F7 pair)
//     .setGun(firing)               — the machine-gun rat-a-tat (D2, internally
//                                     INTCNT&8-strobed); off when not firing
//     .setApproach(distance)        — the enemy-approach whine (ATGVAL, distance-driven)
//
//   // PURE seams — the ROM-authentic analog facts, exported so the curves are
//   // testable with NO context at all (battlezone's engineParams habit):
//   gunStrobe(intcnt): boolean                 — §6B D2 rat-a-tat: (intcnt & 8) !== 0
//   explosionLevel(frame): number              — §6B EXPVAL=$F0 ramps down to 0
//   approachWhine(distance): { frequency, gain } — §6B ATGVAL: nearer ⇒ more intense
//   engineHumParams(): { frequencies: [number, number]; gain } — §6B detuned $F8/$F7 pair
//
// Which numbers are ROM facts: the gun strobe (INTCNT&8) and explosion start
// ($F0) are ROM-verified (§6B); the approach-whine curve and the exact hum Hz
// are INFERRED synthesis (the analog timbre is off-CPU, §6B), so those tests pin
// SHAPE (monotonicity, detune, bounds), never a specific synthesised value.
//
// src/shell/audio.ts is absent pre-GREEN — the import failure is the RED signal.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EXPL2_FRAMES } from '../../src/core/explosion'

// --- recording fake Web Audio surface (battlezone bz1-11 harness) -----------

class FakeAudioParam {
  readonly values: number[] = []
  private v = 0
  get value(): number {
    return this.v
  }
  set value(next: number) {
    this.v = next
    this.values.push(next)
  }
  setValueAtTime(v: number): this {
    this.value = v
    return this
  }
  linearRampToValueAtTime(v: number): this {
    this.value = v
    return this
  }
  exponentialRampToValueAtTime(v: number): this {
    this.value = v
    return this
  }
  setTargetAtTime(v: number): this {
    this.value = v
    return this
  }
  cancelScheduledValues(): this {
    return this
  }
}

class FakeNode {
  connect<T>(target: T): T {
    return target
  }
  disconnect(): void {}
}

class FakeOscillator extends FakeNode {
  type = 'sine'
  readonly frequency = new FakeAudioParam()
  readonly detune = new FakeAudioParam()
  onended: (() => void) | null = null
  start(): void {}
  stop(): void {}
}

class FakeGain extends FakeNode {
  readonly gain = new FakeAudioParam()
}

class FakeBiquadFilter extends FakeNode {
  type = 'lowpass'
  readonly frequency = new FakeAudioParam()
  readonly Q = new FakeAudioParam()
  readonly gain = new FakeAudioParam()
}

class FakeBuffer {
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {}
  getChannelData(): Float32Array {
    return new Float32Array(this.length)
  }
}

class FakeBufferSource extends FakeNode {
  buffer: FakeBuffer | null = null
  loop = false
  readonly playbackRate = new FakeAudioParam()
  onended: (() => void) | null = null
  start(): void {}
  stop(): void {}
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  readonly oscillators: FakeOscillator[] = []
  readonly gains: FakeGain[] = []
  readonly sources: FakeBufferSource[] = []
  // Review round 1: filters were built but never TRACKED, so no test could
  // assert a cutoff — the crash/explosion/gun timbres were unverifiable.
  readonly filters: FakeBiquadFilter[] = []
  currentTime = 0
  sampleRate = 48_000
  state = 'running'
  readonly destination = new FakeNode()
  resumeCalls = 0
  constructor() {
    FakeAudioContext.instances.push(this)
  }
  resume(): Promise<void> {
    this.resumeCalls++
    return this.state === 'closed'
      ? Promise.reject(new Error('InvalidStateError'))
      : Promise.resolve()
  }
  close(): Promise<void> {
    this.state = 'closed'
    return Promise.resolve()
  }
  /** A closed context throws synchronously from every factory — the real
   *  behaviour that could otherwise freeze the game loop (review round 1). */
  private assertOpen(): void {
    if (this.state === 'closed') throw new Error('InvalidStateError: context is closed')
  }
  createOscillator(): FakeOscillator {
    this.assertOpen()
    const o = new FakeOscillator()
    this.oscillators.push(o)
    return o
  }
  createGain(): FakeGain {
    this.assertOpen()
    const g = new FakeGain()
    this.gains.push(g)
    return g
  }
  createBiquadFilter(): FakeBiquadFilter {
    this.assertOpen()
    const f = new FakeBiquadFilter()
    this.filters.push(f)
    return f
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    this.assertOpen()
    return new FakeBuffer(channels, length, sampleRate)
  }
  createBufferSource(): FakeBufferSource {
    this.assertOpen()
    const s = new FakeBufferSource()
    this.sources.push(s)
    return s
  }
}

/** All nodes built in the single live context, so a synth can be seen to fire. */
function nodeCount(): number {
  const c = FakeAudioContext.instances[0]
  return c.oscillators.length + c.gains.length + c.sources.length
}
function allGainValues(): number[] {
  return FakeAudioContext.instances.flatMap((c) => c.gains.flatMap((g) => g.gain.values))
}
/** Every frequency any oscillator was ever tuned to, across all contexts. */
function allFrequencyValues(): number[] {
  return FakeAudioContext.instances.flatMap((c) => c.oscillators.flatMap((o) => o.frequency.values))
}
/** Every cutoff any filter was ever set to (review round 1 — previously invisible). */
function allCutoffValues(): number[] {
  return FakeAudioContext.instances.flatMap((c) => c.filters.flatMap((f) => f.frequency.values))
}

async function loadAudio() {
  return import('../../src/shell/audio')
}

beforeEach(() => {
  vi.resetModules()
  FakeAudioContext.instances = []
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('webkitAudioContext', FakeAudioContext)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// --- the gesture gate (AC: no AudioContext before a user gesture) -----------

describe('gesture gate — no AudioContext until resume()', () => {
  it('importing the module builds NO context (autoplay policy)', async () => {
    await loadAudio()
    expect(FakeAudioContext.instances).toHaveLength(0)
  })

  it('createAudioEngine() builds NO context — construction is not a gesture', async () => {
    const m = await loadAudio()
    m.createAudioEngine()
    expect(FakeAudioContext.instances).toHaveLength(0)
  })

  it('every method is a silent no-op before resume(), and never throws', async () => {
    const m = await loadAudio()
    const engine = m.createAudioEngine()
    expect(() => {
      engine.play('explosion')
      engine.play('crash')
      engine.playTone('TK')
      engine.playTone('WP')
      engine.setEngine(true)
      engine.setGun(true)
      engine.setApproach(120)
    }).not.toThrow()
    expect(FakeAudioContext.instances).toHaveLength(0)
  })

  it('resume() builds exactly ONE context; repeat resume() is harmless', async () => {
    const m = await loadAudio()
    const engine = m.createAudioEngine()
    engine.resume()
    expect(FakeAudioContext.instances).toHaveLength(1)
    engine.resume()
    engine.resume()
    expect(FakeAudioContext.instances, 'repeat gestures must be harmless').toHaveLength(1)
    expect(FakeAudioContext.instances[0].resumeCalls, 'a suspended context is re-nudged').toBeGreaterThan(1)
  })
})

// --- silent-degrade: no Web Audio at all leaves the game running ------------

describe('silent-degrade — a browser with no Web Audio stays playable', () => {
  it('createAudioEngine + every method is a no-op, no throw, when AudioContext is absent', async () => {
    vi.stubGlobal('AudioContext', undefined)
    vi.stubGlobal('webkitAudioContext', undefined)
    const m = await loadAudio()
    const engine = m.createAudioEngine()
    expect(() => {
      engine.resume()
      engine.play('explosion')
      engine.playTone('BN')
      engine.setEngine(true)
      engine.setGun(true)
      engine.setApproach(50)
    }).not.toThrow()
    expect(FakeAudioContext.instances).toHaveLength(0)
  })
})

// --- the no-throw contract: a dead context must not kill the GAME -----------

describe('a CLOSED AudioContext degrades to silence — it must never freeze the game', () => {
  // REVIEW ROUND 1, blocking. main.ts calls updateContinuousSounds() inside
  // frame(), ABOVE the requestAnimationFrame(frame) re-schedule. A browser can
  // close the context out from under us (iOS reclaiming audio under memory
  // pressure, a long-backgrounded tab), and every createOscillator/createGain/
  // createBufferSource call then throws InvalidStateError SYNCHRONOUSLY. An
  // escaping exception would abort frame() before it re-armed the rAF — freezing
  // rendering, input, the whole game — not merely muting the sound.
  it('every method stays silent and NON-THROWING after the context closes', async () => {
    const m = await loadAudio()
    const engine = m.createAudioEngine()
    engine.resume()
    engine.setEngine(true)
    engine.setGun(true)

    // The browser closes it underneath us.
    await FakeAudioContext.instances[0].close()
    expect(FakeAudioContext.instances[0].state).toBe('closed')

    expect(() => {
      engine.play('explosion')
      engine.play('crash')
      engine.playTone('TK')
      engine.playTone('BN')
      engine.setEngine(true)
      engine.setEngine(false)
      engine.setGun(true)
      engine.setGun(false)
      engine.setApproach(80)
      engine.resume()
    }, 'a dead context must never take the frame loop down with it').not.toThrow()
  })
})

// --- the PURE analog seams (the ROM-authentic facts) ------------------------

describe('gunStrobe — the D2 rat-a-tat, INTCNT&8 (findings §6B, RBGRND.MAC:171-174)', () => {
  it('toggles every 8 NMIs — the 32 ms half-cycle', async () => {
    const { gunStrobe } = await loadAudio()
    for (let i = 0; i <= 7; i++) expect(gunStrobe(i), `intcnt ${i}`).toBe(false)
    for (let i = 8; i <= 15; i++) expect(gunStrobe(i), `intcnt ${i}`).toBe(true)
    for (let i = 16; i <= 23; i++) expect(gunStrobe(i), `intcnt ${i}`).toBe(false)
    for (let i = 24; i <= 31; i++) expect(gunStrobe(i), `intcnt ${i}`).toBe(true)
  })

  it('is exactly the (intcnt & 8) bit test', async () => {
    const { gunStrobe } = await loadAudio()
    for (const n of [0, 3, 8, 40, 137, 250]) expect(gunStrobe(n)).toBe((n & 8) !== 0)
  })
})

describe('explosionLevel — EXPVAL=$F0 ramps down (findings §6B)', () => {
  it('starts at the ROM $F0 and reaches silence by EXPL2_FRAMES', async () => {
    const { explosionLevel } = await loadAudio()
    expect(explosionLevel(0)).toBe(0xf0)
    expect(explosionLevel(EXPL2_FRAMES)).toBe(0)
  })

  it('is monotonically NON-increasing across the burst', async () => {
    const { explosionLevel } = await loadAudio()
    let prev = Number.POSITIVE_INFINITY
    for (let f = 0; f <= EXPL2_FRAMES; f++) {
      const v = explosionLevel(f)
      expect(v, `frame ${f} must not rise`).toBeLessThanOrEqual(prev)
      prev = v
    }
  })

  it('clamps at 0 past the burst — never negative', async () => {
    const { explosionLevel } = await loadAudio()
    expect(explosionLevel(EXPL2_FRAMES + 50)).toBe(0)
    expect(explosionLevel(10_000)).toBeGreaterThanOrEqual(0)
  })
})

describe('approachWhine — ATGVAL, nearer ⇒ more intense (findings §6B, inferred curve)', () => {
  it('gain RISES as the enemy closes (smaller distance is louder)', async () => {
    const { approachWhine } = await loadAudio()
    expect(approachWhine(50).gain).toBeGreaterThan(approachWhine(500).gain)
    expect(approachWhine(500).gain).toBeGreaterThan(approachWhine(2000).gain)
  })

  it('stays bounded and finite at every distance (input hygiene)', async () => {
    const { approachWhine } = await loadAudio()
    for (const d of [1, 50, 500, 5000, Number.POSITIVE_INFINITY]) {
      const p = approachWhine(d)
      expect(p.gain, `gain at ${d}`).toBeGreaterThanOrEqual(0)
      expect(p.gain, `gain at ${d}`).toBeLessThanOrEqual(1)
      expect(Number.isFinite(p.frequency), `freq at ${d}`).toBe(true)
      expect(p.frequency).toBeGreaterThan(0)
    }
  })

  it('a clear sky (infinite distance) is effectively silent', async () => {
    const { approachWhine } = await loadAudio()
    expect(approachWhine(Number.POSITIVE_INFINITY).gain).toBeCloseTo(0, 5)
  })

  it('an UNKNOWN distance (NaN) is silent, not deafening (review round 1)', async () => {
    const { approachWhine } = await loadAudio()
    // `NaN > 0` is false, so NaN fell into the same branch as 0 — "on top of you" —
    // and produced the LOUDEST possible whine. It must read as "no target".
    const p = approachWhine(Number.NaN)
    expect(p.gain).toBe(0)
    expect(Number.isFinite(p.frequency)).toBe(true)
  })
})

describe('engineHumParams — the detuned $F8/$F7 pair (findings §6B)', () => {
  it('is a PAIR of DETUNED oscillators — the two frequencies differ', async () => {
    const { engineHumParams } = await loadAudio()
    const p = engineHumParams()
    expect(p.frequencies).toHaveLength(2)
    expect(p.frequencies[0]).not.toBe(p.frequencies[1]) // detune → the beat
    expect(p.frequencies[0]).toBeGreaterThan(0)
    expect(p.frequencies[1]).toBeGreaterThan(0)
  })

  it('hums at an audible-but-modest gain', async () => {
    const { engineHumParams } = await loadAudio()
    const p = engineHumParams()
    expect(p.gain).toBeGreaterThan(0)
    expect(p.gain).toBeLessThanOrEqual(1)
  })
})

// --- the live wiring: the synth actually reaches the node graph -------------

describe('post-gesture synthesis reaches the node graph', () => {
  it('setEngine(true) wires BOTH detuned frequencies into real oscillators', async () => {
    const m = await loadAudio()
    const engine = m.createAudioEngine()
    engine.resume()
    engine.setEngine(true)
    const [a, b] = m.engineHumParams().frequencies
    expect(FakeAudioContext.instances[0].oscillators.length, 'a detuned pair').toBeGreaterThanOrEqual(2)
    // The POINT of the hum is the BEAT between the two divisors. Asserting only
    // "2 oscillators exist" would pass even if both were tuned identically, which
    // would destroy the beat — so pin the actual frequencies (review round 1).
    expect(allFrequencyValues()).toContain(a)
    expect(allFrequencyValues()).toContain(b)
    expect(a).not.toBe(b)
  })

  it('setEngine(false) drives the hum to a real 0 gain (silence out of a run)', async () => {
    const m = await loadAudio()
    const engine = m.createAudioEngine()
    engine.resume()
    engine.setEngine(true)
    // Staging: the running hum must NOT already sit at 0, or the assertion below
    // would pass vacuously against an inert setEngine(false).
    expect(allGainValues(), 'staging: nothing sets a 0 gain before the stop').not.toContain(0)
    engine.setEngine(false)
    expect(allGainValues()).toContain(0)
  })

  it('play() one-shots synthesise only AFTER the gate opens', async () => {
    const m = await loadAudio()
    const engine = m.createAudioEngine()
    engine.resume()
    const before = nodeCount()
    engine.play('explosion')
    expect(nodeCount(), 'a post-gesture blast must synthesize').toBeGreaterThan(before)
  })

  it('playTone() fires a POKEY tone at the table’s ACTUAL pitch', async () => {
    const m = await loadAudio()
    const engine = m.createAudioEngine()
    engine.resume()
    const before = FakeAudioContext.instances[0].oscillators.length
    engine.playTone('TK')
    expect(FakeAudioContext.instances[0].oscillators.length).toBeGreaterThan(before)
    // "an oscillator was created" would pass even for a 0 Hz / fixed-pitch tone.
    // TK's AUDF1 is the ROM-exact $30, so pin the pitch it must actually sound at.
    const tkHz = 63_920 / (2 * (0x30 + 1))
    expect(allFrequencyValues(), 'TK must sound at its AUDF1=$30 pitch').toContain(tkHz)
  })

  it('playTone() releases to silence — a tone never hard-stops at volume (click)', async () => {
    const m = await loadAudio()
    const engine = m.createAudioEngine()
    engine.resume()
    // BN is the RISING warble: its envelope ENDS LOUD by design, so without a
    // release ramp the oscillator would be cut off at amplitude and CLICK.
    engine.playTone('BN')
    expect(allGainValues(), 'the voice must be ramped to 0 before it stops').toContain(0)
  })

  it('setGun(true) builds the rat-a-tat STROBE at the INTCNT&8 rate', async () => {
    const m = await loadAudio()
    const engine = m.createAudioEngine()
    engine.resume()
    engine.setGun(true)
    // Deleting the strobe wiring would leave the gun a flat hiss. The ROM gate is
    // 8 NMIs on / 8 off ⇒ a 16-NMI cycle ⇒ 250/16 = 15.625 Hz.
    expect(allFrequencyValues(), 'the gun must be chopped at the ROM gate rate').toContain(15.625)
    expect(allCutoffValues(), 'the gun rattle is filtered').toContain(1800)
  })

  it('setGun is defensive: double-on and off-when-idle never throw', async () => {
    const m = await loadAudio()
    const engine = m.createAudioEngine()
    engine.resume()
    expect(() => {
      engine.setGun(true)
      engine.setGun(true)
      engine.setGun(false)
      engine.setGun(false)
    }).not.toThrow()
  })

  it('crash and explosion are DISTINCT cues, not the same burst', async () => {
    const m = await loadAudio()
    const engine = m.createAudioEngine()
    engine.resume()
    engine.play('explosion')
    engine.play('crash')
    // Previously nothing post-gesture exercised 'crash' at all, and filters were
    // untracked — so collapsing both cues into one burst would have gone unnoticed.
    const cutoffs = allCutoffValues()
    expect(cutoffs, 'the kill blast is the brighter one').toContain(900)
    expect(cutoffs, 'the pilot’s crash is darker/heavier').toContain(500)
  })

  it('setApproach applies the computed whine gain to a live node', async () => {
    const m = await loadAudio()
    const engine = m.createAudioEngine()
    engine.resume()
    // Pin the SPECIFIC value the pure curve computes — a mere "some gain > 0" would
    // pass vacuously off the master gain even if setApproach were inert.
    const expected = m.approachWhine(80).gain
    engine.setApproach(80)
    expect(allGainValues()).toContain(expected)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SH2-18 review round 2 — the free-running voices must survive a recovery
// ─────────────────────────────────────────────────────────────────────────────
//
// The shared engine now recovers from a browser-closed context (SH2-18 round 1), and its
// voice REGISTRY is cleared so `gun` rebuilds. But the engine hum and the approach whine
// are not registry voices — their oscillators free-run and their GAIN is the switch, so
// they live in local `humGain` / `whineOsc` slots built once behind an `=== null` gate.
//
// Those refs survive a recovery still pointing at nodes on the DEAD context, so without a
// rebuild signal the gate never re-fires: the gun comes back, the hum and whine never do.
// A HALF recovery is worse than none — it looks like it works. `onRebuild` closes it.

describe('SH2-18 (round 2) — hum and whine come back after a context recovery', () => {
  it('setEngine rebuilds the hum on the NEW context', async () => {
    const m = await loadAudio()
    const engine = m.createAudioEngine()
    engine.resume()
    engine.setEngine(true)

    const ctxA = FakeAudioContext.instances[0]
    expect(ctxA.oscillators.length, 'the detuned hum pair exists on the first context').toBeGreaterThan(0)

    await ctxA.close()
    engine.resume()
    expect(FakeAudioContext.instances.length).toBe(2)

    engine.setEngine(true)
    const ctxB = FakeAudioContext.instances[1]
    expect(
      ctxB.oscillators.length,
      'the hum MUST be rebuilt on the live context — otherwise the biplane flies in silence',
    ).toBeGreaterThan(0)
  })

  it('setApproach rebuilds the whine on the NEW context', async () => {
    const m = await loadAudio()
    const engine = m.createAudioEngine()
    engine.resume()
    engine.setApproach(50)

    await FakeAudioContext.instances[0].close()
    engine.resume()

    engine.setApproach(50)
    const ctxB = FakeAudioContext.instances[1]
    expect(
      ctxB.oscillators.length,
      'the approach whine MUST be rebuilt — it is the only warning an enemy is on you',
    ).toBeGreaterThan(0)
  })

  it('the gun comes back too — the whole cabinet recovers, not half of it', async () => {
    const m = await loadAudio()
    const engine = m.createAudioEngine()
    engine.resume()
    engine.setGun(true)

    await FakeAudioContext.instances[0].close()
    engine.resume()

    engine.setGun(true)
    const ctxB = FakeAudioContext.instances[1]
    expect(ctxB.sources.length, 'the rat-a-tat is rebuilt on the live context').toBeGreaterThan(0)
  })
})

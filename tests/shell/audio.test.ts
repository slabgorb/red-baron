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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

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

describe('explosionLevel — per-victim EXCNTR duration, HARD cutoff (rb4-10 / SN-016)', () => {
  // rb4-10 RE-SEAT. The rb2-11 code borrowed EXPL2_FRAMES (12, the debris window) as
  // a fixed duration and ramped $F0 smoothly to 0 for EVERY cue. The ROM is different
  // on both counts (RBARON.MAC:988-994 SOUNDS; 1177-80/3905-08/5652-55/5700-03/2975-78):
  //   • EXPVAL starts $F0 and steps DOWN by exactly $10 once per calc frame.
  //   • EXCNTR sets the duration and it is PER-VICTIM: 8 (player crash), 7 (ground
  //     object), 10 (drone / blimp / falling-plane wreck) — NOT a fixed 12.
  //   • when EXCNTR expires the nibble is HARD-ZEROED from a NON-zero floor — it does
  //     NOT fade to 0. The cabinet's blast cuts off while still at ~40% level.
  //
  // GREEN contract: `explosionLevel(frame: number, frames: number): number` — the
  // level at 96 ms calc-frame `frame` for a burst that runs `frames` frames.
  const F0 = 0xf0
  const STEP = 0x10

  it('starts at the ROM $F0 and steps down by exactly $10 per calc frame', async () => {
    const { explosionLevel } = await loadAudio()
    expect(explosionLevel(0, 8)).toBe(F0)
    expect(explosionLevel(1, 8)).toBe(F0 - STEP) // $E0
    expect(explosionLevel(2, 8)).toBe(F0 - 2 * STEP) // $D0
  })

  it('runs a PER-VICTIM number of frames — 8 / 7 / 10, not a fixed 12', async () => {
    const { explosionLevel } = await loadAudio()
    // The last active frame is `frames - 1`; the burst is silent AT `frames`.
    for (const frames of [8, 7, 10]) {
      expect(explosionLevel(frames - 1, frames), `${frames}f: last frame sounds`).toBeGreaterThan(0)
      expect(explosionLevel(frames, frames), `${frames}f: cut off after`).toBe(0)
    }
    // The three victims genuinely differ in length: a drone (10) outlasts the player
    // crash (8) which outlasts a ground object (7).
    expect(explosionLevel(9, 10)).toBeGreaterThan(0) // drone still sounding at frame 9
    expect(explosionLevel(9, 8)).toBe(0) // player crash long over by frame 9
    expect(explosionLevel(7, 7)).toBe(0) // ground object done at frame 7
  })

  it('CUTS OFF at a non-zero floor — it does NOT ramp smoothly to silence', async () => {
    const { explosionLevel } = await loadAudio()
    // The old bug: a 12-frame linear fade reached ~0 at the end. The ROM's last
    // active nibble is high ($F0 − $10·(frames−1)) and then hard-zeroes in ONE frame.
    const lastPlayer = explosionLevel(7, 8) // $F0 − $70 = $80
    expect(lastPlayer, 'cabinet blast is still loud at its last frame').toBeGreaterThanOrEqual(0x60)
    expect(explosionLevel(8, 8), 'then gone in a single frame — a hard cutoff').toBe(0)
    // The exact floor nibble ($7/$6/$8 per SN-016) is routed to Dev as a Delivery
    // Finding; this pins only the robust fact — a substantial floor, not a fade.
  })

  it('clamps to 0 past the burst and never goes negative (input hygiene)', async () => {
    const { explosionLevel } = await loadAudio()
    expect(explosionLevel(50, 8)).toBe(0)
    expect(explosionLevel(10_000, 10)).toBeGreaterThanOrEqual(0)
    expect(explosionLevel(Number.NaN, 8)).toBe(0)
  })
})

describe('approachWhine — a PITCH ramp at CONSTANT volume (rb4-10 / SN-014)', () => {
  // rb4-10 RE-SEAT. The rb2-11 whine was a SECOND voice that swelled in VOLUME
  // (gain 0→0.35) as the plane closed. The ROM (RBARON.MAC:1009-1033) is the OPPOSITE
  // axis: the whine and the engine hum are the SAME ch3/ch4 voice pair, AUDC pinned at
  // $A1 (volume 1/15) for BOTH — only the DIVISOR moves. Nearer ⇒ HIGHER pitch, at a
  // FLAT volume. The hum ($F8 → 128 Hz) is simply the whine's idle state; the whine
  // sweeps the pitch UP toward 652 Hz and cuts out below divisor $30.
  it('volume is CONSTANT across every distance — the ROM does NOT swell in gain', async () => {
    const { approachWhine } = await loadAudio()
    const gains = [50, 500, 2000, 5000].map((d) => approachWhine(d).gain)
    for (const g of gains) expect(g, 'flat volume at every distance').toBeCloseTo(gains[0], 6)
  })

  it('holds the ROM volume 1 of 15 ($A1 low nibble), not the old 0→0.35 swell', async () => {
    const { approachWhine } = await loadAudio()
    expect(approachWhine(80).gain).toBeCloseTo(1 / 15, 3)
  })

  it('nearer ⇒ HIGHER pitch (the divisor falls) — the opposite of the old louder swell', async () => {
    const { approachWhine } = await loadAudio()
    expect(approachWhine(50).frequency).toBeGreaterThan(approachWhine(500).frequency)
    expect(approachWhine(500).frequency).toBeGreaterThan(approachWhine(2000).frequency)
  })

  it('a clear sky idles at the HUM pitch (~128 Hz, $F8) — not silence', async () => {
    const { approachWhine } = await loadAudio()
    // The idle state is the engine hum, not a muted voice: divisor $F8 → 128.4 Hz.
    const idle = approachWhine(Number.POSITIVE_INFINITY)
    expect(idle.frequency).toBeCloseTo(63_920 / (2 * (0xf8 + 1)), 0)
    expect(idle.gain, 'still voiced at the hum volume, not gain-0').toBeGreaterThan(0)
  })

  it('an UNKNOWN distance (NaN) idles safely — a finite hum pitch, never a garbage sweep', async () => {
    const { approachWhine } = await loadAudio()
    const p = approachWhine(Number.NaN)
    expect(Number.isFinite(p.frequency)).toBe(true)
    expect(p.frequency).toBeGreaterThan(0)
  })
})

describe('engineHumParams — detuned $F8/$F7 PURE TONE at volume 1/15 (rb4-10 / SN-013)', () => {
  it('is a PAIR of DETUNED oscillators — the two frequencies differ (the beat)', async () => {
    const { engineHumParams } = await loadAudio()
    const p = engineHumParams()
    expect(p.frequencies).toHaveLength(2)
    expect(p.frequencies[0]).not.toBe(p.frequencies[1])
    // $F8 → 128.4 Hz, $F7 → 128.9 Hz: a ~0.5 Hz beat.
    expect(p.frequencies[0]).toBeCloseTo(63_920 / (2 * (0xf8 + 1)), 0)
    expect(p.frequencies[1]).toBeCloseTo(63_920 / (2 * (0xf7 + 1)), 0)
  })

  it('hums at the ROM volume 1 of 15 ($A1) — NOT the old 0.18 (2.7× too loud)', async () => {
    const { engineHumParams } = await loadAudio()
    // AUDC3=AUDC4=$A1 ⇒ POKEY volume 1/15 ≈ 0.0667 (RBARON.MAC:1001-1003). The old
    // 0.18 was a synthesised guess; a documented mix scalar would be a Dev deviation.
    expect(engineHumParams().gain).toBeCloseTo(1 / 15, 3)
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

describe('rb4-10 discrete-board timbre + the SPIRAL cue (SN-013 / SN-015)', () => {
  it('the engine hum is a POKEY PURE TONE (square), never a sawtooth (SN-013)', async () => {
    const m = await loadAudio()
    const engine = m.createAudioEngine()
    engine.resume()
    engine.setEngine(true)
    engine.setApproach(500) // the whine is the same voice pair — build it too
    const types = FakeAudioContext.instances[0].oscillators.map((o) => o.type)
    expect(types.length, 'the sustained hum/whine voices exist').toBeGreaterThan(0)
    // AUDC=$A1's high nibble $A = "PURE TONE" (RBSOUN.MAC:81). A sawtooth/triangle is
    // a harmonically rich waveform the ROM never asks for.
    expect(types, 'no sawtooth — $A1 is a pure tone').not.toContain('sawtooth')
    expect(types, 'no triangle — the whine is the same pure-tone pair, not a swelling voice').not.toContain(
      'triangle',
    )
    for (const t of types) expect(t, 'every sustained voice is a square/pure tone').toBe('square')
  })

  it('the SPIRAL dive whine is a distinct one-shot cue that synthesises (SN-015)', async () => {
    const m = await loadAudio()
    const engine = m.createAudioEngine()
    engine.resume()
    // 'spiral' is a member of OneShot (the `play()` exhaustiveness guard forces a case);
    // a missing case would fall through the guard's `never` default and synthesise
    // NOTHING — so this asserts the cue actually builds nodes.
    const before = nodeCount()
    engine.play('spiral')
    expect(nodeCount(), 'the spiral cue must synthesise, not silently no-op').toBeGreaterThan(before)
  })

  it('spiral is DISTINCT from the explosion and crash blasts (SN-015)', async () => {
    const m = await loadAudio()
    // The shot-down dive whine fills the ~576 ms before the wreck explodes; it must NOT
    // be the same code path as the kill/crash. The blasts are filtered NOISE bursts
    // (buffer sources, no oscillator); the spiral is a VOICED descending tone (an
    // oscillator, no noise). That structural split is the discriminator: aliasing
    // `case 'spiral'` to `case 'crash'` (the exact mutation this pins) would make the
    // spiral a buffer-source burst with zero oscillators and the crash's 500 Hz cutoff.

    // The kill + crash: pure noise bursts.
    const blasts = m.createAudioEngine()
    blasts.resume()
    const ctxBlast = FakeAudioContext.instances.at(-1)!
    blasts.play('explosion')
    blasts.play('crash')
    const burstCutoffs = ctxBlast.filters.flatMap((f) => f.frequency.values)
    expect(ctxBlast.sources.length, 'the kill/crash ARE noise bursts (buffer sources)').toBeGreaterThan(0)
    expect(ctxBlast.oscillators.length, 'a noise burst is not a voiced tone — no oscillator').toBe(0)

    // The spiral: a voiced dive whine on its OWN context.
    const dive = m.createAudioEngine()
    dive.resume()
    const ctxDive = FakeAudioContext.instances.at(-1)!
    dive.play('spiral')
    const diveCutoffs = ctxDive.filters.flatMap((f) => f.frequency.values)
    expect(ctxDive.oscillators.length, 'the spiral is a VOICED cue — it builds an oscillator').toBeGreaterThan(0)
    expect(ctxDive.sources.length, 'the spiral is a tone, not a re-used noise burst').toBe(0)

    // Its filter voice is its own — it never reuses the crash/explosion burst cutoffs.
    expect(diveCutoffs, 'the spiral has its own voiced/filtered character').not.toEqual([])
    const shared = diveCutoffs.filter((c) => burstCutoffs.includes(c))
    expect(shared, 'the spiral must not reuse the explosion/crash burst filter').toEqual([])
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

// ─────────────────────────────────────────────────────────────────────────────
// SH2-22 — hum AND whine are self-healing PERSISTENT VOICES, not hand-held nodes
//
// Red Baron holds TWO out-of-registry nodes: the detuned engine hum and the enemy-approach
// whine (three raw refs — `humGain`, `whineOsc`, `whineGain`). SH2-18 recovered them by
// nulling all three inside a `synth.onRebuild(...)` callback — and the round-1 fix that
// forgot exactly this shipped the half-recovery trap into BOTH cabinets. Losing the whine
// is the worst case: it is the only warning a plane is on you, and a HALF recovery looks
// like it works.
//
// SH2-22 makes it STRUCTURAL (design fork → Option A): hum and whine become
// `synth.persistentVoice(build)` handles. The cabinet holds no raw node and registers no
// onRebuild reset — the engine rebuilds each controller on recovery. Three refs to forget
// becomes zero. These guards fail the moment the raw-node-behind-a-null-gate pattern
// reappears; the behavioural recovery tests above are the runtime proof it works.
// ─────────────────────────────────────────────────────────────────────────────

describe('SH2-22 — hum and whine are engine-owned, not cabinet-held nodes', () => {
  const audioSrc = () =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'shell', 'audio.ts'), 'utf8')

  it('holds NO nullable WebAudio node as cabinet state — that is the footgun signature', () => {
    const src = audioSrc()
    // `let humGain: GainNode | null`, `let whineOsc: OscillatorNode | null`, ... ARE the
    // trap: raw nodes the engine cannot reset, behind `=== null` gates a recovery leaves
    // pointing at a dead context. Under Option A the engine holds them inside persistentVoice
    // and the cabinet holds only opaque handles. Anchored to the declaration form, not a
    // fuzzy substring (SH2-18 lesson: raw `.toContain` scans false-positive and go vacuous).
    const nullableNodeDecl =
      /\b(?:let|var)\s+\w+\s*:\s*(?:OscillatorNode|GainNode|AudioBufferSourceNode|BiquadFilterNode|AudioNode)\s*\|\s*null\b/g
    const offenders = src.match(nullableNodeDecl) ?? []
    expect(
      offenders,
      `nullable WebAudio nodes held as cabinet state re-open the half-recovery trap: ${offenders.join(', ')}`,
    ).toEqual([])
  })

  it('registers NO manual synth.onRebuild — the engine owns the rebuild now', () => {
    const src = audioSrc()
    // Three refs to null by hand is exactly where SH2-18 round 1 forgot one. persistentVoice
    // makes the reset the ENGINE's job; a hand-rolled onRebuild here means the cabinet is
    // still juggling raw nodes — Option B, which the story rejected.
    expect(src, 'the cabinet must not hand-roll a rebuild reset').not.toMatch(/\.onRebuild\s*\(/)
  })

  it('drives its continuous hum and whine through synth.persistentVoice', () => {
    const src = audioSrc()
    // The positive assertion: both continuous voices are registry-managed, self-healing.
    // Two of them, so require at least two persistentVoice registrations — otherwise a
    // cabinet could satisfy the negative guards by migrating one voice and deleting the other.
    const registrations = src.match(/\.persistentVoice\s*[<(]/g) ?? []
    expect(
      registrations.length,
      'both the engine hum and the approach whine must be persistentVoice handles',
    ).toBeGreaterThanOrEqual(2)
  })
})

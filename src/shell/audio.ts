// src/shell/audio.ts
//
// Shell-side WebAudio engine (story rb2-11). Red Baron's cabinet ran TWO
// independent sound subsystems (findings §6) and a faithful port needs both:
//
//   (A) The POKEY envelope-table driver — the five reward tones. Their DATA is
//       the RBSOUN.MAC port in pokey.ts; this file RENDERS them.
//   (B) The discrete analog board — machine gun, explosion, engine hum, and the
//       enemy-approach whine. The control BITS are ROM-verified (the $1808
//       CRSHSN latch, composed every 4 ms), but the analog TIMBRE lives on the
//       036… sound PCB and is NOT in the source — so, exactly as the findings
//       instruct, a port must SYNTHESISE plausible noise from the bit-level
//       control. The four pure seams below carry the ROM facts; the oscillator
//       and filter choices around them are inferred.
//
// Why not `@arcade/shared/audio`: that shared engine is a SAMPLE (.wav) buffer
// player — it cannot host oscillator synthesis. The rb2 epic guardrail is
// explicit that POKEY sound stays local. Battlezone (bz1-11), Red Baron's
// hardware twin, hand-writes the same local synthesis engine for the same reason.
//
// This is IO (shell), not simulation (core): the pure core emits `GameEvent`
// DATA and never imports this module (the core-audio-free sweep enforces it).
// Browsers forbid an AudioContext before a user gesture, so the context is built
// LAZILY inside `resume()` and every method degrades to a silent no-op until
// then. Every failure path leaves the game RUNNING, without sound.

import { EXPL2_FRAMES } from '../core/explosion'
import { MASTER_NMI_HZ, SIM_TIMESTEP_S } from '../core/timing'
import { POKEY_SOUNDS, stepEnvelope, type ToneName } from './pokey'

/** The analog board's one-shots: the blast, and the pilot's crash. */
export type OneShot = 'explosion' | 'crash'

export interface AudioEngine {
  /** Build (once) and unlock the context. Idempotent — wire it to any gesture. */
  resume(): void
  /** Fire an analog one-shot. Silent no-op before the gesture gate opens. */
  play(name: OneShot): void
  /** Fire one of the five POKEY reward tones. Silent no-op pre-gate. */
  playTone(name: ToneName): void
  /** The continuous engine hum — on through a live run, silent outside one. */
  setEngine(on: boolean): void
  /** The machine gun's rat-a-tat — runs while the guns are firing. */
  setGun(firing: boolean): void
  /** The enemy-approach whine — tracks the nearest plane's depth. */
  setApproach(distance: number): void
}

// ─── the PURE seams: the ROM-authentic analog facts ──────────────────────────

/**
 * The machine gun's rat-a-tat strobe (findings §6B, RBGRND.MAC:171-174): the
 * CRSHSN D2 gun bit is gated by `INTCNT & 8`, so it toggles every 8 NMIs — a
 * 32 ms half-cycle. THAT is the rat-a-tat. [ROM-verified]
 */
export function gunStrobe(intcnt: number): boolean {
  return (intcnt & 8) !== 0
}

/** The gun gate's real-world rate: 8 NMIs on, 8 off ⇒ a 16-NMI period. */
const GUN_STROBE_HZ = MASTER_NMI_HZ / 16

/**
 * The explosion's level ramp (findings §6B): `EXPVAL` is loaded with $F0 and
 * ramps DOWN to nothing across the wreck's `.EXPL1..2` frames. Monotonically
 * non-increasing, and clamped at 0 — it never goes negative. [ROM-verified]
 */
export function explosionLevel(frame: number): number {
  const f = frame < 0 ? 0 : frame
  if (f >= EXPL2_FRAMES) return 0
  return Math.round(0xf0 * (1 - f / EXPL2_FRAMES))
}

/** Depth at which the approach whine is at half strength — inferred tuning. */
const WHINE_HALF_DEPTH = 200

/**
 * The enemy-approach whine (findings §6B): the ROM ramps `ATGVAL` on POKEY ch3/4
 * BY DISTANCE — the closer the plane, the more it sings. The ORDERING (nearer ⇒
 * more intense) is the ROM fact; this particular curve is inferred tuning. A
 * clear sky (infinite distance) is silent.
 */
export function approachWhine(distance: number): { frequency: number; gain: number } {
  const d = distance > 0 ? distance : 0
  const nearness = 1 / (1 + d / WHINE_HALF_DEPTH) // 1 → on top of you, 0 → clear sky
  return { frequency: 400 + 600 * nearness, gain: 0.35 * nearness }
}

/** POKEY's 64 kHz audio clock, the divisor base for AUDF (findings §6A). */
const POKEY_CLOCK_HZ = 63_920

/** AUDF divisor → pitch. POKEY: f = clock / (2 × (divisor + 1)). */
function audfToHz(divisor: number): number {
  return POKEY_CLOCK_HZ / (2 * (divisor + 1))
}

/** AUDC low nibble = volume 0-15 ⇒ a 0..1 level. */
function audcToGain(audc: number): number {
  return (audc & 0x0f) / 15
}

/**
 * The engine hum (findings §6B, RBARON.MAC:1037-1040): the ROM writes DETUNED
 * oscillators — divisors $F8 and $F7 — to POKEY ch3/ch4 with `AUDC=$A1`. The
 * one-apart divisors are the point: the two voices beat against each other, and
 * that beat IS the engine. [ROM-verified divisors; the gain is inferred]
 */
export function engineHumParams(): { frequencies: readonly [number, number]; gain: number } {
  return { frequencies: [audfToHz(0xf8), audfToHz(0xf7)], gain: 0.18 }
}

// ─── the engine ──────────────────────────────────────────────────────────────

/** Safari's historical vendor-prefixed constructor, structurally identical. */
function resolveContextCtor(): (new () => AudioContext) | null {
  if (typeof AudioContext !== 'undefined') return AudioContext
  const g = globalThis as typeof globalThis & { webkitAudioContext?: new () => AudioContext }
  return g.webkitAudioContext ?? null
}

/** A running sustained voice: everything to stop when it is silenced. */
interface Voice {
  readonly stop: () => void
}

export function createAudioEngine(): AudioEngine {
  // ALL context state lives behind the gesture gate — nothing is constructed at
  // module load or at engine creation (browser autoplay policy).
  let ctx: AudioContext | null = null
  let master: GainNode | null = null

  // The persistent continuous voices, built on first use after the gate opens.
  // The hum's oscillators free-run once started; its GAIN is the on/off switch.
  let humGain: GainNode | null = null
  let gun: Voice | null = null
  let whineOsc: OscillatorNode | null = null
  let whineGain: GainNode | null = null

  /** A buffer of white noise — the raw material of every analog one-shot. */
  function noiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
    const length = Math.max(1, Math.floor(context.sampleRate * seconds))
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    return buffer
  }

  /**
   * The blast: filtered noise whose level walks DOWN the authentic EXPVAL ramp,
   * one step per calculation frame — the shape the ROM actually wrote to the
   * CRSHSN latch's D4-D7 nibble.
   */
  function explosionBurst(context: AudioContext, out: GainNode, cutoffHz: number, peak: number): void {
    const seconds = EXPL2_FRAMES * SIM_TIMESTEP_S
    const source = context.createBufferSource()
    source.buffer = noiseBuffer(context, seconds)

    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(cutoffHz, context.currentTime)

    const envelope = context.createGain()
    for (let f = 0; f <= EXPL2_FRAMES; f++) {
      const level = (explosionLevel(f) / 0xf0) * peak
      envelope.gain.setValueAtTime(level, context.currentTime + f * SIM_TIMESTEP_S)
    }

    source.connect(filter)
    filter.connect(envelope)
    envelope.connect(out)
    source.start()
    source.stop(context.currentTime + seconds)
  }

  /** Render one POKEY reward tone: its AUDF sets the pitch, its AUDC envelope
   *  walks the volume, one step per 4 ms MODSND frame. */
  function pokeyTone(context: AudioContext, out: GainNode, name: ToneName): void {
    const sound = POKEY_SOUNDS[name]
    const audf = sound.registers[(sound.channel - 1) * 2]
    const audc = sound.registers[(sound.channel - 1) * 2 + 1]
    if (audc === null || audc === undefined) return

    const frameSeconds = 1 / MASTER_NMI_HZ // MODSND steps every 4 ms
    const frames = (audc.count + 1) * audc.hold
    const seconds = Math.max(frames * frameSeconds, frameSeconds)

    const osc = context.createOscillator()
    osc.type = 'square' // POKEY's pure-tone voice
    const level = context.createGain()

    for (let f = 0; f < frames; f++) {
      const at = context.currentTime + f * frameSeconds
      if (audf !== null && audf !== undefined) {
        osc.frequency.setValueAtTime(audfToHz(stepEnvelope(audf, f)), at)
      }
      level.gain.setValueAtTime(audcToGain(stepEnvelope(audc, f)) * 0.5, at)
    }

    osc.connect(level)
    level.connect(out)
    osc.start()
    osc.stop(context.currentTime + seconds)
  }

  /** The rat-a-tat: looping noise, gated by a square wave at the INTCNT&8 rate. */
  function gunVoice(context: AudioContext, out: GainNode): Voice {
    const source = context.createBufferSource()
    source.buffer = noiseBuffer(context, 1)
    source.loop = true

    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(1800, context.currentTime)

    const level = context.createGain()
    level.gain.setValueAtTime(0.22, context.currentTime)

    // The strobe: a square LFO chopping the burst at the ROM's gate rate, so the
    // gun stutters rather than hissing continuously.
    const strobe = context.createOscillator()
    strobe.type = 'square'
    strobe.frequency.setValueAtTime(GUN_STROBE_HZ, context.currentTime)
    const depth = context.createGain()
    depth.gain.setValueAtTime(0.2, context.currentTime)
    strobe.connect(depth)
    depth.connect(level.gain)

    source.connect(filter)
    filter.connect(level)
    level.connect(out)
    source.start()
    strobe.start()

    return {
      stop: () => {
        source.stop()
        strobe.stop()
        level.disconnect()
      },
    }
  }

  return {
    resume(): void {
      if (ctx === null) {
        const Ctor = resolveContextCtor()
        if (Ctor === null) return // no Web Audio: the game runs silent
        try {
          ctx = new Ctor()
          master = ctx.createGain()
          master.gain.setValueAtTime(0.8, ctx.currentTime)
          master.connect(ctx.destination)
        } catch {
          ctx = null
          master = null
          return
        }
      }
      // Repeat gestures land here: nudge a context the browser left suspended.
      void ctx.resume()
    },

    play(name: OneShot): void {
      if (ctx === null || master === null) return
      // The crash is the darker, heavier cousin of the kill blast — the same
      // discrete generator, opened up.
      if (name === 'crash') explosionBurst(ctx, master, 500, 1)
      else explosionBurst(ctx, master, 900, 0.9)
    },

    playTone(name: ToneName): void {
      if (ctx === null || master === null) return
      pokeyTone(ctx, master, name)
    },

    setEngine(on: boolean): void {
      if (ctx === null || master === null) return
      const context = ctx
      const out = master
      const p = engineHumParams()
      if (humGain === null) {
        const gain = context.createGain()
        gain.connect(out)
        // The DETUNED pair — divisors one apart, so the voices beat (§6B).
        for (const hz of p.frequencies) {
          const osc = context.createOscillator()
          osc.type = 'sawtooth'
          osc.frequency.setValueAtTime(hz, context.currentTime)
          osc.connect(gain)
          osc.start()
        }
        humGain = gain
      }
      // The oscillators free-run; the gain is the real on/off (cheaper than
      // tearing the voice down, and a later `true` revives it instantly).
      humGain.gain.setValueAtTime(on ? p.gain : 0, context.currentTime)
    },

    setGun(firing: boolean): void {
      if (ctx === null || master === null) return
      if (firing) {
        if (gun !== null) return // already rattling — a repeat start is a no-op
        gun = gunVoice(ctx, master)
        return
      }
      if (gun === null) return // never started — harmless
      gun.stop()
      gun = null
    },

    setApproach(distance: number): void {
      if (ctx === null || master === null) return
      const p = approachWhine(distance)
      if (whineOsc === null || whineGain === null) {
        whineGain = ctx.createGain()
        whineGain.connect(master)
        whineOsc = ctx.createOscillator()
        whineOsc.type = 'triangle'
        whineOsc.connect(whineGain)
        whineOsc.start()
      }
      whineOsc.frequency.setValueAtTime(p.frequency, ctx.currentTime)
      whineGain.gain.setValueAtTime(p.gain, ctx.currentTime)
    },
  }
}

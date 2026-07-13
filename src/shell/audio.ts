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
//       control. The pure seams below carry the ROM facts; every oscillator,
//       filter and gain choice around them is INFERRED tuning, tagged as such.
//
// Why not `@arcade/shared/audio`: that shared engine is a SAMPLE (.wav) buffer
// player — it cannot host oscillator synthesis. The rb2 epic guardrail is
// explicit that POKEY sound stays local. Battlezone (bz1-11), Red Baron's
// hardware twin, hand-writes the same local synthesis engine for the same reason.
//
// SH2-18 — THE SKELETON MOVED OUT, THE NUMBERS STAYED. The engine substrate (the
// lazy gesture gate, the vendor-prefix fallback, the white-noise buffer, voice
// bookkeeping, and the no-throw contract below) now comes from
// `@arcade/shared/synth`. Red Baron is the DONOR: that skeleton is this file's,
// lifted after the rb2-11 review round, and battlezone — which never had that
// round, and never had the contract — adopts it from here. Everything that makes
// this cabinet ITSELF stays put: every ROM seam (§6A/§6B), all POKEY math, every
// inferred tuning constant. The shared engine does not know what a POKEY is, and
// must never learn.
//
// This is IO (shell), not simulation (core): the pure core emits `GameEvent`
// DATA and never imports this module (the core-audio-free sweep enforces it).
//
// THE NO-THROW CONTRACT (load-bearing — review round 1; now enforced by the shared
// skeleton's `withAudio`). Browsers forbid an AudioContext before a user gesture, so
// the context is built LAZILY inside `resume()`. But the gate is not enough on its
// own: a browser may CLOSE the context out from under us (iOS reclaiming audio under
// memory pressure, a long-backgrounded tab), and every `createOscillator`/`createGain`/
// `createBufferSource` call then throws `InvalidStateError` SYNCHRONOUSLY. These
// methods are called from `main.ts`'s `frame()` — ABOVE the
// `requestAnimationFrame(frame)` re-schedule — so an escaping exception would not
// merely mute the game, it would freeze the render loop, the input, everything.
// `withAudio()` therefore both (a) refuses a closed context and (b) swallows anything
// the Web Audio layer throws. Sound may die; the game never does.

import { createSynthEngine, noiseBuffer, type SynthTarget, type Voice } from '@arcade/shared/synth'
import { EXPL2_FRAMES } from '../core/explosion'
import { MASTER_NMI_HZ, SIM_TIMESTEP_S } from '../core/timing'
import { POKEY_SOUNDS, stepEnvelope, type EnvelopeStep, type ToneName } from './pokey'

/** The analog board's one-shots: the kill blast, and the pilot's crash. */
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
 *
 * Exported as the canonical statement of the ROM fact, and it is what
 * `GUN_STROBE_HZ` below is DERIVED from — the synthesis reads the rate, not the
 * per-NMI bit, because a WebAudio LFO gates the noise continuously rather than
 * being polled once per frame.
 */
export function gunStrobe(intcnt: number): boolean {
  return (intcnt & 8) !== 0
}

/**
 * The gun gate's real-world rate, derived from `gunStrobe`: the bit is set for 8
 * NMIs and clear for 8, so one full on/off cycle spans 16 NMIs.
 * 250 Hz / 16 = 15.625 Hz. [derived from the ROM fact above]
 */
const GUN_STROBE_NMIS_PER_CYCLE = 16
const GUN_STROBE_HZ = MASTER_NMI_HZ / GUN_STROBE_NMIS_PER_CYCLE

/**
 * The explosion's level ramp (findings §6B): `EXPVAL` is loaded with $F0 and ramps
 * DOWN to nothing across the wreck's `.EXPL2` (exploding) frames — the 12-frame
 * debris window `core/explosion.ts` already models. Monotonically non-increasing,
 * and clamped at 0. [ROM-verified]
 */
export function explosionLevel(frame: number): number {
  if (!Number.isFinite(frame)) return 0
  const f = frame < 0 ? 0 : frame
  if (f >= EXPL2_FRAMES) return 0
  return Math.round(0xf0 * (1 - f / EXPL2_FRAMES))
}

/** Depth at which the approach whine is at half strength. [inferred tuning] */
const WHINE_HALF_DEPTH = 200

/**
 * The enemy-approach whine (findings §6B): the ROM ramps `ATGVAL` on POKEY ch3/4
 * BY DISTANCE — the closer the plane, the more it sings. The ORDERING (nearer ⇒
 * more intense) is the ROM fact; the curve itself is [inferred tuning]. A clear
 * sky (infinite distance) is silent — and so is an UNKNOWN one: a non-finite
 * distance must read as "no target", never as "on top of you" (review round 1 —
 * `NaN > 0` is false, which would otherwise have produced the LOUDEST whine).
 */
export function approachWhine(distance: number): { frequency: number; gain: number } {
  if (Number.isNaN(distance)) return { frequency: 400, gain: 0 }
  const d = distance > 0 ? distance : 0
  const nearness = 1 / (1 + d / WHINE_HALF_DEPTH) // 1 → on top of you, 0 → clear sky
  return { frequency: 400 + 600 * nearness, gain: 0.35 * nearness }
}

/**
 * POKEY's audio clock. §6A pins the SETUP (`AUDCTL=0` ⇒ four independent channels
 * clocked at "64 kHz"); it does NOT print an exact figure. 63,920 Hz is the real
 * chip's 1.79 MHz ÷ 28 — the hardware value behind the spec's rounded "64 kHz".
 * [hardware fact, NOT transcribed from findings §6A — see review round 1]
 */
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
 * that beat IS the engine. [ROM-verified divisors; the gain is inferred tuning]
 */
export function engineHumParams(): { frequencies: readonly [number, number]; gain: number } {
  return { frequencies: [audfToHz(0xf8), audfToHz(0xf7)], gain: 0.18 }
}

// ─── inferred synthesis tuning (none of these is a ROM fact) ─────────────────

/** Master mix headroom, so overlapping cues never clip. [inferred] */
const MASTER_GAIN = 0.8
/** The kill blast: a bright-ish noise burst. [inferred] */
const EXPLOSION_CUTOFF_HZ = 900
const EXPLOSION_PEAK = 0.9
/** The pilot's crash: darker and heavier than a kill. [inferred] */
const CRASH_CUTOFF_HZ = 500
const CRASH_PEAK = 1
/** The gun: a dull rattle, chopped by the strobe. [inferred] */
const GUN_CUTOFF_HZ = 1800
const GUN_LEVEL = 0.2
const GUN_STROBE_DEPTH = 0.2
/** POKEY tones sit under the analog board in the mix. [inferred] */
const TONE_LEVEL = 0.5
/** Release ramp applied to a tone that ends at a non-zero level, so it fades out
 *  instead of being cut off — a hard stop at amplitude CLICKS. [inferred] */
const TONE_RELEASE_S = 0.02

// ─── the engine ──────────────────────────────────────────────────────────────

// ─── red-baron's NUMBERS: the instruments, not the engine ────────────────────

/**
 * The blast: filtered noise whose level walks DOWN the authentic EXPVAL ramp,
 * one step per calculation frame — the shape the ROM actually wrote to the
 * CRSHSN latch's D4-D7 nibble.
 *
 * The CHAIN (noise → lowpass → gain → master) is common with battlezone's burst,
 * but the ENVELOPE is not: this one walks the ROM's level table step by step,
 * where battlezone's simply decays exponentially. That difference is exactly why
 * the burst stays local and only `noiseBuffer` is shared.
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

/**
 * Render one POKEY reward tone: its AUDF sets the pitch, its AUDC envelope walks
 * the volume, one step per 4 ms MODSND frame.
 *
 * A tone whose envelope ENDS LOUD (BN's rising warble, by design) would CLICK if
 * the oscillator were simply stopped at amplitude, so the voice is always given a
 * short release ramp to zero before it stops (review round 1).
 */
function pokeyTone(context: AudioContext, out: GainNode, name: ToneName): void {
  const sound = POKEY_SOUNDS[name]
  const audf = sound.registers[(sound.channel - 1) * 2]
  const audc = sound.registers[(sound.channel - 1) * 2 + 1]
  // `table()` always fills a sound's own AUDC; this keeps the compiler happy and
  // would degrade to silence rather than throw if a future table were malformed.
  if (audc === null) return

  const frameSeconds = 1 / MASTER_NMI_HZ // MODSND steps every 4 ms
  const frames = Math.max((audc.steps + 1) * audc.hold, 1)
  const body = frames * frameSeconds

  const osc = context.createOscillator()
  osc.type = 'square' // POKEY's pure-tone voice
  const level = context.createGain()

  for (let f = 0; f < frames; f++) {
    const at = context.currentTime + f * frameSeconds
    if (audf !== null) osc.frequency.setValueAtTime(audfToHz(stepEnvelope(audf, f)), at)
    level.gain.setValueAtTime(audcToGain(stepEnvelope(audc, f)) * TONE_LEVEL, at)
  }
  // The release: ramp whatever level the envelope ended on down to silence.
  level.gain.linearRampToValueAtTime(0, context.currentTime + body + TONE_RELEASE_S)

  osc.connect(level)
  level.connect(out)
  osc.start()
  osc.stop(context.currentTime + body + TONE_RELEASE_S)
}

/** The rat-a-tat: looping noise, gated by a square wave at the INTCNT&8 rate. */
function gunVoice({ context, out }: SynthTarget): Voice {
  const source = context.createBufferSource()
  source.buffer = noiseBuffer(context, 1)
  source.loop = true

  const filter = context.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(GUN_CUTOFF_HZ, context.currentTime)

  const level = context.createGain()
  level.gain.setValueAtTime(GUN_LEVEL, context.currentTime)

  // The strobe: a square LFO chopping the burst at the ROM's gate rate, so the
  // gun STUTTERS rather than hissing. Depth == level, so the trough lands at 0 —
  // a real gate, not a wobble.
  const strobe = context.createOscillator()
  strobe.type = 'square'
  strobe.frequency.setValueAtTime(GUN_STROBE_HZ, context.currentTime)
  const depth = context.createGain()
  depth.gain.setValueAtTime(GUN_STROBE_DEPTH, context.currentTime)
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
      depth.disconnect()
      filter.disconnect()
    },
  }
}

// ─── the cabinet, wired onto the shared skeleton ─────────────────────────────

/** The one sustained voice held in the shared registry. The hum and whine free-run
 *  (their GAIN is the on/off switch), so they stay as local nodes below. */
type SustainedVoice = 'gun'

export function createAudioEngine(): AudioEngine {
  // The skeleton owns the context, the master bus and the sustained-voice registry.
  const synth = createSynthEngine<SustainedVoice>({ masterGain: MASTER_GAIN })

  // The persistent continuous voices, built on first use after the gate opens.
  // The hum's oscillators free-run once started; its GAIN is the on/off switch.
  let humGain: GainNode | null = null
  let whineOsc: OscillatorNode | null = null
  let whineGain: GainNode | null = null

  return {
    resume(): void {
      synth.resume()
    },

    play(name: OneShot): void {
      synth.withAudio(({ context, out }) => {
        switch (name) {
          case 'explosion':
            explosionBurst(context, out, EXPLOSION_CUTOFF_HZ, EXPLOSION_PEAK)
            break
          case 'crash':
            explosionBurst(context, out, CRASH_CUTOFF_HZ, CRASH_PEAK)
            break
          default: {
            // Exhaustiveness guard: §6B also lists a D1 spiral/dive one-shot that
            // this story does not implement. When OneShot grows, this must fail to
            // COMPILE rather than silently render the new cue as an explosion.
            const _exhaustive: never = name
            void _exhaustive
            break
          }
        }
      })
    },

    playTone(name: ToneName): void {
      synth.withAudio(({ context, out }) => pokeyTone(context, out, name))
    },

    setEngine(on: boolean): void {
      synth.withAudio(({ context, out }) => {
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
      })
    },

    setGun(firing: boolean): void {
      // The skeleton's registry makes both halves idempotent: a repeat start on a
      // running gun builds nothing, and a stop on a silent one is harmless.
      if (firing) {
        synth.startVoice('gun', gunVoice)
        return
      }
      synth.stopVoice('gun')
    },

    setApproach(distance: number): void {
      synth.withAudio(({ context, out }) => {
        const p = approachWhine(distance)
        if (whineOsc === null || whineGain === null) {
          const gain = context.createGain()
          gain.connect(out)
          const osc = context.createOscillator()
          osc.type = 'triangle'
          osc.connect(gain)
          osc.start()
          whineGain = gain
          whineOsc = osc
        }
        whineOsc.frequency.setValueAtTime(p.frequency, context.currentTime)
        whineGain.gain.setValueAtTime(p.gain, context.currentTime)
      })
    },
  }
}

/** Re-exported so tests and future callers can reason about a tone's envelope. */
export type { EnvelopeStep }

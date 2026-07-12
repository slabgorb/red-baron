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
// This is IO (shell), not simulation (core): the pure core emits `GameEvent`
// DATA and never imports this module (the core-audio-free sweep enforces it).
//
// THE NO-THROW CONTRACT (load-bearing — review round 1). Browsers forbid an
// AudioContext before a user gesture, so the context is built LAZILY inside
// `resume()`. But the gate is not enough on its own: a browser may CLOSE the
// context out from under us (iOS reclaiming audio under memory pressure, a
// long-backgrounded tab), and every `createOscillator`/`createGain`/
// `createBufferSource` call then throws `InvalidStateError` SYNCHRONOUSLY. These
// methods are called from `main.ts`'s `frame()` — ABOVE the
// `requestAnimationFrame(frame)` re-schedule — so an escaping exception would not
// merely mute the game, it would freeze the render loop, the input, everything.
// Therefore every public method both (a) refuses a closed context and (b) runs
// inside `guard()`, which swallows anything the Web Audio layer throws. Sound may
// die; the game never does.

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

  /**
   * The live context, or null when there is nothing to play into. A CLOSED
   * context is treated as absent: its factory methods throw synchronously
   * (review round 1).
   */
  function live(): { context: AudioContext; out: GainNode } | null {
    if (ctx === null || master === null) return null
    if (ctx.state === 'closed') return null
    return { context: ctx, out: master }
  }

  /**
   * Run a Web Audio side effect, swallowing anything it throws. The last line of
   * the no-throw contract: these run inside main.ts's frame loop, and an escaping
   * exception would freeze the game, not just the sound (see the header).
   */
  function guard(effect: () => void): void {
    try {
      effect()
    } catch {
      /* a dead sound must never take the frame loop down with it */
    }
  }

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
  function explosionBurst(
    context: AudioContext,
    out: GainNode,
    cutoffHz: number,
    peak: number,
  ): void {
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
  function gunVoice(context: AudioContext, out: GainNode): Voice {
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

  return {
    resume(): void {
      if (ctx === null) {
        const Ctor = resolveContextCtor()
        if (Ctor === null) return // no Web Audio: the game runs silent
        let building: AudioContext | null = null
        try {
          building = new Ctor()
          const gain = building.createGain()
          gain.gain.setValueAtTime(MASTER_GAIN, building.currentTime)
          gain.connect(building.destination)
          ctx = building
          master = gain
        } catch {
          // Close the half-built context rather than orphaning it: resume() is wired
          // to EVERY gesture, so a persistent fault would otherwise leak a live
          // AudioContext per keystroke until the browser's cap rejects new ones.
          if (building !== null) {
            try {
              void building.close()
            } catch {
              /* nothing left to do */
            }
          }
          ctx = null
          master = null
          return
        }
      }
      // Repeat gestures land here: nudge a context the browser left suspended.
      // resume() REJECTS on a closed context — swallow it, don't let it surface as
      // an unhandled rejection.
      void ctx.resume().catch(() => {
        /* a closed context simply stays silent */
      })
    },

    play(name: OneShot): void {
      const l = live()
      if (l === null) return
      guard(() => {
        switch (name) {
          case 'explosion':
            explosionBurst(l.context, l.out, EXPLOSION_CUTOFF_HZ, EXPLOSION_PEAK)
            break
          case 'crash':
            explosionBurst(l.context, l.out, CRASH_CUTOFF_HZ, CRASH_PEAK)
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
      const l = live()
      if (l === null) return
      guard(() => pokeyTone(l.context, l.out, name))
    },

    setEngine(on: boolean): void {
      const l = live()
      if (l === null) return
      guard(() => {
        const p = engineHumParams()
        if (humGain === null) {
          const gain = l.context.createGain()
          gain.connect(l.out)
          // The DETUNED pair — divisors one apart, so the voices beat (§6B).
          for (const hz of p.frequencies) {
            const osc = l.context.createOscillator()
            osc.type = 'sawtooth'
            osc.frequency.setValueAtTime(hz, l.context.currentTime)
            osc.connect(gain)
            osc.start()
          }
          humGain = gain
        }
        // The oscillators free-run; the gain is the real on/off (cheaper than
        // tearing the voice down, and a later `true` revives it instantly).
        humGain.gain.setValueAtTime(on ? p.gain : 0, l.context.currentTime)
      })
    },

    setGun(firing: boolean): void {
      const l = live()
      if (l === null) return
      guard(() => {
        if (firing) {
          if (gun !== null) return // already rattling — a repeat start is a no-op
          gun = gunVoice(l.context, l.out)
          return
        }
        if (gun === null) return // never started — harmless
        gun.stop()
        gun = null
      })
    },

    setApproach(distance: number): void {
      const l = live()
      if (l === null) return
      guard(() => {
        const p = approachWhine(distance)
        if (whineOsc === null || whineGain === null) {
          const gain = l.context.createGain()
          gain.connect(l.out)
          const osc = l.context.createOscillator()
          osc.type = 'triangle'
          osc.connect(gain)
          osc.start()
          whineGain = gain
          whineOsc = osc
        }
        whineOsc.frequency.setValueAtTime(p.frequency, l.context.currentTime)
        whineGain.gain.setValueAtTime(p.gain, l.context.currentTime)
      })
    },
  }
}

/** Re-exported so tests and future callers can reason about a tone's envelope. */
export type { EnvelopeStep }

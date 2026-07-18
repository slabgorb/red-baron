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
// hardware twin, hit the same wall for the same reason — which is why SH2-18
// gave the two of them a shared SYNTHESIS engine (`/synth`) instead, a sibling
// of `/audio` rather than a replacement for it. See below.
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
import { MASTER_NMI_HZ, SIM_TIMESTEP_S } from '../core/timing'
import { P_INDP } from '../core/returning-ace'
import { POKEY_SOUNDS, stepChain, envelopeFrames, type EnvelopeStep, type ToneName } from './pokey'

/** The analog board's one-shots: the kill blast, the pilot's crash, and the
 *  shot-down plane's SPIRAL dive whine (rb4-10 / SN-015). */
export type OneShot = 'explosion' | 'crash' | 'spiral'

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
 * The explosion's level ramp (findings §6B / SN-016): EXPVAL is loaded with $F0 and
 * SOUNDS steps it DOWN by exactly $10 once per 96 ms calc frame (RBARON.MAC:988-994).
 * EXCNTR sets the duration and it is PER-VICTIM — 8 (player crash), 7 (ground object),
 * 10 (drone / blimp / falling-plane wreck) — NOT a fixed 12. When EXCNTR expires the
 * nibble is HARD-ZEROED from a non-zero floor: the cabinet's blast CUTS OFF, it does
 * not fade to silence. [ROM-verified; the exact floor nibble is routed to a Delivery Finding]
 */
export function explosionLevel(frame: number, frames: number): number {
  if (!Number.isFinite(frame)) return 0
  const f = frame < 0 ? 0 : frame
  if (f >= frames) return 0
  const level = 0xf0 - 0x10 * f
  return level < 0 ? 0 : level
}

/** Per-victim explosion durations (EXCNTR, RBARON.MAC). The onset timing — and which
 *  cue picks which victim — is a Delivery Finding (a core-sim change). */
const EXPLOSION_FRAMES = 10 // drone / blimp / falling plane wreck
const CRASH_FRAMES = 8 // the pilot's own crash
const SPIRAL_FRAMES = 6 // .EXPL1 — the ~576 ms dive whine before the wreck explodes

/**
 * Depth at which the approach whine is at half strength. [inferred tuning — but denominated
 * in the depth axis, not typed as a number.]
 *
 * rb4-1 REWORK 2. This was a bare `200`, calibrated against the 1080-deep world we misread.
 * The plane's floor is P.MNDP = 320 — so the half-strength point sat BELOW the closest the
 * plane can ever fly, and the whole design curve lived in a region the game cannot reach. The
 * whine could never exceed 38% of full: it was quietest exactly where it was supposed to sing.
 *
 * A quarter of the spawn depth (1056) is the same cutoff enemy.ts uses for its DISCHK 'near'
 * band — so the whine now crosses half strength precisely as the plane closes to 'near', and
 * rises from there to 77% at the floor. Tied to the axis, it cannot drift from it again.
 */
const WHINE_HALF_DEPTH = P_INDP / 4 // 1056

/**
 * The enemy-approach whine (findings §6B / SN-014). The whine and the engine hum are
 * the SAME POKEY ch3/ch4 voice pair — AUDC pinned at $A1 (volume 1/15) for BOTH; only
 * the DIVISOR moves (RBARON.MAC:1009-1033). Nearer ⇒ HIGHER pitch, at a FLAT volume:
 * the divisor sweeps from the hum's idle $F8 (128 Hz) down toward $30 (652 Hz, where
 * the ROM cuts it out). The hum is simply the whine's idle state. The distance→pitch
 * CURVE is [inferred tuning]; the axis, the endpoints and the constant volume are ROM.
 * A non-finite distance reads as "no target" — the idle hum pitch, never a garbage sweep.
 */
export function approachWhine(distance: number): { frequency: number; gain: number } {
  const gain = audcToGain(0xa1) // AUDC=$A1 low nibble → POKEY volume 1/15, constant
  const idleDivisor = 0xf8 // the hum's divisor (128 Hz) — the whine's idle state
  const topDivisor = 0x30 // the whine's top pitch (~652 Hz); it cuts out below this
  if (Number.isNaN(distance)) return { frequency: audfToHz(idleDivisor), gain }
  const d = distance > 0 ? distance : 0
  const nearness = 1 / (1 + d / WHINE_HALF_DEPTH) // 1 → on top of you, 0 → clear sky
  const divisor = idleDivisor - (idleDivisor - topDivisor) * nearness
  return { frequency: audfToHz(divisor), gain }
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
 * The engine hum (findings §6B / SN-013, RBARON.MAC:1001-1003, 1039-1042): the ROM
 * writes DETUNED oscillators — divisors $F8 and $F7 — to POKEY ch3/ch4 with AUDC=$A1.
 * The one-apart divisors are the point: the two voices beat against each other, and
 * that beat IS the engine. $A1 = high nibble $A ("PURE TONE") + low nibble 1 (volume
 * 1/15). [ROM-verified — waveform AND volume; a documented mix scalar would be a Dev deviation]
 */
export function engineHumParams(): { frequencies: readonly [number, number]; gain: number } {
  return { frequencies: [audfToHz(0xf8), audfToHz(0xf7)], gain: audcToGain(0xa1) }
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
/** The spiral dive whine: a mid-level descending tone. [inferred — off-CPU timbre] */
const SPIRAL_PEAK = 0.5
/** The gun: a dull rattle, chopped by the strobe. [inferred] */
const GUN_CUTOFF_HZ = 1800
const GUN_LEVEL = 0.2
const GUN_STROBE_DEPTH = 0.2
/** POKEY tones sit under the analog board in the mix. [inferred] */
const TONE_LEVEL = 0.5
/** Release ramp applied to a tone that ends at a non-zero level, so it fades out
 *  instead of being cut off — a hard stop at amplitude CLICKS. [inferred] */
const TONE_RELEASE_S = 0.02

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
function explosionBurst(
  context: AudioContext,
  out: GainNode,
  cutoffHz: number,
  peak: number,
  frames: number,
): void {
  const seconds = frames * SIM_TIMESTEP_S
  const source = context.createBufferSource()
  source.buffer = noiseBuffer(context, seconds)

  const filter = context.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(cutoffHz, context.currentTime)

  const envelope = context.createGain()
  for (let f = 0; f <= frames; f++) {
    const level = (explosionLevel(f, frames) / 0xf0) * peak
    envelope.gain.setValueAtTime(level, context.currentTime + f * SIM_TIMESTEP_S)
  }

  source.connect(filter)
  filter.connect(envelope)
  envelope.connect(out)
  source.start()
  source.stop(context.currentTime + seconds)
}

/**
 * The SPIRAL dive whine (findings §6B / SN-015, CRSHSN D1): the shot-down plane's
 * fall — the cue that fills the ~576 ms before the wreck explodes. Its TIMBRE is
 * off-CPU (the discrete PCB) and unauditable, so this is [inferred tuning]: a
 * descending filtered tone. Its TRIGGER and 576 ms gate are a core-sim change,
 * routed to a Delivery Finding. Distinct from the noise-burst kill/crash.
 */
function spiralWhine(context: AudioContext, out: GainNode): void {
  const seconds = SPIRAL_FRAMES * SIM_TIMESTEP_S
  const osc = context.createOscillator()
  osc.type = 'sawtooth' // discrete-board whine — NOT a POKEY pure tone, so unconstrained
  osc.frequency.setValueAtTime(900, context.currentTime)
  osc.frequency.linearRampToValueAtTime(200, context.currentTime + seconds)

  const filter = context.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(1200, context.currentTime)

  const level = context.createGain()
  level.gain.setValueAtTime(SPIRAL_PEAK, context.currentTime)
  level.gain.linearRampToValueAtTime(0, context.currentTime + seconds)

  osc.connect(filter)
  filter.connect(level)
  level.connect(out)
  osc.start()
  osc.stop(context.currentTime + seconds)
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
  const frames = Math.max(envelopeFrames(audc), 1) // the whole chain's duration
  const body = frames * frameSeconds

  const osc = context.createOscillator()
  osc.type = 'square' // POKEY's pure-tone voice
  const level = context.createGain()

  for (let f = 0; f < frames; f++) {
    const at = context.currentTime + f * frameSeconds
    if (audf !== null) osc.frequency.setValueAtTime(audfToHz(stepChain(audf, f)), at)
    level.gain.setValueAtTime(audcToGain(stepChain(audc, f)) * TONE_LEVEL, at)
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

  // The two continuous voices — the engine hum and the enemy-approach whine — are
  // persistent, engine-owned voices (SH2-22). Their oscillators free-run once started; the
  // GAIN is the on/off switch. Held as persistentVoice HANDLES, never raw nodes: when the
  // browser closes the context and the engine builds a replacement, the engine rebuilds each
  // controller automatically. There are no `humGain`/`whineOsc` refs to survive a recovery
  // still pointing at the DEAD context, and nothing to reset by hand — so the half-recovery
  // trap (the gun comes back while the hum and the plane-warning whine stay silent — review
  // round 2) is structurally unreachable now. Losing the whine mattered most: it is the only
  // warning a plane is on you.
  const hum = synth.persistentVoice(({ context, out }) => {
    const gain = context.createGain()
    gain.connect(out)
    // The DETUNED pair — divisors one apart, so the voices beat (§6B). AUDC=$A1 is
    // a POKEY PURE TONE (SN-013): a square wave, not the old sawtooth.
    for (const hz of engineHumParams().frequencies) {
      const osc = context.createOscillator()
      osc.type = 'square'
      osc.frequency.setValueAtTime(hz, context.currentTime)
      osc.connect(gain)
      osc.start()
    }
    return { gain, context }
  })

  const whine = synth.persistentVoice(({ context, out }) => {
    const gain = context.createGain()
    gain.connect(out)
    const osc = context.createOscillator()
    // The whine is the hum's own pure-tone voice pair, pitch-swept (SN-014): square.
    osc.type = 'square'
    osc.connect(gain)
    osc.start()
    return { osc, gain, context }
  })

  return {
    resume(): void {
      synth.resume()
    },

    play(name: OneShot): void {
      synth.withAudio(({ context, out }) => {
        switch (name) {
          case 'explosion':
            explosionBurst(context, out, EXPLOSION_CUTOFF_HZ, EXPLOSION_PEAK, EXPLOSION_FRAMES)
            break
          case 'crash':
            explosionBurst(context, out, CRASH_CUTOFF_HZ, CRASH_PEAK, CRASH_FRAMES)
            break
          case 'spiral':
            spiralWhine(context, out)
            break
          default: {
            // Exhaustiveness guard: a new OneShot must fail to COMPILE here rather
            // than silently render as an explosion.
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
      hum.control(({ gain, context }) => {
        // The oscillators free-run (built once by the persistentVoice); the gain is the
        // real on/off (cheaper than tearing the voice down, and a later `true` revives it
        // instantly).
        gain.gain.setValueAtTime(on ? engineHumParams().gain : 0, context.currentTime)
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
      whine.control(({ osc, gain, context }) => {
        const p = approachWhine(distance)
        osc.frequency.setValueAtTime(p.frequency, context.currentTime)
        gain.gain.setValueAtTime(p.gain, context.currentTime)
      })
    },
  }
}

/** Re-exported so tests and future callers can reason about a tone's envelope. */
export type { EnvelopeStep }

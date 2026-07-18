// src/shell/audio-dispatch.ts
//
// The shell's event→sound wiring as PURE, importable functions (story rb2-11) —
// battlezone bz1-11 / tempest's audio-dispatch extraction, deliberately NOT an
// inline switch inside main.ts, precisely so the map is unit-testable against a
// recording fake without booting a canvas. No module state, no DOM: the only
// effect is calling the injected audio surface, once per event, in core order.
//
// Two channels, mirroring the cabinet's hardware split (findings §6):
//  - ONE-SHOT cues ride the `GameEvent` stream (`playEventSounds`) — the analog
//    blast and crash, plus the POKEY reward tones (score / bonus / announce /
//    the 300-point jingle).
//  - CONTINUOUS sounds are re-read from live state every frame
//    (`updateContinuousSounds`) — the engine hum, the machine gun's rat-a-tat,
//    and the enemy-approach whine. They have no trigger moment to ride.

import type { GameEvent } from '../core/events'
import { DRONE_SCORE } from '../core/scoring'
import type { AudioEngine } from './audio'

// Just the slice of the engine the dispatch needs — decoupled from resume(), so
// tests can pass a recording fake.
type SoundSurface = Pick<
  AudioEngine,
  'play' | 'playTone' | 'setEngine' | 'setGun' | 'setApproach'
>

/** The live-state snapshot the continuous sounds are driven from. */
export interface WorldSound {
  /** In a live run — not paused, not stopped. Outside one, everything falls silent. */
  readonly playing: boolean
  /** PLAYER trigger held and the guns not locked out (GUN.ST) — the rat-a-tat runs. */
  readonly gunFiring: boolean
  /** An ENEMY shell was fired this frame (rb4-10 / SN-017): the ROM's S.VAL gun
   *  counter is bumped for BOTH sides (RBARON.MAC:2182-84, :1479), so enemy fire is
   *  audible in the cabinet. Rattles the same gun cue as the player's own. */
  readonly enemyFiring: boolean
  /** Depth of the closest live plane; `+Infinity` when the sky is clear. */
  readonly nearestDepth: number
}

/**
 * Play one cue per gameplay event the sim produced this frame, in order.
 * Every method on the surface is a no-op until the gesture gate opens, so
 * pre-interaction events are silently skipped.
 */
export function playEventSounds(audio: SoundSurface, events: readonly GameEvent[]): void {
  for (const event of events) {
    switch (event.type) {
      case 'enemy-destroyed':
        // Every kill fires the discrete blast. A kill worth the flat 300 — a
        // drone, or a dim/far plane — ALSO rings the TH jingle (findings §6A).
        audio.play('explosion')
        if (event.points === DRONE_SCORE) audio.playTone('TH')
        break
      case 'player-hit':
        audio.play('crash')
        break
      case 'wave-incoming':
        audio.playTone('WP')
        break
      case 'score-tick':
        audio.playTone(event.size === 'small' ? 'TK' : 'TP')
        break
      case 'bonus-life':
        audio.playTone('BN')
        break
      default: {
        // Exhaustiveness guard (house pattern): add a GameEvent kind without
        // wiring a cue here and this line becomes a COMPILE error.
        const _exhaustive: never = event
        void _exhaustive
        break
      }
    }
  }
}

/**
 * Drive the continuous sounds from live state, once per frame.
 *
 * The hum runs through a live run and is silenced outside one. The gun rattles
 * while EITHER side is firing — the player's trigger OR an enemy's shell (SN-017),
 * mirroring the ROM's single S.VAL counter. The whine tracks the nearest plane —
 * and with the sky clear (`+Infinity`) the curve idles at the hum pitch on its own.
 */
export function updateContinuousSounds(audio: SoundSurface, world: WorldSound): void {
  const { playing } = world
  audio.setEngine(playing)
  audio.setGun(playing && (world.gunFiring || world.enemyFiring))
  audio.setApproach(playing ? world.nearestDepth : Number.POSITIVE_INFINITY)
}

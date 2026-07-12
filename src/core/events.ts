// src/core/events.ts
//
// The pure-core game-event channel (story rb2-11). These are the gameplay
// moments the shell's audio engine reacts to — emitted as DATA, never as
// callbacks, so the core stays pure and deterministic. Mirrors battlezone's
// core/events.ts (the house pattern).
//
// Narrow with the `type` discriminant (`switch (e.type)`). The shell maps each
// kind to a cue in shell/audio-dispatch.ts; that switch carries a `never`
// exhaustiveness guard, so ADDING a kind here without wiring a cue is a COMPILE
// error, not a silent omission.
//
// Red Baron has no single `stepGame`: the sim steps inline in main.ts across
// several pure core modules. main.ts therefore ASSEMBLES this list each
// calculation frame from the signals it already computes (a shell hit, a lost
// life, a spawned wave) and hands it to the dispatch. The types live in core
// because they describe the SIM's vocabulary, not the speaker's.
//
// PURE. No DOM, no Web Audio, no time, no randomness — the core-audio-free
// sweep (tests/core/core-audio-free.test.ts) enforces it.

// `import type` ⇒ compile-time only, so no runtime import cycle with scoring.ts.
import type { KillKind } from './scoring'

/** A plane or the blimp went down — the analog blast, plus the reward jingle
 *  when the kill is worth the flat 300 (findings §6A, the TH jingle). */
export interface EnemyDestroyedEvent {
  readonly type: 'enemy-destroyed'
  readonly kind: KillKind
  readonly points: number
}

/** The pilot lost a plane — the CRSHSN crash (findings §6B). */
export interface PlayerHitEvent {
  readonly type: 'player-hit'
}

/** A fresh wave entered the sky — the WP descending announce (findings §6A). */
export interface WaveIncomingEvent {
  readonly type: 'wave-incoming'
}

/** The score display ticked — TK (small, SOUND 0) or TP (larger, SOUND 4). */
export interface ScoreTickEvent {
  readonly type: 'score-tick'
  readonly size: 'small' | 'large'
}

/** An extra plane was awarded — the BN rising warble (findings §6A). */
export interface BonusLifeEvent {
  readonly type: 'bonus-life'
}

export type GameEvent =
  | EnemyDestroyedEvent
  | PlayerHitEvent
  | WaveIncomingEvent
  | ScoreTickEvent
  | BonusLifeEvent

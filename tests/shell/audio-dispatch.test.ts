// tests/shell/audio-dispatch.test.ts
//
// Story rb2-11 — RED phase (Han Solo / TEA). The shell's event→sound wiring as
// PURE, importable functions (battlezone bz1-11 / tempest's audio-dispatch
// extraction, deliberately NOT an inline switch in main.ts) — precisely so this
// file can exist: a recording fake asserts the exact calls, in order, with no
// canvas and no AudioContext. main.ts (which cannot run under vitest's node env)
// assembles the per-frame GameEvent list from the loop signals it already has —
// a kill, a lost life, a spawned wave — and calls these.
//
// The sound MAP pinned here (§6 inventory — score/bonus/announce jingles + the
// analog one-shots):
//   enemy-destroyed (any)         → play('explosion')      the analog blast
//   enemy-destroyed (points=300)  → play('explosion') then playTone('TH')  the 300 jingle
//   player-hit                    → play('crash')          the CRSHSN crash
//   wave-incoming                 → playTone('WP')         descending announce
//   score-tick (small)            → playTone('TK')         SOUND 0
//   score-tick (large)            → playTone('TP')         SOUND 4
//   bonus-life                    → playTone('BN')         rising warble
//
// CONTINUOUS sounds are NOT event-driven (§6B: hum/gun/whine free-run from state):
//   updateContinuousSounds(audio, world) runs every render frame —
//     engine hum on while playing; the gun rat-a-tat while firing (S.VAL); the
//     approach whine tracking the nearest enemy's depth. Out of a run: silence.
//
// CONTRACT for the GREEN phase (Yoda / DEV):
//
//   `src/core/events.ts` (PURE DATA — no Web Audio; the core-audio-free sweep
//   guards it), a discriminated union narrowed by `type`:
//     export type GameEvent =
//       | { type: 'enemy-destroyed'; kind: 'lead' | 'drone' | 'blimp'; points: number }
//       | { type: 'player-hit' }
//       | { type: 'wave-incoming' }
//       | { type: 'score-tick'; size: 'small' | 'large' }
//       | { type: 'bonus-life' }
//
//   `src/shell/audio-dispatch.ts`:
//     export interface WorldSound {
//       readonly playing: boolean       // in a live run (not attract/paused)
//       readonly gunFiring: boolean     // trigger held & !overheated → the rat-a-tat
//       readonly nearestDepth: number   // closest live enemy depth; +Infinity when clear
//     }
//     export function playEventSounds(audio: SoundSurface, events: readonly GameEvent[]): void
//     export function updateContinuousSounds(audio: SoundSurface, world: WorldSound): void
//   where SoundSurface = Pick<AudioEngine, 'play'|'playTone'|'setEngine'|'setGun'|'setApproach'>.
//   playEventSounds MUST have a `default: const _n: never = event` exhaustiveness
//   guard (TS lang-review #3) so a new GameEvent kind fails to compile until wired.
//
// The 300-jingle (TH) and announce (WP) have live producers today (a drone kill
// scores a flat 300; spawnWave brings a wave in). TK/TP/BN have no producer yet
// in rb2 — their TABLES exist (pokey.ts) and the map wires them, but main.ts
// emits those events only once a score-tick / bonus-life producer lands (Delivery
// Finding — non-blocking; mirrors bz1-11's producer-less `shell-impact`).
//
// src/shell/audio-dispatch.ts is absent pre-GREEN — the import failure is the RED signal.
import { describe, it, expect } from 'vitest'
import { playEventSounds, updateContinuousSounds, type WorldSound } from '../../src/shell/audio-dispatch'
import type { GameEvent } from '../../src/core/events'

/** A recording fake of the audio surface — captures every call, in order. */
function recorder() {
  const calls: string[] = []
  return {
    calls,
    audio: {
      play(name: 'explosion' | 'crash'): void {
        calls.push(`play:${name}`)
      },
      playTone(name: 'TK' | 'TP' | 'BN' | 'WP' | 'TH'): void {
        calls.push(`playTone:${name}`)
      },
      setEngine(on: boolean): void {
        calls.push(`setEngine:${on}`)
      },
      setGun(firing: boolean): void {
        calls.push(`setGun:${firing}`)
      },
      setApproach(distance: number): void {
        calls.push(`setApproach:${distance}`)
      },
    },
  }
}

const world = (over: Partial<WorldSound>): WorldSound => ({
  playing: true,
  gunFiring: false,
  nearestDepth: Number.POSITIVE_INFINITY,
  ...over,
})

describe('playEventSounds — one cue per gameplay event, in order', () => {
  it('a plane kill fires the analog blast', () => {
    const r = recorder()
    playEventSounds(r.audio, [{ type: 'enemy-destroyed', kind: 'lead', points: 500 }])
    expect(r.calls).toEqual(['play:explosion'])
  })

  it('a 300-point (drone) kill fires the blast AND the TH jingle, in that order', () => {
    const r = recorder()
    playEventSounds(r.audio, [{ type: 'enemy-destroyed', kind: 'drone', points: 300 }])
    expect(r.calls).toEqual(['play:explosion', 'playTone:TH'])
  })

  it('a non-300 kill does NOT fire the jingle', () => {
    const r = recorder()
    playEventSounds(r.audio, [{ type: 'enemy-destroyed', kind: 'blimp', points: 200 }])
    expect(r.calls).toEqual(['play:explosion'])
  })

  it('a lost life fires the crash', () => {
    const r = recorder()
    playEventSounds(r.audio, [{ type: 'player-hit' }])
    expect(r.calls).toEqual(['play:crash'])
  })

  it('an incoming wave sounds the WP announce', () => {
    const r = recorder()
    playEventSounds(r.audio, [{ type: 'wave-incoming' }])
    expect(r.calls).toEqual(['playTone:WP'])
  })

  it('score ticks map small→TK, large→TP', () => {
    const r = recorder()
    playEventSounds(r.audio, [
      { type: 'score-tick', size: 'small' },
      { type: 'score-tick', size: 'large' },
    ])
    expect(r.calls).toEqual(['playTone:TK', 'playTone:TP'])
  })

  it('a bonus life rings the BN warble', () => {
    const r = recorder()
    playEventSounds(r.audio, [{ type: 'bonus-life' }])
    expect(r.calls).toEqual(['playTone:BN'])
  })

  it('replays a mixed batch in core order', () => {
    const r = recorder()
    playEventSounds(r.audio, [
      { type: 'wave-incoming' },
      { type: 'enemy-destroyed', kind: 'drone', points: 300 },
      { type: 'player-hit' },
    ])
    expect(r.calls).toEqual(['playTone:WP', 'play:explosion', 'playTone:TH', 'play:crash'])
  })

  it('an empty stream makes no sound', () => {
    const r = recorder()
    playEventSounds(r.audio, [])
    expect(r.calls).toEqual([])
  })

  it('EVERY event kind produces at least one cue — no kind falls silently through', () => {
    const oneOfEach: readonly GameEvent[] = [
      { type: 'enemy-destroyed', kind: 'lead', points: 500 },
      { type: 'player-hit' },
      { type: 'wave-incoming' },
      { type: 'score-tick', size: 'small' },
      { type: 'bonus-life' },
    ]
    for (const event of oneOfEach) {
      const r = recorder()
      playEventSounds(r.audio, [event])
      expect(r.calls.length, `${event.type} must map to a cue`).toBeGreaterThan(0)
    }
  })
})

describe('updateContinuousSounds — hum / gun / whine free-run from state', () => {
  it('in a live run the hum is on and the whine tracks the nearest enemy', () => {
    const r = recorder()
    updateContinuousSounds(r.audio, world({ playing: true, nearestDepth: 120 }))
    expect(r.calls).toContain('setEngine:true')
    expect(r.calls).toContain('setApproach:120')
  })

  it('the gun rat-a-tat is on ONLY while firing', () => {
    const firing = recorder()
    updateContinuousSounds(firing.audio, world({ playing: true, gunFiring: true }))
    expect(firing.calls).toContain('setGun:true')

    const held = recorder()
    updateContinuousSounds(held.audio, world({ playing: true, gunFiring: false }))
    expect(held.calls).toContain('setGun:false')
  })

  it('out of a run everything falls silent — hum off, gun off, whine off', () => {
    const r = recorder()
    updateContinuousSounds(r.audio, world({ playing: false, gunFiring: true, nearestDepth: 50 }))
    expect(r.calls).toContain('setEngine:false')
    expect(r.calls).toContain('setGun:false')
    expect(r.calls, 'a stopped game never keeps the gun going').not.toContain('setGun:true')
    // Review round 1: the whine was the one continuous voice never asserted here —
    // forwarding the live nearestDepth would have leaked the enemy whine into a
    // paused game, the exact bug the setGun assertion above guards against.
    expect(r.calls).toContain('setApproach:Infinity')
    expect(r.calls, 'a paused game must not sing about a nearby enemy').not.toContain(
      'setApproach:50',
    )
  })
})

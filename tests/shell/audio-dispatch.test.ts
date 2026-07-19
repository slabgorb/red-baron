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
//       readonly gunFiring: boolean     // PLAYER trigger held & !overheated
//       readonly enemyFiring: boolean   // rb4-10 SN-017: an enemy shell was fired this
//                                       //   frame — the ROM's S.VAL rattles for both sides
//       readonly nearestDepth: number   // closest live enemy depth; +Infinity when clear
//     }
//   updateContinuousSounds turns the gun ON when gunFiring OR enemyFiring (and playing).
//   main.ts must populate `enemyFiring` from the sim's enemy-shell creations (Delivery
//   Finding — main.ts is not unit-testable under vitest's node env).
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
import type { OneShot } from '../../src/shell/audio'

/** A recording fake of the audio surface — captures every call, in order. */
function recorder() {
  const calls: string[] = []
  return {
    calls,
    audio: {
      // Mirror the REAL AudioEngine.play(OneShot) signature — now that OneShot
      // includes 'spiral', a narrower 'explosion' | 'crash' here drifts from the
      // surface it stands in for (method bivariance hides it from tsc).
      play(name: OneShot): void {
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
  enemyFiring: false, // rb4-10 SN-017: an enemy shell rattles the gun too
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

  it('the gun rat-a-tat is on while the PLAYER fires', () => {
    const firing = recorder()
    updateContinuousSounds(firing.audio, world({ playing: true, gunFiring: true }))
    expect(firing.calls).toContain('setGun:true')

    const idle = recorder()
    updateContinuousSounds(idle.audio, world({ playing: true, gunFiring: false, enemyFiring: false }))
    expect(idle.calls).toContain('setGun:false')
  })

  // rb4-10 / SN-017: the CRSHSN D2 gun bit is driven by S.VAL, which SETSHL bumps for
  // EVERY shell — the enemy's as well as the player's (RBARON.MAC:2182-84, and the
  // enemy spray at :1479). So enemy fire, which is audible in the cabinet, must rattle
  // our gun too. rb2-11 drove the gate purely off the player's trigger, so an enemy
  // shooting at you was SILENT. The ROM makes no attempt to tell the two sides apart —
  // one latch bit, one counter — so an enemy shell alone is enough to sound the gun.
  it('an ENEMY firing rattles the gun even when the player is NOT firing (SN-017)', () => {
    const r = recorder()
    updateContinuousSounds(r.audio, world({ playing: true, gunFiring: false, enemyFiring: true }))
    expect(r.calls, 'enemy fire is audible — the ROM sounds the gun for both sides').toContain(
      'setGun:true',
    )
  })

  it('the gun is silent only when NEITHER side is firing (SN-017)', () => {
    const r = recorder()
    updateContinuousSounds(r.audio, world({ playing: true, gunFiring: false, enemyFiring: false }))
    expect(r.calls).toContain('setGun:false')
  })

  it('a stopped game keeps the gun silent even under enemy fire (SN-017)', () => {
    const r = recorder()
    updateContinuousSounds(r.audio, world({ playing: false, gunFiring: true, enemyFiring: true }))
    expect(r.calls, 'SNDON is a no-op outside play — attract is silent').toContain('setGun:false')
    expect(r.calls).not.toContain('setGun:true')
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

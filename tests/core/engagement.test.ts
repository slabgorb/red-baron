// tests/core/engagement.test.ts
//
// Story rb4-1 — REWORK, after the Thought Police REJECTED the first pass.
//
// THE SEAM THE SUITE SKIPPED. Every scoring test called `scoreKill(kind, depth)` directly
// and handed it whatever depth it liked. Nothing ever asked the question a player asks:
// *at what depth can I actually kill this thing?* So nobody noticed that the guns could
// not reach the plane.
//
// The first pass corrected the depth scale (P.INDP 1080 -> 0x1080 = 4224) but left the
// port's invented gun reach at 800 world units. Consequences, both invisible to a suite
// that never fires a shot at a real plane:
//
//   * the plane was UNTOUCHABLE for its first ~41 seconds of flight;
//   * `PLNSCR`'s flat 300-point "XTRA POINTS IF DIM" branch — the very mechanic the story
//     was written to restore (CB-003) — was DEAD CODE. A lead could only be killed inside
//     depth 800, so the most one could EVER be worth was 10 points.
//
// The ROM settles it. A shell is born at S.DPTH (0x100) and its Z counter climbs to
// S.MAXZ (0x19); `S.MAXZ`'s own comment says the unit out loud — ";SHELL MAX Z (* 100)".
// So the reach is 0x19 x 0x100 = 6400, which OUTRANGES the 4224 spawn: in the arcade you
// can shoot the plane the moment it appears, and the distant plane is the one worth 300.
// You are paid for the hard shot.
//
// These tests fire REAL shells from the REAL gun model at a REAL spawned enemy and score
// the REAL hit. They are the tests that would have caught it.

import { describe, it, expect } from 'vitest'
import { createRng } from '@arcade/shared/rng'
import { spawn, step as stepEnemy, P_INDP, type Enemy } from '../../src/core/enemy'
import {
  fire,
  step as stepGuns,
  INITIAL_GUNS,
  S_MAXZ,
  S_DPTH,
  SHELL_RANGE_DEPTH,
  type Guns,
} from '../../src/core/guns'
import { scoreKill, DRONE_SCORE } from '../../src/core/scoring'

/** Hold the trigger and fly the guns until a shell strikes `target`, or give up. */
function killAt(depth: number, maxFrames = 200): { killed: boolean; frames: number } {
  const target: Enemy = {
    kind: 'lead',
    x: 0, // dead ahead — this is a range test, not an aim test
    y: 0,
    depth,
    deltaX: 0,
    bank: 0,
    side: 1,
    active: true,
    facingAway: true, // rb4-13 D4 mirror — orientation-blind hitbox; settled flight state
  }
  let guns: Guns = INITIAL_GUNS
  for (let f = 0; f < maxFrames; f++) {
    guns = fire(guns, true) // trigger held
    const { guns: next, hits } = stepGuns(guns, [target])
    guns = next
    if (hits.length > 0) return { killed: true, frames: f + 1 }
  }
  return { killed: false, frames: maxFrames }
}

describe('the gun reaches as far as the ROM says it does', () => {
  it('SHELL_RANGE_DEPTH is S.MAXZ x S.DPTH = 6400, not an invented 800', () => {
    expect(SHELL_RANGE_DEPTH).toBe(S_MAXZ * S_DPTH)
    expect(SHELL_RANGE_DEPTH).toBe(6400)
    expect(SHELL_RANGE_DEPTH).not.toBe(800) // the invented reach we shipped
  })

  it('the shell OUTRANGES the plane spawn depth — the arcade lets you fire on sight', () => {
    // This single inequality is the whole finding. At 800 it was false, and the entire
    // long-range game — including its scoring — was unreachable.
    expect(SHELL_RANGE_DEPTH).toBeGreaterThan(P_INDP)
  })
})

describe('a plane can be engaged the moment it spawns', () => {
  it('a freshly-spawned lead, untouched, can be shot down where it stands', () => {
    const enemy = spawn(createRng(7), 0)
    expect(enemy.depth).toBe(P_INDP) // 4224 — the far spawn
    const { killed } = killAt(enemy.depth)
    expect(killed, 'the spawn depth must be inside the gun\'s reach').toBe(true)
  })

  it('the player does not have to WAIT for the plane — no dead time before first blood', () => {
    // The regression this rework exists to kill: with the 800 reach, the plane took ~428
    // calc-frames (41 s) just to become shootable. Fly the real weave and require the
    // enemy to be killable from the very first frame it exists.
    let enemy = spawn(createRng(11), 0)
    expect(killAt(enemy.depth).killed).toBe(true) // frame 0 — no waiting
    // …and it stays killable all the way in.
    for (let i = 0; i < 200; i++) {
      enemy = stepEnemy(enemy, 0)
      if (i % 50 === 0) expect(killAt(enemy.depth).killed).toBe(true)
    }
  })

  it('a target BEYOND the ROM range is still out of reach — the gun is not infinite', () => {
    // The negative case, so "everything is hittable" cannot pass this suite either.
    expect(killAt(SHELL_RANGE_DEPTH + 0x400).killed).toBe(false)
  })
})

describe('CB-003 is REACHABLE — the far/dim 300-point kill is live code', () => {
  it('a lead killed at its spawn depth pays the full flat DRNPNT', () => {
    const enemy = spawn(createRng(7), 0)
    expect(killAt(enemy.depth).killed).toBe(true)
    // PLNSCR: depth MSB >= 0x10 -> the flat DRNPNT, ";XTRA POINTS IF DIM".
    expect(scoreKill('lead', enemy.depth)).toBe(DRONE_SCORE)
  })

  it('the 300-point branch is reachable THROUGH THE GUNS — not just by calling scoreKill', () => {
    // The bug in one assertion. Sweep every depth the gun can actually kill at and ask
    // what the best lead is worth. Before the fix the answer was 10, because the gun could
    // not reach past 800 and the flat-300 branch needs depth >= 0x1000. The scoring test
    // suite never noticed, because it fed scoreKill depths no shell could ever reach.
    let best = 0
    for (let depth = 0; depth <= SHELL_RANGE_DEPTH; depth += 0x40) {
      if (killAt(depth).killed) best = Math.max(best, scoreKill('lead', depth))
    }
    expect(best).toBe(DRONE_SCORE) // 300 — reachable
    expect(best).toBeGreaterThan(10) // the ceiling we actually shipped
  })

  it('and the ROM\'s incentive survives: the far kill pays MORE than the close one', () => {
    // The design intent, end to end — you are rewarded for the difficult distant shot.
    const far = P_INDP // 4224, MSB 0x10 -> dim -> flat 300
    const close = 0x300 // 768, nose-to-nose
    expect(killAt(far).killed).toBe(true)
    expect(killAt(close).killed).toBe(true)
    expect(scoreKill('lead', far)).toBeGreaterThan(scoreKill('lead', close))
  })
})

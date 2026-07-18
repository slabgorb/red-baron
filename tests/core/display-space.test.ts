// tests/core/display-space.test.ts
//
// Story rb4-6 — RED phase, ROUND 2 (Furiosa / TEA). "THE PILOT CANNOT AIM."
//
// Round 1 shipped the ROM's window-servo faithfully and thereby broke the game: the
// servo reverses AWAY from centre at P.ILIM, so it drives |pos| out into the
// [P.ILIM, P.OLIM] band — and our pilot has no way to follow it, because nothing in the
// clone moves a plane relative to the gun. The Reviewer measured it (200 planes/level,
// isolated worktrees, HEAD vs origin/develop): at GMLEVL >= 2 a plane is inside the gun's
// reach for exactly 1.0 frames of its life (the spawn frame, before step() has run) and
// 0/200 planes are reachable afterwards. PLNLVL (scoring.ts:34) reaches GMLEVL 2 at FIVE
// kills, so the game soft-locks: no sixth kill is possible. 1051 tests stayed green.
//
// WHY THE ROM DOES NOT HAVE THIS BUG — the decisive citation. A motion object's stored
// position is a WORLD coordinate and its SCREEN position is that minus the pilot's own
// position. RBARON.MAC:2907-2933, the routine that keeps a plane inside the window:
//
//     2906:  LDX I,2                     ; run for X-reg = 2 (Y axis) ...
//     2909:  LDA ZX,PLSTAT               ; PLANE POSITION      <- WORLD
//     2910:  SBC ZX,UNIV4X               ; - UNIVERSE CENTER   <- the pilot
//     2916:  JSR DPABS                   ; ABSOLUTE OF POSITION ON SCREEN
//     2918:  CPY RESULT                  ; COMPARE TO LIMIT    <- window test, in SCREEN space
//     2929:  ADC ZX,UNIV4X               ; ADD TO UNIVERSE CENTER
//     2930:  STA ZX,PLSTAT               ; SET PLANE POSITION  <- written back as WORLD
//     2934:  DEX / DEX / BPL 10$         ; ... then X-reg = 0 (X axis)
//
// and the two axes subtract DIFFERENT halves of the same 4-byte block (:90-91):
//
//     90:  UNIV4X: .BLKB 4               ; UNIVERSE X (* 4)     <- X-reg 0: the turn pan
//     91:  I4YPOS = UNIV4X+2             ; PLAYER Y POSITION*4  <- X-reg 2: the altitude
//
// So TURNING moves a plane across the screen and CLIMBING moves it up/down it. That is
// how the pilot aims: the plane weaves away from the boresight and you FLY it back into
// the sights. Our `toEye` (flight.ts:231) already computes exactly this pair —
// [heading * PAN_SCALE, altitude * ALT_TO_Y, 0] IS (UNIV4X, I4YPOS).
//
// WHAT WE SHIP INSTEAD. rb4-5 established the right model for world objects — its own
// suite says "objects are drawn at (their X - UNIV4X)" (camera-shape.test.ts:10-11) — but
// main.ts:187 EXEMPTS motion objects, rendering them with `flightView(attitude, [0,0,0])`
// under the comment "motion objects are already in view-relative coords ... the UNIV4X/
// I4YPOS world pan must not drift them off as the pilot turns or climbs" (main.ts:180-186).
// That exemption is the bug: it is the one claim the ROM block above directly contradicts.
// The gun then collides against those un-panned coords (guns.ts:382-390) with a shell
// pinned at y:0 for its whole flight (guns.ts:321 — guns.step only advances z), so the
// pilot's stick does nothing to the plane/gun relationship. Ever.
//
// USER RULING (2026-07-16): project enemy x/y through the player's attitude — make our
// coordinates genuinely be the ROM's display coordinates. REJECTED alternatives: bounding
// the servo to the reachable window (a tuned constant = the trap rb4 exists to kill, and it
// fakes AC-1's shape), and widening WINDOW_Y (hides it).
//
// ─── CONTRACT for GREEN (The Word Burgers / DEV) ──────────────────────────────────────
//
// This suite pins BEHAVIOUR and the ROM's contract, NOT the arithmetic. Two things are
// deliberately left to Dev, because the algebra is real work and this suite must not
// pre-decide it wrong:
//
//   * WHERE the plane's stored position lives. The ROM keeps PLSTAT in world space and
//     derives the screen position per frame. Our `enemy.y` currently spawns at +-40 while
//     `toEye(INITIAL_FLIGHT)` is [0, 132, 0] (altitude 0x0210 * ALT_TO_Y) — so a naive
//     `enemy.y - eye[1]` would put every plane 132 units below the boresight. The world/
//     display mapping (and where HORIZN, :2750, lands in it) is Dev's to derive.
//   * The exact shape of the seam. This suite requires only:
//       - `displayPos(enemy, eye) -> {x, y}` exported from core/enemy — the plane's
//         position ON SCREEN given the pilot's eye (the ROM's PLSTAT - UNIV4X).
//       - the gun collides in that space: `guns.step(guns, targets, eye)` and
//         `guns.collides(shell, enemy, eye)`.
//     If Dev prefers another factoring, re-seat these tests — but the BEHAVIOURS below
//     (turning/climbing move a plane on screen; every GMLEVL is winnable) are the ACs.
//
// Loaded defensively (await import in beforeAll — the flight.test.ts house pattern) so a
// missing export reports a clean assertion failure, not a collection crash.

import { describe, it, expect, beforeAll } from 'vitest'
import { createRng, type Rng } from '@arcade/shared/rng'
// ROUND 3: the ramp pin asserts the REAL exported table. Round 2 hand-copied PLNLVL into a
// local literal, which made the test tautological — the review mutated the real export's [5]
// and all 11 tests stayed green. scoring.ts is not part of this suite's RED contract surface,
// so a static import is safe and correct here.
import { PLNLVL } from '../../src/core/scoring'

type Vec3 = readonly [number, number, number]

interface Enemy {
  readonly kind: 'lead' | 'drone'
  readonly x: number
  readonly y: number
  readonly depth: number
  readonly deltaX: number
  readonly bank: number
  readonly side: -1 | 1
  readonly active: boolean
  readonly facingAway: boolean
}

interface Shell {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly active: boolean
}

interface FlightState {
  readonly turnRate: number
  readonly pitchRate: number
  readonly altitude: number
  readonly heading: number
}

interface EnemyModule {
  spawn?: (rng: Rng, level?: number) => Enemy
  step?: (enemy: Enemy, level?: number) => Enemy
  P_OLIM?: readonly number[]
  P_ILIM?: readonly number[]
  /** rb4-6 round 2 — the plane's SCREEN position given the pilot's eye (PLSTAT - UNIV4X, :2909-2913). */
  displayPos?: (enemy: Enemy, eye: Vec3) => { x: number; y: number }
}

interface GunsModule {
  /**
   * rb4-6 round 2 — collision is evaluated in DISPLAY space, so it needs the pilot's eye.
   * `eye` is the third parameter TODAY'S two-arg `collides` silently ignores, which is exactly
   * why these tests fail on the assertion rather than on a TypeError.
   */
  collides?: (shell: Shell, enemy: Enemy, eye: Vec3) => boolean
}

interface FlightModule {
  INITIAL_FLIGHT?: FlightState
  step?: (state: FlightState, input: { turn: number; pitch: number; proximity: string }) => FlightState
  toEye?: (state: FlightState) => Vec3
}

interface WavesModule {
  /** rb4-6 R3 — AC-R3 drives the wave through the REAL stepper so drones/fly-past ride the guard. */
  stepWave?: (enemies: readonly Enemy[], level?: number) => readonly Enemy[]
}

let m: EnemyModule = {}
let g: GunsModule = {}
let f: FlightModule = {}
let w: WavesModule = {}

beforeAll(async () => {
  // Each cast goes through `unknown` on purpose: these are the round-2 CONTRACT shapes, and
  // they deliberately do not overlap the shipped ones (today's `collides` takes two params,
  // and `displayPos` does not exist at all). A direct cast is a tsc error; that error is the
  // RED signal arriving at compile time instead of at the assertion, which helps nobody.
  try {
    m = (await import('../../src/core/enemy')) as unknown as EnemyModule
  } catch {
    m = {}
  }
  try {
    g = (await import('../../src/core/guns')) as unknown as GunsModule
  } catch {
    g = {}
  }
  try {
    f = (await import('../../src/core/flight')) as unknown as FlightModule
  } catch {
    f = {}
  }
  try {
    w = (await import('../../src/core/waves')) as unknown as WavesModule
  } catch {
    w = {}
  }
})

function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`rb4-6 round-2 RED contract: must export ${name}`)
  return value
}

/**
 * The rotated collision plate's circumscribed radius — AC-R2's "definitely outside" offset ONLY.
 * rb4-17 re-baselined the window from the inferred ±32 square to the ROM's own COLLD plate —
 * x ±48, y −64..+80 (037007.XXX:602-605 ×PICTURE_SCALE; see guns.ts WINDOW_X) — so "definitely
 * outside at any bank" is beyond the plate's farthest corner, hypot(48, 80).
 * ROUND 3: AC-R3 no longer judges reach with this. The review proved a hypot-vs-MAX_REACH
 * check is a parallel REIMPLEMENTATION of the gun: it stayed green with `collides` reverted
 * to ignore its eye (round 1's exact defect), and the circle CIRCUMSCRIBES the real box, so
 * it inflated GMLEVL 4's margin (11.6 by the circle; 10.8 through the real gun). Reach is
 * now judged by `guns.collides` itself — the guard exercises the thing it guards.
 */
const MAX_REACH = Math.hypot(48, 80)

const LEVELS = [0, 1, 2, 3, 4] as const

// ═══════════════════════════════════════════════════════════════════════════
// AC-R1 — the pilot's own position moves a plane ON SCREEN (PLSTAT - UNIV4X)
// ═══════════════════════════════════════════════════════════════════════════
describe('rb4-6 R2 AC-R1 — display space is plane MINUS pilot (RBARON.MAC:2909-2913)', () => {
  it('a plane sitting still is displaced ON SCREEN when the pilot TURNS (UNIV4X, X-reg 0)', () => {
    // :2909-2910 `LDA ZX,PLSTAT ;PLANE POSITION` / `SBC ZX,UNIV4X ;- UNIVERSE CENTER`.
    // With X-reg 0 the subtrahend is UNIV4X+0 — the accumulated turn pan (:90 "UNIVERSE X").
    // Today NOTHING consumes the eye, so a turning pilot cannot move a plane one unit.
    const displayPos = need(m.displayPos, 'displayPos')
    const e = need(m.spawn, 'spawn')(createRng(1), 0)
    const level: Vec3 = [0, 0, 0]
    const panned: Vec3 = [100, 0, 0] // the pilot turned: UNIV4X advanced
    const a = displayPos(e, level)
    const b = displayPos(e, panned)
    expect(b.x, 'turning did not move the plane on screen — the UNIV4X pan is not applied').not.toBe(a.x)
    // and it moves OPPOSITE the pan, because the ROM SUBTRACTS the universe centre
    expect(b.x - a.x).toBeCloseTo(-100, 6)
  })

  it('a plane sitting still is displaced ON SCREEN when the pilot CLIMBS (I4YPOS, X-reg 2)', () => {
    // The same block runs for X-reg = 2 first (`LDX I,2`, :2906; `DEX/DEX/BPL 10$`, :2934-2936),
    // and at X-reg 2 the subtrahend is UNIV4X+2 — which :91 defines as
    // `I4YPOS = UNIV4X+2 ;PLAYER Y POSITION * 4`. So altitude pans the Y axis exactly as the
    // turn pans the X axis. This is the half AC-2 got wrong twice: not a HORIZN bias, a PILOT.
    const displayPos = need(m.displayPos, 'displayPos')
    const e = need(m.spawn, 'spawn')(createRng(1), 0)
    const lo = displayPos(e, [0, 0, 0])
    const hi = displayPos(e, [0, 100, 0]) // the pilot climbed: I4YPOS advanced
    expect(hi.y, 'climbing did not move the plane on screen — I4YPOS is not applied').not.toBe(lo.y)
    expect(hi.y - lo.y).toBeCloseTo(-100, 6)
  })

  it("the pilot's eye is the ONE source — displayPos agrees with flight.toEye", () => {
    // toEye (flight.ts:231) already returns [heading * PAN_SCALE, altitude * ALT_TO_Y, 0] —
    // that pair IS (UNIV4X, I4YPOS). The seam must consume it, not re-derive a second pan.
    const displayPos = need(m.displayPos, 'displayPos')
    const toEye = need(f.toEye, 'toEye')
    const INITIAL_FLIGHT = need(f.INITIAL_FLIGHT, 'INITIAL_FLIGHT')
    const e = need(m.spawn, 'spawn')(createRng(1), 0)
    const straight = toEye(INITIAL_FLIGHT)
    const turned = toEye({ ...INITIAL_FLIGHT, heading: INITIAL_FLIGHT.heading + 64 })
    const a = displayPos(e, straight)
    const b = displayPos(e, turned)
    expect(a.x - b.x, 'a heading change did not shift the plane by the UNIV4X pan').toBeCloseTo(
      turned[0] - straight[0],
      6,
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// AC-R2 — the gun shoots in DISPLAY space (so the stick can aim it)
// ═══════════════════════════════════════════════════════════════════════════
describe('rb4-6 R2 AC-R2 — the gun collides in display space, not world space', () => {
  it('a plane OUT of the gun window can be brought INTO it by flying', () => {
    // The headline. Put a plane well outside the +-32 window, then pan the eye to exactly
    // cancel its offset: the SAME plane must become hittable. Today collides() never sees an
    // eye, so no amount of flying changes the verdict.
    const collides = need(g.collides, 'collides(shell, enemy, eye)')
    const e: Enemy = {
      ...need(m.spawn, 'spawn')(createRng(1), 0),
      x: 200,
      y: 150,
      depth: 1000,
      bank: 0,
      deltaX: 0,
      active: true,
    }
    const shell: Shell = { x: 0, y: 0, z: 1000 / 256, active: true }
    expect(collides(shell, e, [0, 0, 0]), 'the plane should be far out of the window at eye 0').toBe(false)
    // fly until the plane is dead ahead: the eye lands on the plane's offset
    expect(
      collides(shell, e, [200, 150, 0]),
      'flying onto the plane did not bring it into the gun window — the gun ignores the eye',
    ).toBe(true)
  })

  it('the shell is fired at the BORESIGHT, so display y=0 is where it can hit', () => {
    // guns.ts:321 fires `{ x: muzzleX(gun), y: 0, ... }` and guns.step only advances z, so the
    // shell's y is pinned at 0 for its whole flight. That is FINE — but only if y=0 means "the
    // boresight", i.e. only if the plane's y is measured against the pilot. Pin the invariant.
    const collides = need(g.collides, 'collides(shell, enemy, eye)')
    const base = need(m.spawn, 'spawn')(createRng(1), 0)
    const e: Enemy = { ...base, x: 0, y: 0, depth: 1000, bank: 0, deltaX: 0, active: true }
    const shell: Shell = { x: 0, y: 0, z: 1000 / 256, active: true }
    expect(collides(shell, e, [0, 0, 0])).toBe(true)
    // slide the PILOT off the plane by more than the window: the shot must now miss
    expect(
      collides(shell, e, [0, MAX_REACH + 10, 0]),
      'the pilot flew far off the plane vertically and the shot still hit — y is not pilot-relative',
    ).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// AC-R3 — THE REGRESSION GUARD: every GMLEVL must stay winnable
// ═══════════════════════════════════════════════════════════════════════════
describe('rb4-6 R2 AC-R3 — a plane is reachable at EVERY GMLEVL (the soft-lock guard)', () => {
  // This is the guard whose absence let round 1 ship. The gun was only ever tested against a
  // hand-built target at y:0 (engagement.test.ts:47) and the servo was only ever tested
  // without a gun — so the seam between them had ZERO coverage. Never delete this.
  //
  // Measure frames-in-reach PER PLANE LIFE, not hits-per-run: round 1 also made planes fly
  // past (correctly), which shortens lifetimes and confounds any raw per-run hit count. And
  // count from the SPAWN frame explicitly — a probe that skips frame 0 over-reports the
  // failure (it reported "never reachable" when the honest number was "the spawn frame only").
  //
  // ROUND 3 (review round 2): reach is judged by the REAL `guns.collides`, not a hypot circle.
  // The round-2 version reimplemented reach as `hypot(x, y) <= 32*sqrt(2)` and was mutation-
  // proven blind: reverting `collides` to ignore its eye — the EXACT regression this guard
  // names — left every AC-R3 test green, and the circumscribed circle over-reported the real
  // rotated-box margin (GMLEVL 4: 11.6 by the circle, 10.8 through the gun). The boresight
  // shell is placed at the plane's exact depth (`z = depth/256`, the AC-R2 convention) so the
  // z-window is satisfied by construction and what this measures is X/Y reach — through the
  // same box, bank rotation and all, that the game scores kills with. The wave advances via
  // the REAL `stepWave`, so the fly-past drop and formation seam ride the guard too.
  it.each(LEVELS)('GMLEVL %i: a chasing pilot keeps planes within the REAL gun for more than the spawn frame', (lvl) => {
    const spawn = need(m.spawn, 'spawn')
    const stepWave = need(w.stepWave, 'stepWave')
    const displayPos = need(m.displayPos, 'displayPos')
    const collides = need(g.collides, 'collides(shell, enemy, eye)')
    const toEye = need(f.toEye, 'toEye')
    const flightStep = need(f.step, 'step(flight)')
    const INITIAL_FLIGHT = need(f.INITIAL_FLIGHT, 'INITIAL_FLIGHT')

    let reachableFrames = 0
    let lives = 0
    const SEEDS = 25
    for (let seed = 1; seed <= SEEDS; seed++) {
      let wave: readonly Enemy[] = [spawn(createRng(seed), lvl)]
      let flight = INITIAL_FLIGHT
      let framesThisLife = 0
      for (let fr = 0; fr < 600 && wave.length > 0; fr++) {
        const e = wave[0]
        // a CHASING pilot: steer the stick toward wherever the plane currently is on screen
        const d = displayPos(e, toEye(flight))
        flight = flightStep(flight, {
          turn: Math.max(-1, Math.min(1, d.x / 64)),
          pitch: Math.max(-1, Math.min(1, d.y / 64)),
          proximity: 'far',
        })
        // judge with the gun that scores kills: a boresight shell at the plane's exact depth
        const shell: Shell = { x: 0, y: 0, z: e.depth / 256, active: true }
        if (collides(shell, e, toEye(flight))) framesThisLife++
        wave = stepWave(wave, lvl) // fly-past drops the plane and the life ends, as in play
      }
      reachableFrames += framesThisLife
      lives++
    }
    const avg = reachableFrames / lives
    // > 1.0 is the exact bar round 1 failed: at GMLEVL 2/3/4 it scored exactly 1.0 — the spawn
    // frame and nothing else. A pilot who can fly must do better than a pilot who cannot move.
    // rb4-16 CORRECTION (TEA Gap finding): the old figures cited here (597.3/112.5/24.1/20.2/10.8)
    // were measured through the ±32 world-tube gun rb4-17 DELETED — stale. This is now a coarse
    // smoke test (2-arg stepWave, boresight); the AUTHORITATIVE per-level reachability guard is
    // rb4-16 AC-R3 (plonsn.test.ts), which threads a chasing eye through the growing COLLD gun and
    // pins the honest captured baseline. Do not re-tune this bar to manufacture slack; read the level.
    expect(
      avg,
      `GMLEVL ${lvl}: a chasing pilot averaged ${avg.toFixed(1)} frames in gun-reach per plane — the plane ` +
        `outruns the stick, so this level is unwinnable (round 1 scored exactly 1.0 here: the spawn frame)`,
    ).toBeGreaterThan(10)
  })

  it('the level ramp cannot strand the player — GMLEVL 2 arrives at 5 kills', () => {
    // Why the guard above is CRITICAL and not cosmetic: PLNLVL is indexed by the kill count,
    // so the player reaches GMLEVL 2 after five kills and can never leave it if planes are
    // unreachable there. This pins the coupling so nobody "fixes" the soft-lock by re-tuning
    // the ramp instead of the seam.
    //
    // ROUND 3: asserts the REAL export. Round 2 hand-copied the table into a local literal,
    // which could never fail — the review mutated scoring.ts's PLNLVL[5] to 1 and all 11 tests
    // in this file stayed green. A literal compared to itself is not a guard.
    expect(
      PLNLVL[5],
      'scoring.ts PLNLVL changed — re-derive which GMLEVL the reachability guard must cover',
    ).toBe(2)
  })
})

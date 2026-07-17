// tests/core/plonsn.test.ts
//
// Story rb4-16 — RED phase (Furiosa / TEA). "PLONSN, OR THE PLANE ESCAPES THE SCREEN."
// RE-CUT 2026-07-17. This suite is REWRITTEN from scratch; it does NOT inherit the parked RED
// (bdd03f1), whose AC-2 premise asserted the servo runs on our PRE-divide `displayPos`. That
// premise is wrong — the correction below is the whole reason the story was re-cut.
//
// ─── THREE COORDINATE SPACES, NOT TWO (the re-cut's headline) ────────────────────────────────
//
//   1. WORLD          PLSTAT+0/+2  (":268 PLANE POSITION")     — the plane's stored position.
//   2. DISPLAY (pre)  world − pilot (our `displayPos`, :2909)  — what the GUN tests (rb4-6 R2).
//   3. SCREEN (post)  PLSTAT+8/+A  (":278 DISPLAY POSITION",   — POSITH's PERSPECTIVE DIVIDE
//                     ":3157/:3162 ;X/Y SCREEN POSITION")        (÷ depth) + the HORIZN lift.
//
// The window SERVO (PLNDEL / P.WINDW) decides its zone from space 3 — the POST-DIVIDE screen
// position — verified firsthand:
//
//     2747  2$:     LDX I,2            ; X-reg = 2  → the Y pass (reads PLSTAT+8+2 = PLSTAT+0A)
//     2749          LDA ZX,PLSTAT+8    ; ;PLSTAT+10.  ← DISPLAY/SCREEN position, NOT world
//     2750          SBC I,HORIZN       ;   the Y entry normalizes (rb4-6: no NET term for us)
//     2865  P.WITR: DEX / DEX          ; X-reg = 0  → the X pass
//     2867          LDA ZX,PLSTAT+8    ; ;X DISPLAY  ← PLSTAT+8 raw
//
//   FIND THE `LDX` BEFORE THE `ZX,` OPERAND. Both passes are the same instruction; only the X
//   register differs. `:2749` is the Y entry (`LDX I,2` at :2747), NOT X. The parked story burned
//   a review round "correcting" this from a grep. enemy.ts:103-128 already has it right — do not
//   re-litigate it.
//
// And PLSTAT+8 is genuinely post-divide, verified in POSITH (RBGRND.MAC:296-306):
//     LDA OBJECT+6 ;SCALE BY DEPTH / … / STA MATH+14 ;START DIVIDE / … / ADC I,HORIZN
// so the servo's position is (world − pilot) ÷ depth — the perspective divide, then HORIZN on Y.
// That divide is the ONLY thing separating this from the parked story's pre-divide `displayPos`,
// and AC-1 test 2 below is built to catch a servo that skips it.
//
// PLONSN (RBARON.MAC:2877-2937) is the on-screen bound, verified firsthand:
//     2882  LDA PLSTAT+19        ; PLANE DEPTH  ← POSITION Z (+19/+1A) is the window's scale
//     2886  LDA I,0A0            ; SCALE WINDOW SIZE (1A0*1A0) BY DEPTH   (MM.XM=1 at :2888 → 0x1A0)
//     2892  JSR MRSAB0           ; MULTIPLIED   ← the window is PROPORTIONAL to depth
//     2900  LDY PFROTN / D.COMP / TRIG / MRSLT0 ; ROTATE WINDOW LIMIT by the bank (037007.XXX SINE:)
//     2909  LDA ZX,PLSTAT / SBC ZX,UNIV4X       ; |world − pilot|  vs the depth-scaled limit
//     2920  BCC 40$              ; PLANE W/I WINDOW → leave it alone
//     2921  LDY RESULT           ; ELSE SET POSITION TO LIMIT
//     2929  ADC ZX,UNIV4X / STA ZX,PLSTAT       ; write the clamped WORLD position back THROUGH the pilot
//
// FRAME ORDER (:2553-2555): UPDPLN (servo decides delta, integrates) → UPDMOB → PLONSN (clamp).
// PLONSN writes POSITION, never the DELTA — so every deltaX assertion here is immune to the clamp
// by the ROM's own ordering.
//
// ─── CONTRACT for GREEN (The Word Burgers / DEV) ─────────────────────────────────────────────
//
// This suite pins BEHAVIOUR and the ROM's contract, NOT the Math Box fixed-point. Deliberately
// left to Dev, because the algebra is real work and this suite must not pre-decide it wrong:
//
//   * THE EXACT WINDOW SCALE and the PFROTN ROTATION. `0x1A0` scaled by depth through MRSAB0
//     (>>16, MBUCOD.V05:494-516), `RESULT * ^100` (:2893-2896), then rotated by PFROTN through
//     the 037007.XXX sine table (`SINE: .WORD 0,192,324,4B5,646,…,3FFB,4000`; `QUADSN: .BYTE
//     0,80,0C0,40` :48/:64 — verified firsthand). Derive it, cite the bytes. This suite pins only
//     what the ROM's own comment guarantees without the Math Box: window magnitude 0x1A0 (a byte),
//     PROPORTIONAL to depth, ANCHORED to the pilot, and it CLAMPS (does not attract). If your
//     derivation contradicts a test here, bring the citation — do not re-tune the test.
//
//   * THE EYE'S ROUTE INTO THE SERVO. `step(enemy, level)` and `stepWave(enemies, level)` are
//     eye-free today. The re-cut threads the pilot's eye down to the servo; these tests pass it as
//     a third parameter that TODAY'S two-arg functions silently ignore — which is why they fail on
//     an ASSERTION, not a TypeError (the rb4-6 idiom). The 2-arg callers (main.ts, engagement /
//     display-space suites) must keep working: default the eye to the boresight (guns.ts EYE_ORIGIN
//     precedent).
//
//   * PLONSN_WINDOW export. AC-2 requires the window magnitude transcribed from cited bytes; pin it
//     as an exported `PLONSN_WINDOW === 0x1A0`. If you factor it elsewhere, re-seat that one test.
//
// ─── AC-4 IS BLOCKED — DO NOT GUESS THE GATE (see the TEA Assessment's blocking finding) ──────
//
//   The outer-zone depth gate (:2776-2781) is NOT pinned here. Verified firsthand, the ROM reads:
//       2775  BCC P.INSD       ; |pos| < P.OLIM → inside
//       2776  LDA PLSTAT+19    ; (plane is OUTSIDE the outer window)  ← POSITION Z **LSB**
//       2777  CMP I,4
//       2778  BCS 10$          ; ;W/I DEPTH NO RETURN TO SCREEN   → positionZ ≥ 4 ⇒ FLY PAST
//       2779  LDA FLAG+1 / EOR I,0FF / STA FLAG+1  ; ;RETURN TO WARDS SCREEN CENTER → < 4 ⇒ RETURN
//   The context/design AC-4 says the OPPOSITE ("positionZ < 4 → flies past off-screen"). The ROM's
//   own comments say positionZ ≥ 4 flies past and < 4 returns. AND the compare is on PLSTAT+**19**
//   (the POSITION Z LSB, :295), whose scale in our world-unit `positionZ` field is undefined — the
//   "4" is not a byte we can port until the direction AND the LSB-vs-value semantics are resolved
//   against the ROM (with the user). Guessing either is exactly the trap this epic exists to kill.
//   AC-4 is filed as a blocking Delivery Finding and left as `it.todo` below.

import { describe, it, expect, beforeAll } from 'vitest'
import { createRng, type Rng } from '@arcade/shared/rng'
// The level-ramp coupling pin (AC-R3) asserts the REAL export — scoring.ts is not part of this
// suite's RED contract surface, so a static import is safe (display-space.test.ts precedent).
import { PLNLVL } from '../../src/core/scoring'

type Vec3 = readonly [number, number, number]

interface Enemy {
  readonly kind: 'lead' | 'drone'
  readonly x: number
  readonly y: number
  readonly depth: number
  readonly positionZ?: number
  readonly deltaX: number
  readonly deltaY?: number
  readonly bank: number
  readonly entryFrames?: number
  readonly parallel?: boolean
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

interface EnemyModule {
  /** rb4-16 CONTRACT: `step` must SEE the pilot — the servo reads the POST-DIVIDE screen (:2749/:2867). */
  step?: (enemy: Enemy, level?: number, eye?: Vec3) => Enemy
  spawn?: (rng: Rng, level?: number) => Enemy
  displayPos?: (enemy: Enemy, eye: Vec3) => { x: number; y: number }
  P_OLIM?: readonly number[]
  P_ILIM?: readonly number[]
  P_ODLX?: readonly number[]
  P_IIDL?: readonly number[]
  ACCEL?: number
  P_INDP?: number
  /** rb4-16 AC-2 CONTRACT: the PLONSN window magnitude, transcribed from :2886-2889 → 0x1A0. */
  PLONSN_WINDOW?: number
}

interface WavesModule {
  /** rb4-16 CONTRACT: the wave stepper threads the eye down to the servo. */
  stepWave?: (enemies: readonly Enemy[], level?: number, eye?: Vec3) => readonly Enemy[]
}

interface GunsModule {
  collides?: (shell: Shell, enemy: Enemy, eye: Vec3) => boolean
}

interface FlightState {
  readonly turnRate: number
  readonly pitchRate: number
  readonly altitude: number
  readonly heading: number
}

interface FlightModule {
  INITIAL_FLIGHT?: FlightState
  step?: (state: FlightState, input: { turn: number; pitch: number; proximity: string }) => FlightState
  toEye?: (state: FlightState) => Vec3
}

let m: EnemyModule = {}
let w: WavesModule = {}
let g: GunsModule = {}
let f: FlightModule = {}

beforeAll(async () => {
  // Each cast goes through `unknown` on purpose (the rb4-6 idiom): these are rb4-16's CONTRACT
  // shapes and they deliberately do not overlap the shipped ones (`step`/`stepWave` take no eye
  // today, `PLONSN_WINDOW` does not exist). A direct cast is a tsc error, and that error would be
  // the RED signal arriving at compile time instead of at the assertion, which helps nobody.
  try {
    m = (await import('../../src/core/enemy')) as unknown as EnemyModule
  } catch {
    m = {}
  }
  try {
    w = (await import('../../src/core/waves')) as unknown as WavesModule
  } catch {
    w = {}
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
})

function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`rb4-16 RED contract: must export ${name}`)
  return value
}

/** A hand-built settled lead. Every field explicit — no spawn randomness in a zone-algebra test. */
function plane(over: Partial<Enemy> = {}): Enemy {
  return {
    kind: 'lead',
    x: 0,
    y: 224, // mid the [128, 320] UPDPLN altitude band, so the Y clamp is not the thing under test
    depth: 1000, // PICTURE Z, comfortably above P.MNDP (0x140 = 320) so the plane stays active
    positionZ: 1000, // POSITION Z — the depth the servo divides against and PLONSN scales by
    deltaX: 0,
    deltaY: 0,
    bank: 0,
    entryFrames: 0, // settled: no entry-ramp interference
    parallel: false,
    side: 1,
    active: true,
    facingAway: true,
    ...over,
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// AC-1 — THE SERVO DECIDES ITS ZONE FROM THE POST-DIVIDE SCREEN POSITION (:2749 Y / :2867 X)
// ════════════════════════════════════════════════════════════════════════════════════════════
describe('rb4-16 AC-1 — the window servo runs in POST-DIVIDE screen space, not stored world', () => {
  // The mutation-proof "does the servo look at the pilot AT ALL" test. It names no zone, no table,
  // no constant — it only requires that the eye CHANGE the answer. A stepper that accepts an eye
  // and ignores it (the exact shape we ship today) steps IDENTICALLY under both eyes and fails.
  it('stepWave OBSERVES the eye — the same wave under two far-apart eyes must not step identically', () => {
    const stepWave = need(w.stepWave, 'stepWave(enemies, level, eye)')
    const spawn = need(m.spawn, 'spawn')

    const lvl = 4
    const wave: readonly Enemy[] = [spawn(createRng(7), lvl)]

    // Eyes a billion units apart: whatever the post-divide scale turns out to be, this crosses it.
    const left = stepWave(wave, lvl, [-1e9, 224, 0])
    const right = stepWave(wave, lvl, [+1e9, 224, 0])

    const identical = left[0].x === right[0].x && left[0].deltaX === right[0].deltaX
    expect(
      identical,
      `stepWave produced an IDENTICAL plane under eyes 2e9 units apart (deltaX ${left[0].deltaX} vs ` +
        `${right[0].deltaX}, x ${left[0].x} vs ${right[0].x}). The wave stepper is not threading the ` +
        `pilot down to the servo, so the servo cannot be reading the screen position at all.`,
    ).toBe(false)
  })

  // THE RE-CUT'S SIGNATURE. Post-divide screen = (world − eye) ÷ depth, so it is INVARIANT when
  // the world offset AND the depth are scaled by the same factor. Two planes:
  //     A: x=300, depth=1000, positionZ=1000     screen.x = 300/1000 = 0.3
  //     B: x=600, depth=2000, positionZ=2000     screen.x = 600/2000 = 0.3   ← the SAME screen point
  // A post-divide servo puts A and B in the same zone → same deltaX. A servo that reads the raw
  // WORLD x (today) sees 300 (INNER, |300| < P_ILIM[4]=352) vs 600 (OUTER, |600| ≥ P_OLIM[4]=512):
  // opposite zones, opposite-signed deltaX. A servo on the PRE-divide `displayPos` (the parked
  // premise) also sees 300 vs 600 — so this equality is GREEN only for the post-divide reading,
  // and it does not pin the scale constant (any ×K survives (2a)/(2b) === a/b in IEEE-754).
  it('the servo is DEPTH-DIVIDED: scaling the world offset and the depth together leaves the zone unchanged', () => {
    const step = need(m.step, 'step(enemy, level, eye)')
    const P_ILIM = need(m.P_ILIM, 'P_ILIM')
    const P_OLIM = need(m.P_OLIM, 'P_OLIM')

    const lvl = 4
    const eye: Vec3 = [0, 224, 0] // display.y = 0 (isolates the X servo); display.x = world.x / depth
    // Pin the premise so a table move fails LOUDLY as stale rather than silently testing nothing.
    expect(Math.abs(300), 'premise: the small world x must sit INSIDE the inner window').toBeLessThan(P_ILIM[lvl])
    expect(Math.abs(600), 'premise: the doubled world x must sit AT/BEYOND the outer window').toBeGreaterThanOrEqual(
      P_OLIM[lvl],
    )

    const a = step(plane({ x: 300, depth: 1000, positionZ: 1000 }), lvl, eye)
    const b = step(plane({ x: 600, depth: 2000, positionZ: 2000 }), lvl, eye)

    expect(
      a.deltaX,
      `the two planes project to the SAME post-divide screen point (300/1000 = 600/2000 = 0.3) yet the ` +
        `servo gave them DIFFERENT deltas (${a.deltaX} vs ${b.deltaX}). That means it read the raw WORLD x ` +
        `(300 INNER vs 600 OUTER) — or the pre-divide displayPos — instead of dividing by depth. The ROM's ` +
        `servo reads PLSTAT+8, which POSITH computes AFTER the perspective divide (RBGRND.MAC:296-306).`,
    ).toBe(b.deltaX)
  })

  // The DIRECTION. A plane on the boresight (world x=0), judged by a pilot far to one side, is far
  // off-screen on the OPPOSITE side, so the outer window returns it toward centre; mirror the pilot
  // and the return flips sign. Today the servo reads world x=0 (INNER) for BOTH eyes → the SAME
  // deltaX → the signs are equal, not opposite → RED.
  it('the return is PILOT-relative: mirroring the eye flips the sign of the servo delta', () => {
    const step = need(m.step, 'step(enemy, level, eye)')

    const lvl = 4
    const onLeft = step(plane({ x: 0, positionZ: 1000 }), lvl, [+1e9, 224, 0]) // pilot right → plane far left on screen
    const onRight = step(plane({ x: 0, positionZ: 1000 }), lvl, [-1e9, 224, 0]) // pilot left  → plane far right on screen

    expect(onLeft.deltaX, 'a plane far off-screen must not sit still — the servo returns it').not.toBe(0)
    expect(
      Math.sign(onLeft.deltaX),
      `the same boresight plane returned the SAME way (deltaX ${onLeft.deltaX} vs ${onRight.deltaX}) under ` +
        `pilots on opposite sides. The servo is reading the stored world x=0 for both, not the screen ` +
        `position, so no amount of flying changes which way it weaves (:2909-2910 "PLSTAT − UNIV4X").`,
    ).toBe(-Math.sign(onRight.deltaX))
  })

  // NO HORIZN BIAS in this module (AC-1, rb4-6 settled). Two planes reflected about the pilot's own
  // altitude must get equal-and-opposite deltaY: the Y servo is centred on the EYE, not lifted by a
  // constant. A re-introduced HORIZN term would offset the centre and break the anti-symmetry.
  it('the Y servo carries NO HORIZN term — planes mirrored about the eye altitude get anti-symmetric deltaY', () => {
    const step = need(m.step, 'step(enemy, level, eye)')

    const lvl = 4
    const eyeY = 224
    const above = step(plane({ x: 0, y: eyeY + 50, positionZ: 1000 }), lvl, [0, eyeY, 0])
    const below = step(plane({ x: 0, y: eyeY - 50, positionZ: 1000 }), lvl, [0, eyeY, 0])

    const dyAbove = above.deltaY ?? 0
    const dyBelow = below.deltaY ?? 0
    expect(dyAbove, 'a plane off the boresight vertically must weave — deltaY must not be zero').not.toBe(0)
    expect(
      dyAbove,
      `two planes mirrored about the pilot's altitude (±50) got deltaY ${dyAbove} and ${dyBelow}, which are ` +
        `not equal-and-opposite. The Y servo is not centred on the eye — it is reading world y (today) or ` +
        `a HORIZN-biased screen y. Our display Y is horizon-relative by construction; scene.ts owns HORIZN, ` +
        `this module must not add a term (rb4-6, settled).`,
    ).toBe(-dyBelow)
  })
})

// ════════════════════════════════════════════════════════════════════════════════════════════
// AC-2 — PLONSN: THE DEPTH-SCALED WINDOW THAT DRAGS THE WORLD POSITION (:2877-2937)
// ════════════════════════════════════════════════════════════════════════════════════════════
describe('rb4-16 AC-2 — PLONSN keeps the plane ON SCREEN by clamping in the depth-scaled window', () => {
  // The one byte-pin this suite takes on PLONSN itself: the window magnitude is 0x1A0, not an
  // invented constant. `:2886 LDA I,0A0` with `:2888-2889 LDX I,1 / STX MM.XM` → MM.X = 0x1A0 = 416
  // (the comment says it out loud: ";SCALE WINDOW SIZE (1A0*1A0) BY DEPTH").
  it('the window magnitude is the ROM byte 0x1A0 (:2886-2889), not an invented reach', () => {
    const PLONSN_WINDOW = need(m.PLONSN_WINDOW, 'PLONSN_WINDOW')
    expect(PLONSN_WINDOW).toBe(0x1a0)
    expect(PLONSN_WINDOW).toBe(416)
  })

  // The clamped world position is written back THROUGH the pilot (:2929-2930 "ADC UNIV4X"), so it
  // tracks him downrange — it is NOT pinned to the world origin's ±olim fence. This is the story's
  // title, literally: as shipped, a plane the pilot has flown away from is left ~30000 units off
  // his screen because the ±olim clamp (enemy.ts:453-456, "stands in for PLONSN") pins world to 512.
  it('the clamped WORLD position tracks the pilot (:2929-2930), it is not fenced at the world origin', () => {
    const step = need(m.step, 'step(enemy, level, eye)')
    const P_OLIM = need(m.P_OLIM, 'P_OLIM')

    const eye: Vec3 = [30_000, 224, 0] // the pilot has panned a LONG way downrange
    const after = step(plane({ x: 50_000, positionZ: 4224, depth: 1000 }), 4, eye)

    expect(
      after.x,
      `the pilot is at world x=30000 and the plane ended at world x=${after.x} — pinned near the WORLD ` +
        `ORIGIN's ±P_OLIM fence (${P_OLIM[4]}), which is the stand-in clamp enemy.ts:453-456 admits is not ` +
        `PLONSN. The ROM writes the clamped position back THROUGH the pilot (:2929 "ADC UNIV4X"), so it must ` +
        `follow him. As shipped, this plane is ~30000 units off the pilot's screen.`,
    ).toBeGreaterThan(10_000)
  })

  // The window is a property of DEPTH, not of where the pilot is. Two identical planes far outside
  // the window, judged by pilots 6000 apart, must pin to the SAME |screen| edge (:2921 "SET POSITION
  // TO LIMIT" is assigned in screen space). The ±olim world clamp cannot do this: it pins WORLD to
  // 512, so |display| comes out 512 vs |512−6000| and the two disagree by thousands.
  it('the window is anchored to depth, not the pilot — two eyes pin to the SAME screen edge', () => {
    const step = need(m.step, 'step(enemy, level, eye)')
    const displayPos = need(m.displayPos, 'displayPos')

    const eyeA: Vec3 = [0, 224, 0]
    const eyeB: Vec3 = [6_000, 224, 0]
    const a = Math.abs(displayPos(step(plane({ x: 50_000, positionZ: 4224, depth: 1000 }), 4, eyeA), eyeA).x)
    const b = Math.abs(displayPos(step(plane({ x: 50_000, positionZ: 4224, depth: 1000 }), 4, eyeB), eyeB).x)

    expect(
      Math.abs(a - b),
      `two planes at the same depth pinned to DIFFERENT screen edges (|display| ${a} vs ${b}) purely because ` +
        `the pilot moved. PLONSN's limit is depth-scaled (:2886) and anchored to the pilot (:2909-2910), so ` +
        `the screen edge must not depend on where he is.`,
    ).toBeLessThan(1)
  })

  // The window SCALES WITH DEPTH — a deeper plane is allowed further off-boresight (:2882-2892 loads
  // PLSTAT+19, the POSITION Z, as the multiplier). We pin only the proportionality the ROM's own
  // comment guarantees; Dev derives the fixed-point constant and cites it.
  it('a DEEPER plane is allowed further off-boresight than a shallow one (:2882-2892 depth scale)', () => {
    const step = need(m.step, 'step(enemy, level, eye)')
    const displayPos = need(m.displayPos, 'displayPos')

    const eye: Vec3 = [0, 224, 0]
    const deep = Math.abs(displayPos(step(plane({ x: 90_000, positionZ: 4224, depth: 1000 }), 4, eye), eye).x)
    const near = Math.abs(displayPos(step(plane({ x: 90_000, positionZ: 320, depth: 1000 }), 4, eye), eye).x)

    expect(
      deep,
      `the window did not widen with depth: a plane at positionZ 4224 pinned to |display| ${deep}, one at ` +
        `positionZ 320 to ${near}. PLONSN loads PLANE DEPTH into the multiplier (:2882-2885) and scales the ` +
        `window by it (:2886), so the deeper plane must be allowed further out. The ±olim clamp ignores ` +
        `depth and pins both to the same world fence.`,
    ).toBeGreaterThan(near)
  })

  // The NEGATIVE case — "BCC 40$ ;PLANE W/I WINDOW" (:2920). A plane comfortably on screen must be
  // left where the servo put it; PLONSN clamps, it does not attract toward centre. (A guard: green
  // now AND after — it stops a Dev who satisfies the clamps above by clamping unconditionally.)
  it('a plane already INSIDE the window is left alone — PLONSN clamps, it does not attract (:2920)', () => {
    const step = need(m.step, 'step(enemy, level, eye)')
    const displayPos = need(m.displayPos, 'displayPos')

    // Boresight-adjacent and deep. At GMLEVL 0 the inner target P_IIDL[0] is 0 (a genuine dead
    // stop, enemy.ts:101), so a plane at x=4 barely moves. If PLONSN yanked it to an edge, |display|
    // would jump.
    const eye: Vec3 = [0, 224, 0]
    const after = step(plane({ x: 4, positionZ: 4224, depth: 4224 }), 0, eye)
    const d = displayPos(after, eye)

    expect(
      Math.abs(d.x),
      `a plane 4 units off the boresight ended at |display| ${Math.abs(d.x)} after one frame. It was well ` +
        `inside the window, where the ROM branches out untouched (:2920 "BCC 40$ ;PLANE W/I WINDOW").`,
    ).toBeLessThan(64)
  })
})

// ════════════════════════════════════════════════════════════════════════════════════════════
// AC-3 — THE AD-HOC ±olim WORLD CLAMP IS RETIRED (enemy.ts:453-456)
// ════════════════════════════════════════════════════════════════════════════════════════════
describe('rb4-16 AC-3 — the servo no longer fences the world position at ±P_OLIM', () => {
  // The stand-in clamp (windowServo's `clamp(pos + …, -olim, olim)`) makes |world x| ≤ P_OLIM[level]
  // an invariant. PLONSN replaces it with a SCREEN-space bound, so the world position is free to
  // roam with the pilot. A single frame with a downrange pilot must leave |world x| well beyond olim.
  it('|world x| may exceed P_OLIM[level] once PLONSN (not the ±olim fence) is the bound', () => {
    const step = need(m.step, 'step(enemy, level, eye)')
    const P_OLIM = need(m.P_OLIM, 'P_OLIM')

    const lvl = 4
    const olim = P_OLIM[lvl]
    const after = step(plane({ x: 50_000, positionZ: 4224, depth: 1000 }), lvl, [30_000, 224, 0])

    expect(
      Math.abs(after.x),
      `world |x| came out ${Math.abs(after.x)} ≤ P_OLIM[${lvl}] (${olim}): the ad-hoc ±olim clamp is still ` +
        `fencing the WORLD position at the origin. AC-3 retires it — PLONSN bounds the SCREEN position ` +
        `instead, so the world position tracks the panned pilot far past ${olim}.`,
    ).toBeGreaterThan(olim)
  })
})

// ════════════════════════════════════════════════════════════════════════════════════════════
// AC-4 — OUTER-ZONE DEPTH GATE (:2776-2781) — BLOCKED, see the TEA Assessment's blocking finding
// ════════════════════════════════════════════════════════════════════════════════════════════
describe('rb4-16 AC-4 — outer-zone depth gate', () => {
  // The context/design spec ("positionZ < 4 → flies past off-screen") is the OPPOSITE of the ROM's
  // own comments (positionZ ≥ 4 → ";W/I DEPTH NO RETURN TO SCREEN"; < 4 → ";RETURN TO WARDS SCREEN
  // CENTER", RBARON.MAC:2776-2781), AND the compare is on PLSTAT+19 (the POSITION Z **LSB**), whose
  // "4" has no defined meaning in our world-unit `positionZ`. Both the direction and the threshold
  // must be resolved against the ROM (with the user) before this can be pinned. Guessing either is
  // the exact failure this epic exists to prevent. Filed as a blocking Delivery Finding.
  it.todo('the outer-window return-to-centre is depth-gated on positionZ — BLOCKED on ROM/spec direction conflict')
})

// ════════════════════════════════════════════════════════════════════════════════════════════
// AC-R3 — THE REACHABILITY REGRESSION GUARD (the soft-lock guard, D4/D5)
// ════════════════════════════════════════════════════════════════════════════════════════════
describe('rb4-16 AC-R3 — a plane stays reachable through rb4-17\'s growing gun at every GMLEVL', () => {
  // This is a GUARD, not a RED test: it is GREEN against the current machine and must STAY green
  // through the eye-aware servo + PLONSN. It drives the 3-arg `stepWave(wave, lvl, eye)` (the eye
  // threaded down to the servo, which the current code silently ignores) and judges reach with the
  // REAL `guns.collides` — the same rotated COLLD box that scores kills, bank rotation and all.
  //
  // THE BAR IS THE HONEST CAPTURED BASELINE, measured 2026-07-17 through the CURRENT (rb4-17 COLLD)
  // gun with this exact harness — NOT the stale 597/112/24/20/10.8 that display-space.test.ts:343
  // records from the deleted ±32 gun. Re-measured avg frames-in-reach per plane life (25 seeds ×
  // 600 frames): GMLEVL 0/1/2/3/4 = 600.0 / 208.08 / 44.52 / 32.84 / 17.12. The growing gun catches
  // more than the old tube, exactly as the re-cut predicted (D5). Per-level bar = the floor of that
  // baseline. A GREEN drop below it is a green-phase FINDING to investigate honestly (D5) — NEVER
  // a bar to re-tune down. The soft-lock this guards against scored 0.0-1.0 in rb4-6 round 1.
  const BASELINE: Readonly<Record<number, number>> = { 0: 600, 1: 208, 2: 44, 3: 32, 4: 17 }
  const LEVELS = [0, 1, 2, 3, 4] as const
  const clamp1 = (v: number) => Math.max(-1, Math.min(1, v))

  it.each(LEVELS)('GMLEVL %i: a chasing pilot keeps a plane in the real gun at least the captured baseline', (lvl) => {
    const spawn = need(m.spawn, 'spawn')
    const stepWave = need(w.stepWave, 'stepWave(enemies, level, eye)')
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
          turn: clamp1(d.x / 64),
          pitch: clamp1(d.y / 64),
          proximity: 'far',
        })
        // judge with the gun that scores kills: a boresight shell at the plane's exact depth, so
        // the shell-Z window is satisfied by construction and what this measures is X/Y reach.
        const shell: Shell = { x: 0, y: 0, z: e.depth / 256, active: true }
        if (collides(shell, e, toEye(flight))) framesThisLife++
        wave = stepWave(wave, lvl, toEye(flight)) // eye threaded into the servo (ignored today)
      }
      reachableFrames += framesThisLife
      lives++
    }
    const avg = reachableFrames / lives
    expect(
      avg,
      `GMLEVL ${lvl}: a chasing pilot averaged ${avg.toFixed(2)} frames in gun-reach per plane, below the ` +
        `honest captured baseline ${BASELINE[lvl]} (measured 2026-07-17 through the rb4-17 gun). A drop is a ` +
        `green-phase finding to investigate (D5) — the plane is outrunning the stick, not a bar to re-tune.`,
    ).toBeGreaterThanOrEqual(BASELINE[lvl])
  })

  it('the level ramp cannot strand the player — GMLEVL 2 arrives at 5 kills (PLNLVL coupling)', () => {
    // Why the guard above is CRITICAL: PLNLVL is indexed by kill count, so the player reaches
    // GMLEVL 2 after five kills and can never leave if planes are unreachable there. Pin the REAL
    // export so nobody "fixes" a soft-lock by re-tuning the ramp instead of the seam.
    expect(
      PLNLVL[5],
      'scoring.ts PLNLVL changed — re-derive which GMLEVL the reachability guard must cover',
    ).toBe(2)
  })
})

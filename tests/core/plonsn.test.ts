// tests/core/plonsn.test.ts
//
// Story rb4-16 — RED phase (Furiosa / TEA). "PLONSN, OR THE PLANE ESCAPES THE SCREEN."
//
// rb4-6 moved the RENDER and the GUN into display space and stopped there, on purpose and with
// the measurement to justify it (archive rb4-6-session.md:578-601). The servo itself still
// decides its zone from the plane's STORED WORLD position. The ROM decides from DISPLAY:
//
//     2747:  2$:      LDX I,2              ; X-reg = 2 -> the Y pass
//     2749:           LDA ZX,PLSTAT+8      ; ;PLSTAT+10.  -> ZX is X-INDEXED: +8+2 = PLSTAT+0A
//     2750:           SBC I,HORIZN         ;              -> the Y DISPLAY field, normalized
//     2755:  P.WINDW: STX SAVX             ; ;OFFSET FOR Y DELTA   <- the ROM names the axis
//     2865:  P.WITR:  DEX / DEX            ; X-reg = 0 -> the X pass
//     2867:           LDA ZX,PLSTAT+8      ; ;X DISPLAY   -> +8+0 = PLSTAT+8, loaded RAW
//
// READ THAT INDEXING TWICE. Both passes are the SAME instruction; only the X register differs.
// A `sed` of :2749 shows `LDA ZX,PLSTAT+8` and looks like the X field unless you find the
// `LDX I,2` at :2747. This story's setup fabricated a citation here, and the SM's "correction"
// then asserted the OPPOSITE axis with total confidence. Both were wrong. enemy.ts:114-115 and
// rb4-6's Dev (archive :586-588) had it right the whole time. Do not re-litigate it from a grep.
//
// WHY THE SERVO CANNOT SIMPLY BE MADE EYE-AWARE. rb4-6 BUILT the eye-aware servo and MEASURED it
// before rejecting it: GMLEVL 4 fell to 0.0 avg frames-in-reach, from the shipped 10.8. The
// arithmetic is not subtle (archive :593): the inner-window target run is
//
//     P_IIDL[4] / DELTA_SCALE = (0x40*3) / 4 = 192 / 4 = 48 units/frame
//
// against a pilot whose eye pans at most POT_RANGE = 40 units/frame (flight.ts:107, PAN_SCALE=1).
// 48 > 40. The plane outruns the stick and never comes back. Display-space servo + no bound =
// a soft-lock strictly worse than the world-space one we ship.
//
// PLONSN IS THE MISSING BOUND (RBARON.MAC:2877-2937), and it is not a tuned constant — it is a
// depth-scaled, PFROTN-rotated window that drags the plane's WORLD position so its DISPLAY
// position pins to the window edge:
//
//     2882:  LDA PLSTAT+19        ; PLANE DEPTH        <- the +19/+1A POSITION Z
//     2886:  LDA I,0A0            ; SCALE WINDOW SIZE (1A0*1A0) BY DEPTH
//     2892:  JSR MRSAB0           ; MULTIPLIED         <- limit is PROPORTIONAL to depth
//     2900:  LDY PFROTN / D.COMP / TRIG / MRSLT0
//     2905:                       ; ROTATE WINDOW LIMIT (RESULT,+1 = X,Y LIMIT(S))
//     2906:  LDX I,2              ; per axis: Y (X=2), then X (X=0) via :2934 DEX/DEX/BPL
//     2909:  LDA ZX,PLSTAT / SBC ZX,UNIV4X    ; display = world - pilot
//     2916:  JSR DPABS / CPY RESULT           ; |display| vs the limit
//     2920:  BCC 40$                          ; ;PLANE W/I WINDOW -> leave it alone
//     2921:  LDY RESULT                       ; ;ELSE SET POSITION TO LIMIT
//     2929:  ADC ZX,UNIV4X / STA ZX,PLSTAT    ; write the WORLD position back
//
// FRAME ORDER (:2553-2555): UPDPLN (servo decides delta, position integrates) -> UPDMOB ->
// PLONSN (clamp). PLONSN writes POSITION and never the DELTA. Every deltaX assertion below is
// therefore immune to the clamp, by the ROM's own ordering — that is why they can be written.
//
// ─── CONTRACT for GREEN (The Word Burgers / DEV) ────────────────────────────────────────────
//
// This suite pins BEHAVIOUR and the ROM's contract, NOT the Math Box arithmetic. Deliberately
// left to Dev, because the algebra is real work and this suite must not pre-decide it wrong:
//
//   * THE EXACT WINDOW SCALE. `0x1A0` scaled by depth through MRSAB0, then `RESULT*^100`
//     (:2893-2896), then rotated by PFROTN through MRSLT0. Derive it and cite it. This suite
//     pins only what the ROM's own comment guarantees without the Math Box: the window is
//     PROPORTIONAL to depth, and the clamp pins |display| to the edge rather than past it.
//     If your derivation contradicts a test here, bring the citation — do not re-tune the test.
//
//   * THE EYE'S ROUTE INTO THE SERVO. `step(enemy, level)` and `stepWave(enemies, level)` are
//     eye-free today. The eye must reach the servo somehow; the signature is yours. These tests
//     pass it as a third parameter, which TODAY'S two-arg functions silently ignore — which is
//     exactly why they fail on an ASSERTION rather than a TypeError (the rb4-6 idiom).
//
// ─── OPEN QUESTION — DO NOT GUESS (see the TEA Assessment's blocking finding) ────────────────
//
//   * PLONSN's GATE (:2877-2881) is NOT pinned by this suite. `BIT GMEND0 / BMI 5$` (";KEEP
//     RETURNING ON SCREEN") then `LDA N.PLNZ / CMP I,5 / BCS 50$` (";ELSE ONLY FIRST FOUR").
//     We model NEITHER N.PLNZ (";NUMBER OF PLANES COUNT", :129) nor GMEND0. Worse, the only
//     writes are `STA N.PLNZ` at :2058 — which seeds it to DECIMAL 10 (`LDA I,10.`, note the
//     radix-forcing dot) on the ATTRACT/high-score path — and `INC N.PLNZ` at :2398. Read
//     literally, N.PLNZ >= 5 always, and PLONSN would NEVER run outside the GMEND0 path. That
//     cannot be the shipped behaviour, so a game-start reset exists somewhere we have not
//     traced. The tests below therefore exercise the CLAMP with a single plane and take no
//     position on the gate. Do not invent one to make a test pass.

import { describe, it, expect, beforeAll } from 'vitest'
import { createRng, type Rng } from '@arcade/shared/rng'

type Vec3 = readonly [number, number, number]

interface Enemy {
  readonly kind: 'lead' | 'drone'
  readonly x: number
  readonly y: number
  readonly depth: number
  readonly deltaX: number
  readonly deltaY?: number
  readonly bank: number
  readonly entryFrames?: number
  readonly parallel?: boolean
  readonly side: -1 | 1
  readonly active: boolean
  readonly facingAway: boolean
}

interface EnemyModule {
  /** rb4-16 CONTRACT: `step` must SEE the pilot — the servo reads DISPLAY (:2749/:2867). */
  step?: (enemy: Enemy, level?: number, eye?: Vec3) => Enemy
  spawn?: (rng: Rng, level?: number) => Enemy
  displayPos?: (enemy: Enemy, eye: Vec3) => { x: number; y: number }
  P_OLIM?: readonly number[]
  P_ILIM?: readonly number[]
  P_ODLX?: readonly number[]
  P_IIDL?: readonly number[]
  ACCEL?: number
  P_INDP?: number
}

interface WavesModule {
  /** rb4-16 CONTRACT: the wave stepper must thread the eye down to the servo. */
  stepWave?: (enemies: readonly Enemy[], level?: number, eye?: Vec3) => readonly Enemy[]
}

let m: EnemyModule = {}
let w: WavesModule = {}

beforeAll(async () => {
  // Casts go through `unknown` on purpose — the rb4-6 idiom. These are rb4-16's CONTRACT shapes
  // and they deliberately do not overlap the shipped ones (`step`/`stepWave` take no eye today).
  // A direct cast is a tsc error, and that error would be the RED signal arriving at compile time
  // instead of at the assertion, which helps nobody.
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
})

function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`rb4-16 RED contract: must export ${name}`)
  return value
}

/** A hand-built lead. Every field explicit — no spawn randomness in a zone-algebra test. */
function plane(over: Partial<Enemy> = {}): Enemy {
  return {
    kind: 'lead',
    x: 0,
    y: 224, // mid the [128, 320] UPDPLN altitude band, so the Y clamp is not the thing under test
    depth: 0x1080, // P.INDP
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
// AC-2 — THE SERVO READS THE DISPLAY POSITION (RBARON.MAC:2749 Y / :2867 X)
// ════════════════════════════════════════════════════════════════════════════════════════════
describe('rb4-16 AC-2 — the window servo decides its zone from DISPLAY, not from stored WORLD', () => {
  // The whole story in one assertion. Same plane, same level; the ONLY difference between the
  // world reading and the display reading is the pilot's eye — and they select DIFFERENT ZONES,
  // whose target deltas point in OPPOSITE DIRECTIONS. So the sign of the resulting deltaX is a
  // total discriminator between "servo read world" and "servo read display". No tolerance, no
  // magic number: just which way the plane decided to go.
  //
  // GMLEVL 4:  olim = P_OLIM[4] = 0x200 = 512     ilim = P_ILIM[4] = 0x160 = 352
  //            P_ODLX[4] = 0x80*2 = 256           P_IIDL[4] = 0x40*3 = 192       ACCEL = 0x30 = 48
  //
  //   world x = +100          -> |100| < 352      -> INNER  -> "HEAD AWAY FROM CENTER" (:2794)
  //                              heading = +1, target = P_IIDL[4] = +192  -> deltaX steps to +48
  //   display = 100 - (-500)  -> |600| >= 512     -> OUTER  -> "RETURN TO CENTER LIMIT" (:2939)
  //                              heading = -1, target = P_ODLX[4] = -256  -> deltaX steps to -48
  //
  // Both magnitudes are ACCEL — the servo cannot cross a 192/256 gap in one frame either way —
  // so magnitude proves nothing and ONLY the sign does. That is deliberate: it means this test
  // cannot be satisfied by a scale tweak, only by reading the right position.
  it('the ZONE flips with the eye: an inner-window WORLD plane that is OUTER on screen turns toward centre', () => {
    const step = need(m.step, 'step(enemy, level, eye)')
    const P_OLIM = need(m.P_OLIM, 'P_OLIM')
    const P_ILIM = need(m.P_ILIM, 'P_ILIM')

    const lvl = 4
    const worldX = 100
    const eye: Vec3 = [-500, 224, 0] // display.x = 100 - (-500) = 600; display.y = 0 (eye at plane's altitude)

    // Pin the premise itself — if the tables ever move, this test must fail LOUDLY as a stale
    // premise rather than silently testing nothing. (rb4-6 R3 lesson: a literal compared to
    // itself is not a guard; these are the REAL exports.)
    expect(Math.abs(worldX), 'premise: the WORLD position must sit INSIDE the inner window').toBeLessThan(P_ILIM[lvl])
    expect(Math.abs(600), 'premise: the DISPLAY position must sit AT/BEYOND the outer window').toBeGreaterThanOrEqual(
      P_OLIM[lvl],
    )

    const after = step(plane({ x: worldX, deltaX: 0 }), lvl, eye)

    expect(
      after.deltaX,
      `the servo accelerated deltaX to ${after.deltaX}. Positive means it read the stored WORLD x=+100, ` +
        `called it the INNER window and headed AWAY from centre (P_IIDL). The ROM reads the DISPLAY ` +
        `position (+600 with this eye), which is OUTSIDE the outer window, and heads back TOWARD ` +
        `centre at P_ODLX (RBARON.MAC:2749 Y / :2867 X / :2939 "RETURN TO CENTER LIMIT").`,
    ).toBeLessThan(0)
  })

  // The mirror case. Without this, "return a negative deltaX at GMLEVL 4" is a one-line cheat
  // that passes the test above. Here the display sits INSIDE the inner window while the world is
  // OUTER, so the correct answer flips sign — a hardcode that satisfies one fails the other.
  it('and flips back: an OUTER-in-world plane that is INNER on screen heads AWAY from centre', () => {
    const step = need(m.step, 'step(enemy, level, eye)')
    const P_OLIM = need(m.P_OLIM, 'P_OLIM')
    const P_ILIM = need(m.P_ILIM, 'P_ILIM')

    const lvl = 4
    const worldX = 600 // |600| >= olim 512 -> OUTER in world -> heading -1 -> deltaX steps to -48
    const eye: Vec3 = [500, 224, 0] // display.x = 600 - 500 = 100 -> INNER -> heading +1 -> +48

    expect(Math.abs(worldX), 'premise: the WORLD position must sit AT/BEYOND the outer window').toBeGreaterThanOrEqual(
      P_OLIM[lvl],
    )
    expect(Math.abs(100), 'premise: the DISPLAY position must sit INSIDE the inner window').toBeLessThan(P_ILIM[lvl])

    const after = step(plane({ x: worldX, deltaX: 0 }), lvl, eye)

    expect(
      after.deltaX,
      `the servo accelerated deltaX to ${after.deltaX}. Negative means it read the stored WORLD x=+600 ` +
        `as OUTER and turned back toward centre. On SCREEN the plane is at +100 — inside the inner ` +
        `window — where the ROM reverses AWAY from centre (:2794 "REVERSE FLAG (HEAD AWAY FROM CENTER)").`,
    ).toBeGreaterThan(0)
  })

  // A pure observation test: does the stepper LOOK at the eye at all? This is the "drive the eye
  // through step/stepWave" contract in its most mutation-resistant form. It names no zone, no
  // table and no constant — it only requires that the eye CHANGE the answer. An implementation
  // that accepts an eye parameter and ignores it (the exact shape we ship today) fails here.
  it('stepWave OBSERVES the eye — the same wave under two different eyes must not step identically', () => {
    const stepWave = need(w.stepWave, 'stepWave(enemies, level, eye)')
    const spawn = need(m.spawn, 'spawn')

    const lvl = 4
    const wave: readonly Enemy[] = [spawn(createRng(7), lvl)]

    const left = stepWave(wave, lvl, [-500, 224, 0] as Vec3)
    const right = stepWave(wave, lvl, [+500, 224, 0] as Vec3)

    expect(
      left[0].deltaX === right[0].deltaX && left[0].x === right[0].x,
      `stepWave produced an IDENTICAL plane under eyes 1000 units apart (deltaX ${left[0].deltaX} vs ` +
        `${right[0].deltaX}, x ${left[0].x} vs ${right[0].x}). The wave stepper is not threading the ` +
        `pilot down to the servo, so the servo cannot be reading DISPLAY coordinates. This is the ` +
        `"drive the eye through step/stepWave" contract (rb4-6 archive :599-601).`,
    ).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════════════════════════
// AC-1 — PLONSN: THE DEPTH-SCALED WINDOW THAT DRAGS THE WORLD POSITION (:2877-2937)
// ════════════════════════════════════════════════════════════════════════════════════════════
describe('rb4-16 AC-1 — PLONSN keeps the plane ON SCREEN by moving its WORLD position', () => {
  // The bound that makes an eye-aware servo survivable. Without it the plane outruns the stick
  // (48 units/frame vs the pilot's 40) and GMLEVL 4 measures 0.0 frames-in-reach — MEASURED by
  // rb4-6, not theorised (archive :589-593).
  // THE DISCRIMINATOR, and it took a failed first draft to find it. An earlier version of this
  // test asserted only "the world position changed" under a zero-X eye — and it PASSED on the
  // unported code, because the ±olim clamp we ship (enemy.ts:430-433, which admits it "stands in
  // for PLONSN, which we do not model") drags x from 50000 to 512 all by itself, and a zero eye
  // makes world and display identical. It proved nothing.
  //
  // What separates PLONSN from that stand-in is WHERE the bound is anchored. The ±olim clamp
  // pins to the WORLD ORIGIN. PLONSN pins to the PILOT and writes the result back through him:
  //
  //     2929:  ADC ZX,UNIV4X        ; ADD TO UNIVERSE CENTER
  //     2930:  STA ZX,PLSTAT        ; SET PLANE POSITION
  //
  // so the stored world position is (limit + the pilot's own). Pan the pilot far downrange and
  // the two answers diverge without limit: ours stays pinned near 0, the ROM's follows him.
  it('the dragged WORLD position is written back THROUGH the pilot (:2929-2930 "ADC UNIV4X")', () => {
    const step = need(m.step, 'step(enemy, level, eye)')
    const P_OLIM = need(m.P_OLIM, 'P_OLIM')

    const eye: Vec3 = [30_000, 224, 0] // the pilot has turned a LONG way downrange
    const after = step(plane({ x: 50_000, deltaX: 0 }), 4, eye)

    // PLONSN lands the plane at (limit ± the pilot). Whatever the limit is, the result must be in
    // the pilot's neighbourhood — not parked at the world origin's ±olim fence.
    expect(
      after.x,
      `the pilot is panned to x=30000 and the plane ended at world x=${after.x} — pinned near the ` +
        `WORLD ORIGIN's ±P_OLIM fence (${P_OLIM[4]}), which is the stand-in clamp enemy.ts:430-433 ` +
        `admits is not PLONSN. The ROM writes the clamped position back THROUGH the pilot ` +
        `(:2929-2930 "ADC UNIV4X / STA PLSTAT"), so it must track him downrange. As shipped, this ` +
        `plane is ~30000 units off the pilot's screen — the story's title, literally.`,
    ).toBeGreaterThan(10_000)
  })

  it('the window is anchored to the PILOT — same depth, different eyes, the SAME screen edge', () => {
    const step = need(m.step, 'step(enemy, level, eye)')
    const displayPos = need(m.displayPos, 'displayPos')

    // Two identical planes, same depth, both far outside the window — judged by pilots 6000 units
    // apart. PLONSN assigns the limit in SCREEN space (:2921 "ELSE SET POSITION TO LIMIT"), so
    // both must pin to the SAME |display|: the edge is a property of depth, not of where the
    // pilot happens to be. This needs no knowledge of what the limit IS — only that it is the
    // same one twice. The ±olim world clamp cannot do this: it pins WORLD to 512, so |display|
    // comes out 512-vs-|512-6000| and the two disagree wildly.
    const eyeA: Vec3 = [0, 224, 0]
    const eyeB: Vec3 = [6_000, 224, 0]

    const a = Math.abs(displayPos(step(plane({ x: 50_000, deltaX: 0 }), 4, eyeA), eyeA).x)
    const b = Math.abs(displayPos(step(plane({ x: 50_000, deltaX: 0 }), 4, eyeB), eyeB).x)

    expect(
      Math.abs(a - b),
      `two planes at the same depth pinned to DIFFERENT screen edges (|display| ${a} vs ${b}) purely ` +
        `because the pilot moved. PLONSN's window is depth-scaled (:2886) and anchored to the pilot ` +
        `(:2909-2910 "PLSTAT - UNIV4X"), so the screen edge must not depend on where he is.`,
    ).toBeLessThan(1)
  })

  it('the window SCALES WITH DEPTH — a deeper plane is allowed further off-boresight (:2882-2892)', () => {
    const step = need(m.step, 'step(enemy, level, eye)')
    const displayPos = need(m.displayPos, 'displayPos')

    // ";SCALE WINDOW SIZE (1A0*1A0) BY DEPTH" (:2886) with MM.A = the plane's depth (:2882-2885)
    // and `JSR MRSAB0` (:2892). We do NOT pin the Math Box's fixed-point here — only the
    // proportionality the ROM's own comment guarantees. Dev derives the constant and cites it.
    const eye: Vec3 = [0, 224, 0]
    const deep = step(plane({ x: 90_000, depth: 0x1080, deltaX: 0 }), 4, eye) // P.INDP = 4224
    const near = step(plane({ x: 90_000, depth: 0x0140, deltaX: 0 }), 4, eye) // P.MNDP = 320

    const deepEdge = Math.abs(displayPos(deep, eye).x)
    const nearEdge = Math.abs(displayPos(near, eye).x)

    expect(
      deepEdge,
      `the window did not widen with depth: a plane at P.INDP (0x1080) pinned to |display| ${deepEdge}, ` +
        `one at P.MNDP (0x140) to ${nearEdge}. PLONSN loads the PLANE DEPTH into the multiplier ` +
        `(:2882-2885) and scales the window by it (:2886 ";SCALE WINDOW SIZE (1A0*1A0) BY DEPTH"), so ` +
        `the deeper plane must be allowed further out.`,
    ).toBeGreaterThan(nearEdge)
  })

  // The NEGATIVE case — "BCC 40$ ;PLANE W/I WINDOW" (:2920). Guards against a Dev who satisfies
  // the tests above by clamping unconditionally. A plane comfortably on screen must be left
  // exactly where the servo put it; PLONSN must not touch it.
  it('a plane already INSIDE the window is left alone — PLONSN does not pull it toward centre (:2920)', () => {
    const step = need(m.step, 'step(enemy, level, eye)')
    const displayPos = need(m.displayPos, 'displayPos')

    // Boresight-adjacent and shallow: inside any sane window. Compare against a run with the
    // servo's own arithmetic, so this measures PLONSN's meddling and nothing else.
    const eye: Vec3 = [0, 224, 0]
    const onScreen = plane({ x: 4, deltaX: 0, depth: 0x1080 })
    const after = step(onScreen, 0, eye)
    const d = displayPos(after, eye)

    // At GMLEVL 0 the inner target P_IIDL[0] is 0 — a genuine dead stop (enemy.ts:96-101) — so a
    // plane at x=4 barely moves. If PLONSN yanked it to some edge, |display| would jump.
    expect(
      Math.abs(d.x),
      `a plane 4 units off the boresight ended up at |display| ${Math.abs(d.x)} after one frame. ` +
        `It was already well inside the window, where the ROM branches out untouched ` +
        `(:2920 "BCC 40$ ;PLANE W/I WINDOW"). PLONSN must clamp, not attract.`,
    ).toBeLessThan(64)
  })
})

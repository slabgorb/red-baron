// tests/core/depth-scale.test.ts
//
// Story rb4-1 — RED, round 2. THE ENUMERATION.
//
// ─── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────
//
// Twice now this branch has been rejected for the same bug, and twice it was fixed as
// an instance rather than a class. The Thought Police named it exactly:
//
//     "Point-fixing the ones the Reviewer happens to name is not a method — it is
//      waiting to be told, and it produces exactly this: a fix that lands and breaks
//      the next instance of the same bug."
//
// rb4-1 multiplied the depth axis by 3.91x (P.INDP 1080 -> 0x1080 = 4224). Every constant
// measured IN DEPTH was silently invalidated. Round 1 caught two by hand (CLOSE_SPEED,
// SHELL_RANGE_DEPTH). Fixing those broke a third (SHELL_DRAW_FAR) and missed a fourth
// (WHINE_HALF_DEPTH). Nobody had ever ENUMERATED them.
//
// I enumerated them. SEVEN constants are denominated in depth, and FOUR of them are still
// wrong — twice what the review found by hand. The two nobody had looked at:
//
//   * blimp.ts CRUISE_DEPTH = 600 — its own comment calls it "a visible mid-field
//     distance". Against the old 1080 spawn, 600 WAS mid-field (56%). Against the true
//     4224 it is 14% — the airship now cruises in the player's face. Same signature as
//     SHELL_DRAW_FAR: a comment asserting an invariant the number stopped satisfying.
//
//   * biplane.ts LOD_DISTANCE = 1500 — the near/full vs far/drone switch, fed enemy.depth
//     at main.ts:198. Under the OLD axis the plane spawned at 1080 < 1500, so it was ALWAYS
//     full-detail: the far-drone LOD was DEAD CODE and had never once rendered. The radix
//     sweep silently switched it on. That may even be authentic (the ROM does have the
//     split, findings §7) — but nobody CHOSE it, and an accident is not a decision.
//
// And the sweep turned up one more thing worth more than either: scoring.BONUS_DEPTH_MSB
// (registry 7/7). The flat-300 "dim plane" gate sits at 0x10 * S.DPTH = 4096 of world depth,
// and the plane spawns at 4224. CB-003 — this story's headline mechanic — clears its own
// gate by 128 units out of 4224. A 3% margin, load-bearing, and nothing tested it.
//
// ─── THE RULE, AND WHY IT IS THE WHOLE STORY ────────────────────────────────────
//
// Look at what separates every correct depth constant from every broken one. It is not
// the value. It is whether the number KNOWS WHAT IT IS MEASURED IN:
//
//     SHELL_RANGE_DEPTH = S_MAXZ * S_DPTH   derived from the ROM        correct
//     NEAR_DEPTH        = P_INDP / 4        derived from the axis       correct
//     SPAWN_DEPTH       = 0x7f00            transcribed from the ROM    correct
//     ---------------------------------------------------------------------------
//     SHELL_DRAW_FAR    = 800               a bare decimal              WRONG
//     WHINE_HALF_DEPTH  = 200               a bare decimal              WRONG
//     CRUISE_DEPTH      = 600               a bare decimal              WRONG
//     LOD_DISTANCE      = 1500              a bare decimal              unjustified
//
// A bare decimal in the depth axis is a number that has forgotten its unit. That is this
// epic's thesis — "a number is meaningless without the context it is denominated in" —
// and it is the SAME failure as reading a hex literal as decimal. The radix bug and the
// depth-scale bug are one bug wearing two hats.
//
// Dev DISCOVERED this rule under test pressure (NEAR_DEPTH/MID_DEPTH were tied to P_INDP
// "so the depth scale and the bands can never drift apart again" — enemy.ts:96) and then
// did not generalise it to the constants no test was looking at. So the suite will look.
//
//     A depth-denominated constant must be DERIVED from the depth axis, or TRANSCRIBED
//     from the ROM with a citation. Never a bare decimal literal.
//
// This is statically checkable, it is not gameable by renaming, and — unlike a Reviewer —
// it does not get tired. It catches the fifth and sixth on its own, and it will catch the
// seventh, which is the only thing that actually ends this.
//
// ─── HONEST LIMITS (this header will not overclaim; the last one did and was rightly
// flagged) ──────────────────────────────────────────────────────────────────────
//
// The discovery sweep is a heuristic over source text, not a type system. It finds a
// candidate by its NAME (…_DEPTH, …_DISTANCE, …_FAR, LOD_…, CRUISE_…) or by its USE
// (appearing in an expression alongside a `depth` identifier). A constant that is
// depth-denominated but named `FOO` and only ever used via a variable called `d` would
// slip through both. That gap is real and I am naming it rather than papering over it.
// The REGISTRY below is the backstop: it is curated, and it is the artefact the story owes.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { P_INDP, proximityBand } from '../../src/core/enemy'
import { P_MNDP } from '../../src/core/returning-ace'
import {
  S_MAXZ, S_DPTH, SHELL_RANGE_DEPTH, shellSegments, shellDepth, type Shell,
} from '../../src/core/guns'
import { biplaneLOD } from '../../src/core/biplane'
import { spawn as spawnBlimp } from '../../src/core/blimp'
import { sceneProjection } from '../../src/core/scene'
import { scoreKill, DRONE_SCORE } from '../../src/core/scoring'
import { approachWhine } from '../../src/shell/audio'
import { createRng } from '@arcade/shared/rng'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const srcRoot = join(repoRoot, 'src')

/** The reference frame these registry entries are measured in (rb4-1: see screen-scale.test.ts). */
const ASPECT = 16 / 9

/** Every .ts file under src/, recursively. */
function srcFiles(dir: string = srcRoot): readonly string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return srcFiles(full)
    return full.endsWith('.ts') ? [full] : []
  })
}

// ─────────────────────────────────────────────────────────────────────────────────
// THE AXIS
// ─────────────────────────────────────────────────────────────────────────────────
//
// Depth is the axis the plane flies down. It is DEFINED by two ROM constants, and every
// other depth-denominated number in the game is a statement about this interval.

describe('the depth axis is defined by the ROM, and everything else is measured against it', () => {
  it('the plane flies between P.MNDP (its floor) and P.INDP (its spawn)', () => {
    expect(P_MNDP).toBe(0x140) // 320  — closest it can EVER get
    expect(P_INDP).toBe(0x1080) // 4224 — where it appears
    expect(P_MNDP).toBeLessThan(P_INDP)
  })

  it('the sweep grew this axis 3.91x — which is what invalidated every depth constant', () => {
    // The decimal misreads the port shipped with. Kept as an executable record of the
    // scale change, because the scale change is the CAUSE of everything in this file.
    expect(P_INDP / 1080).toBeCloseTo(3.91, 2)
    expect(P_INDP).not.toBe(1080) // the decimal misread
    expect(P_MNDP).not.toBe(140) // ditto
  })
})

// ─────────────────────────────────────────────────────────────────────────────────
// THE REGISTRY — the enumeration the Thought Police demanded, as executable properties
// ─────────────────────────────────────────────────────────────────────────────────
//
// Each entry is a PROPERTY, not a value. Dev may pick any number that satisfies the
// property; Dev may not pick a number that does not. Where the ROM settles it, the ROM
// settles it; where it does not, the constant must at least be denominated in the axis so
// it can never drift from it again.

describe('REGISTRY 1/7 — guns.SHELL_RANGE_DEPTH: the gun reaches what the ROM says', () => {
  it('is derived from the ROM (S.MAXZ x S.DPTH), not invented', () => {
    expect(SHELL_RANGE_DEPTH).toBe(S_MAXZ * S_DPTH)
    expect(SHELL_RANGE_DEPTH).toBe(6400)
    expect(SHELL_RANGE_DEPTH).not.toBe(800) // the invented reach we shipped
  })

  it('outranges the spawn — you may fire on sight', () => {
    expect(SHELL_RANGE_DEPTH).toBeGreaterThan(P_INDP)
  })
})

describe('REGISTRY 2/7 — enemy.NEAR_DEPTH / MID_DEPTH: the DISCHK bands (the model to copy)', () => {
  // These are the two Dev got RIGHT, and the reason is visible in the source: they are
  // written as fractions of P_INDP. This test pins the TECHNIQUE, so that the one place
  // the codebase already does the right thing cannot quietly regress to bare numbers.
  it('are expressed as fractions of the axis, not as bare numbers', () => {
    const enemy = readFileSync(join(srcRoot, 'core', 'enemy.ts'), 'utf8')
    expect(enemy, 'NEAR_DEPTH must stay tied to P_INDP').toMatch(/NEAR_DEPTH\s*=\s*P_INDP\s*\//)
    expect(enemy, 'MID_DEPTH must stay tied to P_INDP').toMatch(/MID_DEPTH\s*=\s*\(?\s*P_INDP\s*[*)]/)
    expect(enemy, 'the pre-sweep bare cutoffs must not come back').not.toMatch(
      /(NEAR|MID)_DEPTH\s*=\s*\d+\s*$/m,
    )
  })

  it('every band is REACHABLE by a plane that actually flies — through proximityBand()', () => {
    // SELF-CHECK CAUGHT THIS ONE. My first draft recomputed `const NEAR = P_INDP / 4` inside
    // the test and asserted things about THAT — which is an arithmetic fact about two
    // literals, not a claim about enemy.ts. Dev could have set NEAR_DEPTH = P_INDP / 100 and
    // it would still have passed. A test that recomputes the value it is checking is testing
    // itself.
    //
    // The cutoffs are module-private, so go through the real exported function instead. This
    // is the bug they were fixed for, stated behaviourally: at 300/700 against a 4224 axis
    // the plane floored at 320 — ABOVE the 300 'near' cutoff — so 'near' could never fire.
    // A band outside the flight envelope is a band that does not exist.
    expect(proximityBand(P_MNDP), 'a plane at its FLOOR must read as near').toBe('near')
    expect(proximityBand(P_INDP), 'a plane at its SPAWN must read as far').toBe('far')

    // …and 'mid' must be reachable somewhere in between — the band cannot be squeezed to zero.
    const bands = new Set<string>()
    for (let d = P_MNDP; d <= P_INDP; d += 16) bands.add(proximityBand(d))
    expect(
      bands,
      'all three DISCHK bands must occur across the flight the plane actually flies',
    ).toEqual(new Set(['near', 'mid', 'far']))
  })
})

describe('REGISTRY 3/7 — SHELL_DRAW_FAR: the tracer is drawn where it kills [HIGH]', () => {
  // THE CONSTANT NO LONGER EXISTS, and that is the fix. It was a hand-copied mirror of the gun's
  // reach living in main.ts, whose comment promised it would track SHELL_RANGE_DEPTH; it did not,
  // because copies do not track anything. The conversion is now a FUNCTION in the module that
  // owns the shell (guns.shellDepth), and the projection that spends it (guns.shellSegments) has
  // moved out of main.ts to sit beside it — so there is nothing left to keep in sync.
  //
  // THIS ENTRY USED TO BE TWO REGEXES OVER main.ts ("no SHELL_DRAW_FAR", "no 800"). They are
  // DELETED. The Reviewer defeated them, and their replacement is in tests/core/tracer-seam.ts:
  // fire real shells at a real plane, take the Hit, and RECOVER THE DEPTH FROM THE DRAWN
  // GEOMETRY. What is left here is the registry's own one-line claim, stated the same way — as a
  // measurement, not as a spelling.
  it('a spent shell is DRAWN at the gun\'s reach — measured off the projected tracer', () => {
    const proj = sceneProjection(ASPECT)
    const spent: Shell = { x: 4, y: 0, z: S_MAXZ, gun: 'right', active: true }
    const [seg] = shellSegments(spent, proj)
    // ndc.x = mvp[0] * x / depth  =>  depth = mvp[0] * x / ndc.x   (x = ±MUZZLE_X, never 0)
    const drawnDepth = (proj[0] * spent.x) / seg.x1
    expect(
      drawnDepth,
      'a shell at S.MAXZ is at the end of its range; it must be DRAWN at SHELL_RANGE_DEPTH ' +
        '(6400), not at the invented 800 the shipped mirror drew it at.',
    ).toBeCloseTo(SHELL_RANGE_DEPTH, 6)
    expect(drawnDepth).toBeCloseTo(shellDepth(S_MAXZ), 6) // …the same number the gun kills with
  })
})

describe('REGISTRY 4/7 — audio.WHINE_HALF_DEPTH: the approach whine can reach its design point', () => {
  // audio-dispatch.ts:86 feeds `world.nearestDepth` — the depth of the closest live plane —
  // straight into approachWhine(). It is unambiguously on this axis.
  //
  // WHINE_HALF_DEPTH = 200 sets where the whine is HALF strength. The plane's floor is 320.
  // So the half-strength point sits BELOW the closest the plane can ever fly: the whine's
  // entire design curve lives in a region the game cannot reach. Peak gain achievable is
  // 0.135 of a possible 0.35 — and it is monotone, so it never gets louder than that.
  it('a plane at its CLOSEST is well up the whine sweep — the design point is reachable', () => {
    // rb4-10 (SN-014): the whine's intensity is PITCH, not gain — nearer ⇒ higher pitch at a
    // FLAT volume. The "reachable design point" intent is unchanged: WHINE_HALF_DEPTH tied to
    // the axis (P_INDP/4) puts the plane's whole reachable range across the sweep, where the
    // old bare 200 sat BELOW the plane's floor. So the plane at its closest genuinely SINGS.
    const idle = approachWhine(Number.POSITIVE_INFINITY).frequency // clear sky = the hum pitch
    const closest = approachWhine(P_MNDP).frequency
    expect(
      closest,
      `a plane at P.MNDP (${P_MNDP}) is as close as it will EVER get, and the whine should be ` +
        `well up its pitch sweep — not stuck near the idle hum the way the old bare 200 left it.`,
    ).toBeGreaterThan(idle * 1.5)
  })

  it('and its PITCH still falls off with distance — the ordering is the ROM fact (SN-014)', () => {
    // The negative case: farther ⇒ lower pitch. A clear sky idles at the HUM pitch, not silence.
    expect(approachWhine(P_MNDP).frequency).toBeGreaterThan(approachWhine(P_INDP).frequency)
    expect(approachWhine(P_INDP).frequency).toBeGreaterThan(approachWhine(P_INDP * 4).frequency)
    expect(approachWhine(Number.POSITIVE_INFINITY).frequency).toBeCloseTo(63920 / (2 * (0xf8 + 1)), 0)
  })

  it('is not a bare decimal — it is denominated in the axis', () => {
    const audio = readFileSync(join(srcRoot, 'shell', 'audio.ts'), 'utf8')
    expect(
      audio,
      'WHINE_HALF_DEPTH = 200 was calibrated against the 1080-deep world. Tie it to the axis ' +
        '(P_MNDP / P_INDP) the way enemy.ts ties its DISCHK bands, so it cannot drift again.',
    ).not.toMatch(/WHINE_HALF_DEPTH\s*=\s*\d+\s*$/m)
  })
})

describe('REGISTRY 5/7 — blimp entry depth: RE-SEATED by rb4-15 (CRUISE_DEPTH is retired)', () => {
  // THE ENTRY'S HISTORY: the sweep found CRUISE_DEPTH = 600 as a bare decimal that had
  // forgotten its unit; rb4-1 re-derived it as P_INDP / 2 ("mid-field"). rb4-15 then found
  // the whole CRUISE was the wrong machine — the ROM blimp does not cruise at ALL. It
  // ENTERS at Z = 0x1000 = 4096 (INITBP, RBARON.MAC:1425-1426) and CLOSES 0x80 per
  // calc-frame (BLMOTN :4259-4265). The mid-field property below is therefore INVERTED:
  // the airship enters DEEP — above 3/4 of the plane's own spawn depth — and earns its
  // close-ups by flying at you.
  it('enters at the ROM depth — transcribed, not tuned, and DEEP on the axis', () => {
    const blimp = spawnBlimp(createRng(3), ASPECT)
    expect(blimp.depth, 'INITBP: Z MSB = 0x10, LSB = 0 → 0x1000').toBe(0x1000)
    expect(
      blimp.depth,
      `the drifter's "mid-field" band [P_INDP/4, 3·P_INDP/4] is the OLD machine's premise — ` +
        `the ROM enters the airship at 4096/${P_INDP} = 97% of the plane's spawn depth.`,
    ).toBeGreaterThan((P_INDP * 3) / 4)
  })

  it('every frame of the approach stays inside the gun\'s reach — it only ever gets EASIER to hit', () => {
    // 0x1000 = 4096 < SHELL_RANGE_DEPTH = 6400 at entry, and the depth only DECREASES from
    // there — the whole life is shootable. (The drifter needed this pinned at its one cruise
    // depth; the approach makes it a monotone consequence of the entry.)
    const blimp = spawnBlimp(createRng(3), ASPECT)
    expect(blimp.depth).toBeLessThan(SHELL_RANGE_DEPTH)
  })

  it('is not a bare decimal — the ROM constants carry the ROM\'s own hex spelling', () => {
    const blimp = readFileSync(join(srcRoot, 'core', 'blimp.ts'), 'utf8')
    expect(blimp, 'CRUISE_DEPTH is retired with the drifter (rb4-15)').not.toMatch(
      /CRUISE_DEPTH\s*=/,
    )
    expect(blimp, 'the entry depth is the ROM\'s 0x1000, spelled in hex').toMatch(
      /BLIMP_Z_START\s*=\s*0x1000\b/,
    )
    expect(blimp, 'and a bare decimal 4096 invites the next radix accident').not.toMatch(
      /BLIMP_Z_START\s*=\s*\d+\s*$/m,
    )
  })
})

describe('REGISTRY 6/7 — biplane LOD: RETIRED from the depth axis (rb4-13 — it was never on it)', () => {
  // THE ENTRY'S HISTORY, kept because each round teaches the failure mode of the last:
  //   round 1 (sweep)    LOD_DISTANCE = 1500 — a bare decimal; drone model DEAD CODE (never
  //                      rendered in the shipped game until the radix sweep moved the axis).
  //   round 2            = P_INDP * 3/8 — axis-derived, still meaningless: 1500 + 0*P_INDP
  //                      passed every assertion (the Reviewer's finding 4).
  //   round 3 (rb4-1)    derived from LOD_APPARENT_SPAN, measured through the real projection —
  //                      the best-argued version of a test THE ROM NEVER MAKES.
  //
  // rb4-13 ends the line: DRNPIC (RBARON.MAC:4961-4970, `.RADIX 16` set at :74) reads
  // `LDA PLSTAT+6 / AND I,10` — bit 0x10, D4, the ORIENTATION bit, cleared at :2652
  // `;D4=0 (PLANE FACING AWAY)`. Bit clear → the 29-point .DRPNT drone + DB.MAR front
  // list; bit set → the full model + DB.MAP back faces. NO depth compare exists anywhere
  // in the picture path. So this registry entry's duty INVERTS: it no longer derives the
  // constant — it pins that the model switch is not denominated in depth AT ALL. No
  // constant, no axis to drift beneath it. The rule itself is pinned where it lives:
  // tests/core/biplane.test.ts (the unit matrix) and tests/core/enemy.test.ts (the seam
  // + the D4 lifecycle).
  it('LOD_DISTANCE is GONE from biplane.ts — the switch has no depth left to be wrong about', () => {
    const biplane = readFileSync(join(srcRoot, 'core', 'biplane.ts'), 'utf8')
    expect(
      biplane,
      'rb4-13: the ROM picks the plane model on PLSTAT+6 bit 0x10 (DRNPIC, RBARON.MAC:4961), ' +
        'not on a depth threshold. LOD_DISTANCE was our invention — retire it, do not re-derive it.',
    ).not.toContain('LOD_DISTANCE')
  })

  it('enemy.ts no longer cites the retired constant as precedent for a tunable', () => {
    const enemy = readFileSync(join(srcRoot, 'core', 'enemy.ts'), 'utf8')
    expect(
      enemy,
      'enemy.ts:83 cited "biplane.ts\'s LOD_DISTANCE" as precedent for WEAVE_SPEED_CAP. The ' +
        'precedent is retracted (rb4-13); the citation must go with it.',
    ).not.toContain('LOD_DISTANCE')
  })

  it('the switch answers to ORIENTATION — both models reachable at any single depth', () => {
    // The positive half of the retirement, at the registry level: the bit alone picks
    // the model. (The full same-depth/two-orientations matrix and the D4 lifecycle live
    // in biplane.test.ts / enemy.test.ts.)
    expect(biplaneLOD(true).points).toHaveLength(29) // D4=0 — facing away → .DRPNT drone
    expect(biplaneLOD(false).points).toHaveLength(42) // D4=1 — rotated toward → full plane
  })
})

describe('REGISTRY 7/7 — scoring.BONUS_DEPTH_MSB: the flat-300 gate sits just under the spawn', () => {
  // Found by the sweep, and it turned out to be the most load-bearing number in the story.
  //
  // PLNSCR pays the flat DRNPNT ("XTRA POINTS IF DIM") only while the plane's depth MSB is
  // >= 0x10 (`CPX I,10`). In world depth that gate is 0x10 * S_DPTH = 4096. The plane spawns
  // at P.INDP = 4224. It clears the gate by 128 units out of 4224 — a 3% margin.
  //
  // THAT is why a freshly-spawned plane is worth 300, and it is the whole of CB-003. Nothing
  // tested it. If P.INDP were 4095, or if either constant drifted a hair, the far snipe would
  // silently stop paying and every scoring test would still pass — because they all call
  // scoreKill() with depths they chose themselves.
  const DIM_GATE = 0x10 * S_DPTH // 4096 — PLNSCR's `CPX I,10`, expressed in world depth

  it('a plane at its SPAWN depth is "dim" — proven through the real scoreKill, not arithmetic', () => {
    // Go through the SCORING FUNCTION, not through numbers I typed myself. The gate is
    // private to scoring.ts; what is observable — and what the player actually receives — is
    // the payout. So ask for the payout.
    expect(scoreKill('lead', P_INDP), 'the spawn depth must pay the flat DRNPNT').toBe(DRONE_SCORE)

    // …and the gate is exactly where the ROM puts it: one unit under it, the flat 300 stops.
    // This pins the MARGIN, which is the fragile part — 4224 clears 4096 by 128 units, 3%.
    expect(scoreKill('lead', DIM_GATE)).toBe(DRONE_SCORE)
    expect(scoreKill('lead', DIM_GATE - S_DPTH)).toBeLessThan(DRONE_SCORE)
    expect(P_INDP - DIM_GATE).toBe(128) // the entire headroom CB-003 has
  })

  it('…and the gun can REACH the far side of that gate — else the 300 is unpayable', () => {
    // Ties the three constants together: the scoring gate, the depth axis, and the gun reach.
    // Break any one and the far/dim kill stops existing. This is the invariant the whole
    // story is FOR, and it has never been stated in one place.
    expect(SHELL_RANGE_DEPTH).toBeGreaterThan(DIM_GATE)
    expect(SHELL_RANGE_DEPTH).toBeGreaterThan(P_INDP)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────
// THE COMPLETENESS GUARD — so the EIGHTH one cannot slip in
// ─────────────────────────────────────────────────────────────────────────────────

/** A constant declared in src/, with its initializer text. */
interface Decl {
  readonly file: string
  readonly line: number
  readonly name: string
  readonly init: string
  /** The doc comment / trailing comment attached to it, if any. */
  readonly context: string
}

/** Every `const NAME = <init>` in src/ whose initializer is a single-line expression. */
function declarations(): readonly Decl[] {
  const out: Decl[] = []
  for (const file of srcFiles()) {
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      const m = /^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*(.+?)\s*(?:\/\/.*)?$/.exec(
        line,
      )
      if (!m) return
      // The preceding doc comment block, for the ROM citation check.
      const context = lines
        .slice(Math.max(0, i - 12), i + 1)
        .join('\n')
      out.push({
        file: relative(repoRoot, file),
        line: i + 1,
        name: m[1],
        init: m[2].replace(/,$/, ''),
        context,
      })
    })
  }
  return out
}

/** Names that ANNOUNCE a depth denomination. */
const DEPTH_NAME = /(_|^)(DEPTH|DIST|DISTANCE|FAR|NEAR|RANGE)(_|$)|^(LOD|CRUISE)_/

/**
 * Only a NUMBER can be denominated in a unit. `NEAR_MODEL` / `FAR_MODEL` (biplane.ts's two
 * LOD meshes) trip the name pattern but are objects — there is no axis they could be wrong
 * against. Filtering them out structurally, rather than adding them to an exception list,
 * keeps the exception lists honest: those should hold JUDGEMENT CALLS, not type errors.
 *
 * Stated as a negative so a DERIVED constant still counts — `P_INDP / 4` is number-valued
 * even though it does not begin with a digit, and it is the very form we are pushing Dev
 * toward. A predicate that demanded a leading digit would reject the correct answer.
 */
const isNumberValued = (init: string): boolean => !/^[{['"`]|=>|^new\b|^Object\b/.test(init.trim())

/**
 * Names the sweep flags that are NOT world depths at all — and the reason each is not.
 *
 * This list is itself a finding. "DEPTH" and "RANGE" mean TWO DIFFERENT THINGS in this
 * codebase: `WHINE_HALF_DEPTH` is a distance down the Z axis, while `GUN_STROBE_DEPTH` is
 * an audio MODULATION depth — a gain coefficient in 0..1. One identifier, two unrelated
 * quantities, exactly the collision class that got `MIN_DEPTH` renamed to `P_MNDP` in this
 * very story. The sweep cannot tell them apart from the name, and neither can a human
 * skim-reading the file, which is the whole problem.
 *
 * So they get classified ONCE, here, with a reason. That is the point of an enumeration:
 * not that every candidate is a bug, but that every candidate has been LOOKED AT.
 */
const NOT_A_DEPTH: ReadonlyMap<string, string> = new Map([
  [
    'GUN_STROBE_DEPTH',
    'shell/audio.ts — an audio MODULATION depth (a 0..1 gain coefficient on the gun strobe), ' +
      'not a distance. Same word, different axis, no relation to P_INDP.',
  ],
  [
    'ENTRY_NDC_RANGE',
    'blimp.ts — the lateral entry window, in NDC. Not the depth axis — the SCREEN axis, which ' +
      'is the second class of denominated constant and has its own registry: ' +
      'tests/core/screen-scale.test.ts. (It was ENTRY_X_RANGE, a bare 120 world units, and it ' +
      'was one of the constants that broke when the depth axis moved — see finding 1.)',
  ],
  [
    'SPAWN_NDC_Y_RANGE',
    'blimp.ts — the vertical spawn spread, in NDC. SCREEN axis; registered in screen-scale.ts.',
  ],
  [
    'SPAWN_Y_RANGE',
    'enemy.ts — the vertical spawn spread in screen-window Y. Not a depth. It IS on the screen ' +
      'axis, and it is NOT yet denominated there — see screen-scale.ts, which registers it and ' +
      'says so out loud rather than letting it pass as classified.',
  ],
  [
    'LOD_APPARENT_SPAN',
    'biplane.ts — a TOMBSTONE (rb4-13). Was the apparent-size threshold the depth switch was ' +
      'derived from; the ROM picks the model on the PLSTAT+6 D4 orientation bit (DRNPIC, ' +
      'RBARON.MAC:4961), so the whole apparatus is retired. Kept here so that reintroducing ' +
      'the NAME lands it back in this sweep instantly instead of passing as unexamined.',
  ],
  [
    'POT_RANGE',
    'flight.ts — the pot yoke\'s full-deflection TURN-RATE range (PLDELX units the POT.X step ' +
      'eases toward), added by rb4-5 replacing the invented MAX_TURN cap. Trips the sweep on ' +
      '`RANGE`, but it is an angular RATE on the control axis, not a distance down Z — no relation ' +
      'to P_INDP. (RBARON.MAC:5897-5926 POT.X; rb4-5 AC4.)',
  ],
])

/**
 * Constants that ARE depth-denominated but which rb4-1 does NOT own. Each must carry a
 * reason and an owner — this is a short, named list, not a wildcard opt-out. (An
 * exemption list that anyone can grow is the same disease as a `"skip": true` flag; see
 * tests/audit/citation-evidence.test.ts.)
 */
const NOT_THIS_STORY: ReadonlyMap<string, string> = new Map([
  [
    'HORIZON_DISTANCE',
    "horizon.ts — invented 10000 where the ROM says HORZ = 0x1000. Wiring HORZ/HORIZN is rb4-5's " +
      'explicit AC ("HORIZN is added to the projected Y of EVERY object (POSITH)"). rb4-1 leaves ' +
      'it dead, as it found it.',
  ],
  [
    'FAR',
    'scene.ts — INERT. projectSegment (scene.ts:56-60) reads only rows 0/1/3 of the MVP and ' +
      'discards clip-z; nothing in src/shell/ depth-culls. Proven by TEA in round 1 and accepted ' +
      'by the Reviewer as LOW. It cannot produce a visible defect at any value.',
  ],
  [
    'NEAR',
    'scene.ts — INERT, for the same reason as FAR: the near plane is never tested against.',
  ],
])

/** The constants this story's registry above has looked at and OWNS. */
const REGISTERED: ReadonlySet<string> = new Set([
  'SHELL_RANGE_DEPTH',
  'NEAR_DEPTH',
  'MID_DEPTH',
  // SHELL_DRAW_FAR — a TOMBSTONE. The constant is gone (rb4-1 round 3): a hand-copied mirror of
  // the gun reach cannot be made safe, only deleted. The conversion is guns.shellDepth and the
  // projection that spends it is guns.shellSegments, both tested. Kept in the set so that
  // reintroducing the NAME re-arms the bare-decimal guard on it instantly.
  'SHELL_DRAW_FAR',
  'WHINE_HALF_DEPTH',
  // CRUISE_DEPTH — a TOMBSTONE (rb4-15, like SHELL_DRAW_FAR above). The cruise was the wrong
  // MACHINE: the ROM blimp enters at BLIMP_Z_START = 0x1000 and closes 0x80/calc-frame
  // (INITBP :1425-1426, BLMOTN :4259-4265) — there is no constant depth to denominate. Kept
  // in the set so that reintroducing the NAME re-arms the bare-decimal guard on it instantly.
  'CRUISE_DEPTH',
  // LOD_DISTANCE — a TOMBSTONE (rb4-13, like SHELL_DRAW_FAR above). The switch it fed is
  // ORIENTATION-keyed (PLSTAT+6 D4 — DRNPIC, RBARON.MAC:4961); no depth constant may replace
  // it. Kept in the set so that reintroducing the NAME re-arms the bare-decimal guard on it
  // instantly — and registry 6/7 fails on the name's mere presence in biplane.ts.
  'LOD_DISTANCE',
  'BONUS_DEPTH_MSB', // ROM-exact (PLNSCR `CPX I,10`) — registry 7/7
])

describe('COMPLETENESS — every depth-denominated constant is enumerated, or the suite says so', () => {
  it('every candidate the sweep finds has been CLASSIFIED — nothing is merely unexamined', () => {
    // This is the guard that ends the cycle. It does not demand a fix; it demands that
    // somebody has LOOKED. A new constant whose name puts it on the depth axis must land in
    // exactly one of three buckets — registered (and derived), not-a-depth (with a reason),
    // or not-this-story (with an owner) — and until it does, the suite will not go green.
    //
    // Round 1 the Reviewer named two by hand. Round 2 he found a third and a fourth. This
    // finds the fifth, sixth and seventh WITHOUT a Reviewer, which is the only version of
    // this that scales past the next person's attention span.
    const unclassified = declarations()
      .filter((d) => DEPTH_NAME.test(d.name))
      .filter((d) => isNumberValued(d.init)) // an object cannot be denominated in anything
      .filter(
        (d) => !REGISTERED.has(d.name) && !NOT_A_DEPTH.has(d.name) && !NOT_THIS_STORY.has(d.name),
      )
      // A constant transcribed straight from the ROM, with its citation, is self-classifying.
      .filter((d) => !/RBARON\.MAC|RBGRND\.MAC/.test(d.context))
      .map((d) => `${d.file}:${d.line}  ${d.name} = ${d.init}`)

    expect(
      unclassified,
      'A constant whose name puts it on the DEPTH axis is not accounted for anywhere.\n\n' +
        'Decide which it is and say so in tests/core/depth-scale.test.ts:\n' +
        '  * a real depth      -> add it to REGISTERED, derive it from the axis, give it a property\n' +
        '  * not a depth       -> add it to NOT_A_DEPTH with the reason (see GUN_STROBE_DEPTH)\n' +
        "  * someone else's    -> add it to NOT_THIS_STORY with the owning story\n\n" +
        'Do not skip this by renaming the constant. The point is not the name — it is that the ' +
        'number knows what it is measured in.\n',
    ).toEqual([])
  })

  it('no REGISTERED depth constant is a bare decimal literal', () => {
    // THE RULE. A bare decimal in the depth axis is a number that has forgotten its unit —
    // which is the same disease as a hex literal read as decimal. Legitimate forms:
    //   * derived      — `P_INDP / 4`, `S_MAXZ * S_DPTH`   (references the axis)
    //   * transcribed  — `0x7f00` with an RBARON.MAC citation (it IS the ROM's own number)
    const BARE_DECIMAL = /^-?\d+(\.\d+)?$/

    const offenders = declarations()
      .filter((d) => REGISTERED.has(d.name))
      .filter((d) => BARE_DECIMAL.test(d.init))
      .filter((d) => !/RBARON\.MAC|RBGRND\.MAC/.test(d.context)) // a cited ROM value is legitimate
      .map((d) => `${d.file}:${d.line}  ${d.name} = ${d.init}`)

    expect(
      offenders,
      'These constants are measured in DEPTH but written as bare decimals, so they were ' +
        'calibrated against whatever the depth axis happened to be when someone typed them — ' +
        'and rb4-1 just moved that axis 3.91x underneath them.\n\n' +
        'Derive each from the axis (P_INDP / P_MNDP / a ROM constant), the way enemy.ts does:\n' +
        '    const NEAR_DEPTH = P_INDP / 4\n' +
        'or transcribe it from RBARON.MAC with a citation. Do NOT just multiply it by 3.91 — ' +
        'that fixes the instance and leaves the class.\n',
    ).toEqual([])
  })

  it('no constant is used in depth arithmetic without announcing that it is a depth', () => {
    // The other half of the sweep: catch a depth constant whose NAME hides it. Any ALL-CAPS
    // constant that appears in an expression alongside a `depth` identifier is a candidate.
    // (This is the check that would have caught LOD_DISTANCE even had it been named `LIMIT`.)
    const known = new Set([
      ...declarations()
        .filter((d) => DEPTH_NAME.test(d.name))
        .map((d) => d.name),
      ...NOT_THIS_STORY.keys(),
      // The axis itself, and the ROM constants that define it.
      'P_INDP',
      'P_MNDP',
      // DRINZ — rb4-6. The DRONE's spawn depth (RBARON.MAC:466 "DRONE INITIAL Z", .RADIX 16),
      // seeded by `LDA I,DRINZ/100 / STA P.1ST+5` (:2369-2370) — the depth MSB, so 0x1600. It is a
      // position ON the axis, transcribed from the ROM with a citation rather than derived from
      // P_INDP, and it is a ROM NAME: renaming it to DRONE_SPAWN_DEPTH to satisfy the sweep would
      // trade the provenance for the spelling. Registered here for the same reason P_INDP is.
      'DRINZ',
      'S_MAXZ',
      'S_DPTH',
      'SPAWN_DEPTH',
      'MIN_DEPTH',
      'P_OBDZ',
      'PF_FALLEN_DZ',
      // P_MAXZ — rb4-8. The mountain on→fallen Z threshold (RBARON.MAC:445 `P.MAXZ =1001`,
      // .RADIX 16 → 0x1001 = HORZ+1). A position ON the depth axis, transcribed with a
      // citation like SPAWN_DEPTH/S_MAXZ, not derived — the latch flips when depth < P_MAXZ.
      'P_MAXZ',
      'PFOBIZ_DEPTHS',
      'BONUS_DEPTH_MSB', // scoring.ts — the ROM's own depth-MSB gate (PLNSCR)
      'HORZ',
      // rb4-1 round 3 — two OBJECT DIMENSIONS that legitimately appear in depth arithmetic.
      // Neither is a position on the depth axis; both are LENGTHS read off a model's own
      // vertices, and both are classified in the screen registry (screen-scale.test.ts).
      //
      //   PLANE_SPAN        biplane.ts — the plane's wingspan (80 units, from PLANE_POINTS).
      //                     Divided BY the frustum at a depth to get apparent size; it is the
      //                     numerator, not the axis.
      //   BLIMP_HULL_RADIUS blimp.ts — the airship's bounding radius (40, from BLIMP_POINTS).
      //                     Added to a depth to reach the FAR side of the hull, so the despawn
      //                     never deletes an airship whose tail is still on screen.
      'PLANE_SPAN',
      'BLIMP_HULL_RADIUS',
      // PICTURE_SCALE — rb4-17. The ROM's DIMENSIONLESS ×4 vertex lift (POINTP stores .X*2/.Y*4,
      // ZAXIS lifts X once more — RBARON.MAC POINTP macro / RBGRND.MAC:469-495). It legitimately
      // appears beside a depth in planeModel's arithmetic (the dual-Z size compensation,
      // PICTURE_SCALE × positionZ / depth) but is a pure ratio, not a position on the axis —
      // rescaling it with the axis would be the mirror bug, exactly as for PLANE_SPAN above.
      'PICTURE_SCALE',
      // V_BRIT_MAX — rb4-9. The AVG intensity CEILING (0xF0), not a position on the depth axis. It
      // appears beside `depth` in `depthIntensity` because that function MAPS a depth to an
      // intensity (`;INTENSITY SET TO DEPTH`, RBARON.MAC:4550-4557) — depth is the input, V_BRIT_MAX
      // is the output range. A brightness, not a distance; rescaling it with the axis is the mirror
      // bug, exactly as for PICTURE_SCALE. Classified in scene.ts, tested in tests/core/intensity.test.ts.
      'V_BRIT_MAX',
    ])

    const unannounced: string[] = []
    for (const file of srcFiles()) {
      const text = readFileSync(file, 'utf8')
      text.split('\n').forEach((line, i) => {
        if (/^\s*[/*]/.test(line)) return // a comment, not code
        if (!/\bdepth\b/i.test(line)) return
        for (const m of line.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) {
          const name = m[1]
          if (known.has(name)) continue
          if (/^(NaN|POSITIVE_INFINITY|NEGATIVE_INFINITY|MAX_SAFE_INTEGER|EPSILON)$/.test(name)) continue
          unannounced.push(`${relative(repoRoot, file)}:${i + 1}  ${name}  in: ${line.trim()}`)
        }
      })
    }

    expect(
      unannounced,
      'A constant is being used in depth arithmetic but its name does not announce that it is a ' +
        'depth, so the enumeration above cannot see it. Either rename it (…_DEPTH / …_DISTANCE / ' +
        '…_RANGE) so the sweep catches it, or add it to the registry with a justification.\n',
    ).toEqual([])
  })
})

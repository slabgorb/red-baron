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
import { LOD_DISTANCE, LOD_APPARENT_SPAN, apparentSpan, biplaneLOD, PLANE_POINTS } from '../../src/core/biplane'
import { spawn as spawnBlimp } from '../../src/core/blimp'
import { sceneProjection, projectSegment } from '../../src/core/scene'
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
  it('a plane at its CLOSEST is at least half strength — the design point is reachable', () => {
    // Derive the ceiling from the function itself (gain at depth 0 = "on top of you") rather
    // than hardcoding 0.35. Self-check: a pinned 0.35 would silently stop meaning "half" the
    // moment anyone retuned the curve, which is the same class of rot this file is about.
    const ceiling = approachWhine(0).gain
    const closest = approachWhine(P_MNDP).gain
    expect(
      closest,
      `a plane at P.MNDP (${P_MNDP}) is as close as it will EVER get, and the whine should be ` +
        `singing. WHINE_HALF_DEPTH = 200 sits BELOW that floor, so the half-strength point ` +
        `lies outside the range the plane can occupy and the whine never exceeds 38% of full.`,
    ).toBeGreaterThanOrEqual(ceiling / 2)
  })

  it('and it still FALLS OFF with distance — the ordering is the ROM fact (findings §6B)', () => {
    // The negative case, so "just crank the gain" cannot satisfy the test above.
    expect(approachWhine(P_MNDP).gain).toBeGreaterThan(approachWhine(P_INDP).gain)
    expect(approachWhine(P_INDP).gain).toBeGreaterThan(approachWhine(P_INDP * 4).gain)
    expect(approachWhine(Number.POSITIVE_INFINITY).gain).toBe(0) // a clear sky is silent
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

describe('REGISTRY 5/7 — blimp.CRUISE_DEPTH: the airship cruises mid-field, as its own comment says', () => {
  // FOUND BY THE SWEEP. Nobody had looked at this one.
  //
  // main.ts:303 adapts the blimp to the same Enemy-shaped target guns.collides consumes, so
  // blimp.depth is the SAME axis the plane flies down. Its doc comment claims "a visible
  // mid-field distance" — true at 600/1080 (56%), false at 600/4224 (14%).
  it('spawns in the mid-field of the axis, not in the player\'s face', () => {
    // "Mid-field" is a range, not a number — Dev picks the number; the property is that it
    // is genuinely mid-field on the CORRECTED axis, and derived from it.
    const blimp = spawnBlimp(createRng(3), ASPECT)
    expect(
      blimp.depth,
      `the airship's own comment calls its cruise depth "a visible mid-field distance". On the ` +
        `corrected axis (spawn ${P_INDP}), 600 is 14% — that is not mid-field, that is nose-on.`,
    ).toBeGreaterThanOrEqual(P_INDP / 4)
    expect(blimp.depth).toBeLessThanOrEqual((P_INDP * 3) / 4)
  })

  it('stays inside the gun\'s reach — a blimp you cannot shoot is not a target', () => {
    const blimp = spawnBlimp(createRng(3), ASPECT)
    expect(blimp.depth).toBeLessThan(SHELL_RANGE_DEPTH)
  })

  it('is not a bare decimal — it is denominated in the axis', () => {
    const blimp = readFileSync(join(srcRoot, 'core', 'blimp.ts'), 'utf8')
    expect(blimp, 'CRUISE_DEPTH = 600 predates the corrected axis').not.toMatch(
      /CRUISE_DEPTH\s*=\s*\d+\s*$/m,
    )
  })
})

describe('REGISTRY 6/7 — biplane.LOD_DISTANCE: the switch has a SIZE, not just a range [MEDIUM]', () => {
  // FOUND BY THE SWEEP, then found WANTING by the Reviewer (finding 4) — and he was right.
  //
  // Old axis: the plane spawned at 1080 < 1500, so biplaneLOD returned the 42-vertex near model
  // for the plane's entire flight and the 29-vertex drone had NEVER RENDERED in the shipped game.
  // The radix sweep switched it on by accident. Round 2 "fixed" that by writing
  // LOD_DISTANCE = P_INDP * 3 / 8 — which references the axis, satisfies the bare-decimal guard,
  // and is still worth NOTHING, because:
  //
  //     LOD_DISTANCE = 1500 + 0 * P_INDP
  //
  // restores the pre-sweep value, passes every assertion this registry entry had, and ships
  // green. The three tests below (in/inside the band, drone at spawn, plane at the floor) hold
  // IDENTICALLY at 1500 and at 1584. They only ever asked the number to land SOMEWHERE inside
  // the flight envelope, and every number in a 3,900-unit interval does.
  //
  // A bound is not a property. So the constant was given a MEANING instead: an LOD switch is a
  // statement about APPARENT SIZE — "swap to the cheap model once the plane is too small on
  // screen for the detail to read". That is written in screen units (LOD_APPARENT_SPAN: a
  // fraction of the frame's half-height) and the DEPTH IS DERIVED FROM IT. Now there is a number
  // to be wrong about, and it is measured through the real projection of the real vertices.
  //
  // HONEST — read this before treating the green as coverage: what is pinned is the RELATION
  // (the switch happens at a known apparent size), NOT the value. 0.08 is a playtest choice; the
  // ROM ships both models but does not pin the switch (findings §7). Retuning it in SCREEN units
  // is legitimate and the depth will follow. What is now impossible is the actual bug: the depth
  // axis moving underneath the constant and changing what the player sees, silently, in green.
  it('both LODs actually fire during a real approach — the switch is inside the flight band', () => {
    expect(LOD_DISTANCE).toBeGreaterThan(P_MNDP) // else the plane is ALWAYS a drone
    expect(LOD_DISTANCE).toBeLessThan(P_INDP) // else the drone model is dead code (the old bug)
  })

  it('a plane at spawn draws as the far drone; at its floor, as the full 42-vertex plane', () => {
    expect(biplaneLOD(P_INDP).points).toHaveLength(29) // dim and distant
    expect(biplaneLOD(P_MNDP).points).toHaveLength(42) // on top of you
  })

  it('THE PROPERTY 1500 FAILS: the switch happens at the plane\'s stated APPARENT SIZE', () => {
    // Measure the plane's wingspan where the LOD flips — not from the constant, but by
    // PROJECTING ITS REAL VERTICES through the REAL sceneProjection, the way it is drawn.
    const projectedSpanAt = (depth: number): number => {
      const proj = sceneProjection(ASPECT)
      const halfSpan = Math.max(...PLANE_POINTS.map((p) => Math.abs(p[0]))) // wing tip, x = 40
      const seg = projectSegment([-halfSpan, 0, -depth], [halfSpan, 0, -depth], proj)
      // NDC width in units of the frame's HALF-HEIGHT (aspect-free — undo the /aspect in mvp[0]).
      return Math.abs(seg!.x2 - seg!.x1) * ASPECT
    }

    expect(
      projectedSpanAt(LOD_DISTANCE),
      'at the LOD switch the plane must subtend exactly LOD_APPARENT_SPAN of the frame — that ' +
        'is what LOD_DISTANCE is DEFINED as, and this measures it through the real projection.',
    ).toBeCloseTo(LOD_APPARENT_SPAN, 6)

    // …and the same number, straight out of the module's own helper (so the definition and the
    // drawing cannot part company either).
    expect(apparentSpan(LOD_DISTANCE)).toBeCloseTo(LOD_APPARENT_SPAN, 6)

    // THE REFUTATION. This is the assertion the round-2 constant could not have made. At the
    // pre-sweep 1500 the plane subtends 0.0924 of the frame, not 0.08 — a different apparent
    // size, and now a different, FAILING number. `LOD_DISTANCE = 1500 + 0 * P_INDP` dies here.
    expect(projectedSpanAt(1500)).not.toBeCloseTo(LOD_APPARENT_SPAN, 3)
    expect(projectedSpanAt(1584)).not.toBeCloseTo(LOD_APPARENT_SPAN, 3) // …and so does 3/8 P_INDP
  })

  it('is not a bare decimal — it is denominated in APPARENT SIZE, and derived from it', () => {
    const biplane = readFileSync(join(srcRoot, 'core', 'biplane.ts'), 'utf8')
    expect(
      biplane,
      'LOD_DISTANCE = 1500 is a bare number against a 4224 axis. It happens to land in the ' +
        'flight band, but it landed there BY ACCIDENT. Denominate it so the next sweep cannot ' +
        'silently move it in or out of range.',
    ).not.toMatch(/LOD_DISTANCE\s*=\s*\d+\s*$/m)
    // …and the honest form: it is DERIVED from the screen threshold, not fitted to it.
    expect(biplane, 'LOD_DISTANCE must be derived from LOD_APPARENT_SPAN').toMatch(
      /LOD_DISTANCE\s*=\s*[^\n]*LOD_APPARENT_SPAN/,
    )
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
    'biplane.ts — trips this sweep on `^LOD_`, but it is not a depth at all: it is the LOD ' +
      "switch's threshold in APPARENT SIZE (a fraction of the frame's half-height). It is what " +
      'LOD_DISTANCE (a real depth, registry 6/7) is DERIVED FROM. Screen axis — screen-scale.ts.',
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
  'CRUISE_DEPTH',
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
      'S_MAXZ',
      'S_DPTH',
      'SPAWN_DEPTH',
      'MIN_DEPTH',
      'P_OBDZ',
      'PF_FALLEN_DZ',
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

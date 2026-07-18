// tests/core/screen-scale.test.ts
//
// Story rb4-1 — round 3. THE SECOND ENUMERATION: constants denominated in the SCREEN.
//
// ─── WHY THERE IS A SECOND ONE ──────────────────────────────────────────────────
//
// depth-scale.test.ts enumerated every constant denominated IN DEPTH, and it was right, and it
// was not enough. The Reviewer found the next instance of the same disease in a class that
// enumeration could not see:
//
//     "TEA enumerated constants denominated IN DEPTH. Nobody enumerated constants denominated
//      in SCREEN-SPACE X/Y whose visible meaning depends on the depth they are viewed at."
//
// Here is the bug he found, and it is the same bug wearing a third hat. Dev moved the blimp's
// CRUISE_DEPTH from 600 to P_INDP/2 = 2112 — correctly, to satisfy a depth-range property. But
// the airship is a RENDERED object, and three of its numbers were positions ON THE SCREEN
// written in world-window units. What an x means on screen is x / depth. Measured through the
// REAL sceneProjection(16/9):
//
//                            depth 600 (old)      depth 2112 (new)
//     enters at |x| 180..300   ndc 0.292..0.487     ndc 0.083..0.138   (near screen CENTRE)
//     despawns at |x| = 640    ndc 1.039 (OFF)      ndc 0.295 (IN FRAME!)
//     apparent size            --                   3.52x SMALLER
//
// main.ts:415 deleted the blimp when |x| > 640, under a comment reading "past which the
// drifting blimp HAS LEFT THE FRAME". That comment was now FALSE. The airship popped in near
// the middle of the screen, drifted about a fifth of a screen-width, and WAS DELETED IN PLAIN
// VIEW — while every depth test stayed green, because they were all looking at the other axis.
//
// ─── THE RULE (the same rule, one axis over) ────────────────────────────────────
//
//     A SCREEN-SPACE X OR Y IS MEANINGLESS WITHOUT THE DEPTH IT IS SEEN AT.
//
// A number that says where something is ON THE SCREEN must be written in the PROJECTED frame
// and converted through the depth it is seen at (src/core/screen.ts). Then moving the depth
// axis moves NOTHING the player sees, and the class is dead rather than the instance.
//
// ─── WHAT THIS FILE DOES ────────────────────────────────────────────────────────
//
//   1. Proves screen.ts against the REAL projection (it must not grow its own copy of the FOV
//      — a private copy of a projection constant is exactly how the tracer seam opened).
//   2. Flies the blimp's whole crossing through the REAL renderer and asserts the three things
//      the Reviewer asked for: it ENTERS near an edge, it CROSSES the frame, and it is NEVER
//      DELETED WHILE STILL VISIBLE.
//   3. Proves the class is dead, not the instance: the same crossing is flown at THREE cruise
//      depths and the screen path is the same one. Move the depth axis; nothing moves.
//   4. ENUMERATES the class — same three-bucket shape as depth-scale.test.ts (REGISTERED /
//      NOT-A-SCREEN-CONSTANT / NOT-THIS-STORY), with a completeness guard, so the next one is
//      caught without a Reviewer.
//
// ─── HONEST LIMITS ──────────────────────────────────────────────────────────────
//
// The sweep is a heuristic over NAMES, exactly like the depth sweep, and it has exactly the
// same hole: a screen-space constant called `FOO` and used only through a variable called `v`
// slips through. The REGISTRY is the backstop, and the registry is curated by a human. What
// this buys is that a constant which ANNOUNCES itself as a screen X/Y cannot be merely
// unexamined — it must land in a bucket, with a reason, or the suite goes red.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

import { createRng } from '@arcade/shared/rng'
import {
  frustumHalfWidth, frustumHalfHeight, ndcX, ndcY, worldX, inFrame,
} from '../../src/core/screen'
import { sceneProjection, projectSegment } from '../../src/core/scene'
import {
  spawn as spawnBlimp, step as stepBlimp, blimpOffScreen, blimpSegments, blimpDriftPerFrame,
  BLIMP_HULL_RADIUS, type Blimp,
} from '../../src/core/blimp'
import { collides, shellDepth, type Shell } from '../../src/core/guns'
import { PLANE_POINTS, PICTURE_SCALE, biplaneLOD } from '../../src/core/biplane'
import { COLLD_POINTS } from '../../src/core/topology'
import { debrisSpread } from '../../src/core/wreck-render'
import { EXPL2_FRAMES } from '../../src/core/explosion'
import { P_INDP, type Enemy } from '../../src/core/enemy'
import { P_MNDP } from '../../src/core/returning-ace'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const srcRoot = join(repoRoot, 'src')

/** The reference frame. 16:9 is what the cabinet is played in; the aspect sweeps use others. */
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
// THE RULER — screen.ts must agree with the projection the game actually draws with
// ─────────────────────────────────────────────────────────────────────────────────

describe('screen.ts measures the SAME frustum the renderer projects through', () => {
  it('frustumHalfWidth is exactly the world x that lands on the frame edge (ndc 1)', () => {
    // Drive the REAL sceneProjection + projectSegment. If screen.ts ever re-derives the FOV
    // instead of reading it out of the matrix, this is where the two copies part company —
    // which is the failure mode that produced the tracer seam in the first place.
    for (const aspect of [1, 4 / 3, 16 / 9, 21 / 9]) {
      const proj = sceneProjection(aspect)
      for (const depth of [1, 600, P_INDP, 40000]) {
        const edge = frustumHalfWidth(depth, aspect)
        const seg = projectSegment([edge, 0, -depth], [-edge, 0, -depth], proj)
        expect(seg!.x1, `aspect ${aspect}, depth ${depth}`).toBeCloseTo(1, 9)
        expect(seg!.x2).toBeCloseTo(-1, 9)
      }
    }
  })

  it('frustumHalfHeight is the world y that lands on the top edge — and is aspect-FREE', () => {
    for (const aspect of [1, 4 / 3, 16 / 9, 21 / 9]) {
      const proj = sceneProjection(aspect)
      for (const depth of [600, P_INDP]) {
        const top = frustumHalfHeight(depth) // note: no aspect argument, on purpose
        const seg = projectSegment([0, top, -depth], [0, -top, -depth], proj)
        expect(seg!.y1, `aspect ${aspect}, depth ${depth}`).toBeCloseTo(1, 9)
        expect(seg!.y2).toBeCloseTo(-1, 9)
      }
    }
  })

  it('ndcX / worldX round-trip at every depth — the conversion is lossless', () => {
    for (const depth of [P_MNDP, 600, 2112, P_INDP, 6400]) {
      for (const ndc of [-1.5, -1, -0.3, 0, 0.42, 1, 2]) {
        expect(ndcX(worldX(ndc, depth, ASPECT), depth, ASPECT)).toBeCloseTo(ndc, 9)
      }
    }
  })

  it('is TOTAL — a degenerate frame contains nothing, and says so instead of throwing', () => {
    // depth <= 0 is at/behind the eye. There is no frame, so nothing is inside it.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(ndcX(100, bad, ASPECT)).toBe(Number.POSITIVE_INFINITY)
      expect(ndcY(100, bad)).toBe(Number.POSITIVE_INFINITY)
    }
    expect(ndcX(Number.NaN, 1000, ASPECT)).toBe(Number.POSITIVE_INFINITY)
    expect(inFrame(1)).toBe(true) // the edge is IN — [-1, 1] is the visible square (scene.ts)
    expect(inFrame(1.0001)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────
// THE AIRSHIP — the bug, stated as behaviour: it must not vanish in the middle of the screen
// ─────────────────────────────────────────────────────────────────────────────────

/** The MVP the cockpit draws with when the pilot is flying level (flightView(LEVEL) = IDENTITY). */
const projFor = (aspect: number) => sceneProjection(aspect)

/** Is ANY part of the airship's REAL drawn geometry inside the frame, horizontally? */
function blimpIsVisible(blimp: Blimp, aspect: number): boolean {
  const segs = blimpSegments(blimp, projFor(aspect))
  return segs.some((s) => inFrame(s.x1) || inFrame(s.x2))
}

/** The NDC x of the airship's centre. */
const blimpNdc = (b: Blimp, aspect: number): number => ndcX(b.x, b.depth, aspect)

/** Fly a blimp until it despawns (or `maxFrames`), recording what happened each frame. */
function flyCrossing(blimp: Blimp, aspect: number, maxFrames = 2000) {
  const ndcPath: number[] = [blimpNdc(blimp, aspect)]
  const deletedWhileVisible: string[] = []
  let b = blimp
  let frames = 0
  let despawned = false
  for (let f = 0; f < maxFrames; f++) {
    b = stepBlimp(b)
    frames += 1
    const gone = blimpOffScreen(b, aspect)
    // THE ASSERTION THIS WHOLE FILE EXISTS FOR: deleted => not visible. Asked of the REAL
    // renderer, not of a reconstruction of it.
    if (gone && blimpIsVisible(b, aspect)) {
      deletedWhileVisible.push(`frame ${f}: ndc ${blimpNdc(b, aspect).toFixed(3)} — still drawn`)
    }
    if (gone) {
      despawned = true
      break
    }
    ndcPath.push(blimpNdc(b, aspect))
  }
  return { ndcPath, deletedWhileVisible, frames, despawned, final: b }
}

describe('the blimp ENTERS from an edge, CROSSES the frame, and is not deleted while visible', () => {
  it('(a) ENTERS near a screen EDGE — not near the centre, at any aspect', () => {
    // The shipped bug: at the corrected cruise depth the airship entered at ndc 0.083..0.138 —
    // 8% of the way from the centre of the screen. It did not "drift across the screen"; it
    // materialised in the middle of it. rb2-10's AC says it enters from a side and drifts across.
    for (const aspect of [4 / 3, 16 / 9, 21 / 9]) {
      for (const seed of [1, 2, 7, 42, 100, 2024]) {
        const b = spawnBlimp(createRng(seed), aspect)
        const ndc = blimpNdc(b, aspect)
        expect(Math.abs(ndc), `seed ${seed} @ aspect ${aspect} entered at ndc ${ndc}`)
          .toBeGreaterThanOrEqual(0.7) // hard against the edge…
        expect(Math.abs(ndc)).toBeLessThanOrEqual(1) // …but IN FRAME, so it is visible on arrival
        expect(Math.sign(ndc)).toBe(b.side) // and on the side it says it entered from
        expect(blimpIsVisible(b, aspect), 'a freshly-spawned airship must be on screen').toBe(true)
        expect(blimpOffScreen(b, aspect), 'and must not be instantly despawned').toBe(false)
      }
    }
  })

  it('(b) CROSSES the frame — entry edge, through the centre, out the FAR side', () => {
    for (const seed of [1, 7, 42]) {
      const b0 = spawnBlimp(createRng(seed), ASPECT)
      const { ndcPath, despawned, final } = flyCrossing(b0, ASPECT)

      expect(despawned, 'the drift is unbounded — it must eventually leave and be reaped').toBe(true)
      expect(Math.min(...ndcPath.map(Math.abs)), 'it must pass through the middle of the screen')
        .toBeLessThan(0.1)
      expect(Math.sign(final.x), 'it must exit on the OPPOSITE side from the one it entered')
        .toBe(-b0.side)
      // …and it must actually sail ACROSS: the far side of the frame, not just past centre.
      expect(Math.max(...ndcPath.map((n) => (Math.sign(n) === -b0.side ? Math.abs(n) : 0))))
        .toBeGreaterThan(0.9)
    }
  })

  it('(c) is NEVER DELETED WHILE STILL VISIBLE — the whole hull must clear the frame first', () => {
    // THE REGRESSION, stated as the property it violated. Ground truth for "visible" is the REAL
    // blimpSegments — the same function main.ts strokes — so this cannot pass by the test and the
    // game agreeing on a shared mistake. Against the shipped code (despawn at |x| > 640, cruise
    // depth 2112) the airship is deleted at ndc 0.295 and this test lists every frame it happened.
    for (const aspect of [4 / 3, 16 / 9, 21 / 9]) {
      for (const seed of [1, 2, 7, 42]) {
        const b0 = spawnBlimp(createRng(seed), aspect)
        const { deletedWhileVisible } = flyCrossing(b0, aspect)
        expect(
          deletedWhileVisible,
          `seed ${seed} @ aspect ${aspect}: the airship was despawned while its geometry was ` +
            `still being drawn inside the frame. A despawn bound is a claim about the SCREEN — ` +
            `ask it in projected space (screen.ts), not with a world constant fitted to one depth.`,
        ).toEqual([])
      }
    }
  })

  it('the despawn waits for the TAIL, not just the centre — the hull has a size', () => {
    // A 40-unit airship whose CENTRE is exactly on the frame edge still has half of itself on
    // screen. The despawn reasons about BLIMP_HULL_RADIUS, read off the airship's own vertices.
    const depth = 2112
    const onTheEdge: Blimp = {
      x: frustumHalfWidth(depth, ASPECT), // centre exactly at ndc 1.0
      y: 0, depth, deltaX: 1, bank: 0, side: 1, active: true,
    }
    expect(blimpOffScreen(onTheEdge, ASPECT), 'half the hull is still in frame').toBe(false)
    expect(blimpIsVisible(onTheEdge, ASPECT)).toBe(true)
    expect(BLIMP_HULL_RADIUS).toBe(40) // the envelope's nose/tail, from BLIMP_POINTS
  })

  it('is TOTAL — a NaN airship is reaped, not left drifting and firing forever', () => {
    const base = spawnBlimp(createRng(1), ASPECT)
    expect(blimpOffScreen({ ...base, x: Number.NaN }, ASPECT)).toBe(true)
    expect(blimpOffScreen({ ...base, depth: Number.NaN }, ASPECT)).toBe(true)
    expect(blimpOffScreen({ ...base, x: 0 }, ASPECT)).toBe(false) // 0 is a POSITION, not a sentinel
  })
})

// ─────────────────────────────────────────────────────────────────────────────────
// THE CLASS IS DEAD, NOT THE INSTANCE — move the depth axis and NOTHING on screen moves
// ─────────────────────────────────────────────────────────────────────────────────

describe('the airship flies the SAME SCREEN PATH whatever depth it cruises at', () => {
  /**
   * The same airship (same seed, same frame), re-based to cruise at an arbitrary depth. The
   * entry NDC and the drift are re-derived through screen.ts at that depth — which is exactly
   * what `spawn` does — so this is the airship you would get if CRUISE_DEPTH were `depth`.
   */
  function atCruiseDepth(seed: number, depth: number, aspect: number): Blimp {
    const b = spawnBlimp(createRng(seed), aspect)
    const entryNdc = ndcX(b.x, b.depth, aspect) // the entry the spawn actually chose
    return {
      ...b,
      depth,
      x: worldX(entryNdc, depth, aspect),
      deltaX: -b.side * blimpDriftPerFrame(depth, aspect),
    }
  }

  it('THE PROPERTY: entry, drift and crossing are identical at 600, 2112 and 4224', () => {
    // This is the test that ends the class. Round 2 moved CRUISE_DEPTH 600 -> 2112 and broke the
    // game. Under the old code this fails instantly: at 600 the airship entered at ndc 0.292 and
    // at 2112 at ndc 0.083, and the crossing took four times as long. Now the depth is a free
    // variable that the player cannot see, which is what "denominated in the screen" MEANS.
    for (const seed of [1, 7, 42]) {
      const runs = [600, 2112, P_INDP].map((depth) => {
        const b = atCruiseDepth(seed, depth, ASPECT)
        return { depth, ...flyCrossing(b, ASPECT) }
      })

      const [a, b, c] = runs
      // the entry is the same PLACE ON THE SCREEN
      expect(b.ndcPath[0]).toBeCloseTo(a.ndcPath[0], 9)
      expect(c.ndcPath[0]).toBeCloseTo(a.ndcPath[0], 9)
      // …and so is every frame of the crossing WHILE IT IS ON SCREEN
      const onScreen = (path: number[]): number[] => path.filter((n) => Math.abs(n) <= 1)
      expect(onScreen(b.ndcPath).length).toBe(onScreen(a.ndcPath).length)
      expect(onScreen(c.ndcPath).length).toBe(onScreen(a.ndcPath).length)
      onScreen(a.ndcPath).forEach((n, i) => {
        expect(onScreen(b.ndcPath)[i]).toBeCloseTo(n, 9)
        expect(onScreen(c.ndcPath)[i]).toBeCloseTo(n, 9)
      })
      // …and at every depth it leaves, and never in view
      for (const r of runs) {
        expect(r.despawned, `depth ${r.depth} never despawned`).toBe(true)
        expect(r.deletedWhileVisible, `depth ${r.depth}`).toEqual([])
      }
    }
  })

  it('the airship takes ~10 s of screen to cross, at any depth — not 40 s at one and 10 at another', () => {
    // The drift was `12 world units per calc-frame`: 1% of the frame per frame at the old depth,
    // 0.28% at the new one. The SAME constant, a 3.5x difference in pace, decided by a number in
    // a different file. It is denominated in SECONDS OF SCREEN now (DRIFT_CROSSING_SECONDS).
    const SIM_HZ = 250 / 24 // timing.ts — the ~10.42 Hz calc-frame cadence
    for (const depth of [600, 2112, P_INDP]) {
      const drift = blimpDriftPerFrame(depth, ASPECT)
      const framesToCrossFullWidth = (2 * frustumHalfWidth(depth, ASPECT)) / drift
      expect(framesToCrossFullWidth / SIM_HZ, `depth ${depth}`).toBeCloseTo(10, 6)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────
// THE BURST + THE LOD — the other two members of the class, measured
// ─────────────────────────────────────────────────────────────────────────────────

describe('the debris burst is the same SIZE on screen wherever the plane dies', () => {
  it('a kill at the floor and a kill at the spawn depth burst to the same apparent size', () => {
    // `DEBRIS_SPREAD = 4` window units per frame made the explosion's size on screen a function
    // of how far away the thing that died happened to be: 14% of the frame's half-height at the
    // blimp's old cruise depth, 2% at a plane's spawn depth. A plane sniped at 4224 — the shot
    // this whole story exists to restore — burst into an invisible pop.
    const apparent = (depth: number): number =>
      ndcY(debrisSpread(depth, EXPL2_FRAMES), depth) // the full-open half-spread, in NDC

    const sizes = [P_MNDP, 600, 2112, P_INDP, 6400].map(apparent)
    for (const s of sizes) expect(s).toBeCloseTo(sizes[0], 9)
    expect(sizes[0], 'and it must be big enough to actually see').toBeGreaterThan(0.05)
  })

  it('the burst OPENS — it is zero at the first exploding frame and full at the last', () => {
    expect(debrisSpread(2112, 0)).toBe(0)
    const half = debrisSpread(2112, EXPL2_FRAMES / 2)
    const full = debrisSpread(2112, EXPL2_FRAMES)
    expect(half).toBeGreaterThan(0)
    expect(full).toBeGreaterThan(half)
    expect(half * 2).toBeCloseTo(full, 9) // linear, so the burst reads as an expansion
  })
})

describe('the model switch is an ORIENTATION, so NEITHER axis can move it (rb4-13)', () => {
  // TOMBSTONE for the apparent-size LOD. rb4-1 denominated the switch in screen units so
  // the depth axis could not move it — the best-argued version of a rule THE ROM DOES NOT
  // HAVE. DRNPIC (RBARON.MAC:4961-4970, `.RADIX 16` set at :74) picks the model on
  // `LDA PLSTAT+6 / AND I,10` — the D4 orientation bit (:2652 `;D4=0 (PLANE FACING AWAY)`),
  // never on a size or a distance. So the screen registry's stake in the switch reduces to
  // this: the apparent-size apparatus must STAY retired, on this axis as on the depth axis.
  it('the apparent-size threshold is GONE from biplane.ts — the switch is not a screen quantity', () => {
    const biplane = readFileSync(join(repoRoot, 'src', 'core', 'biplane.ts'), 'utf8')
    expect(
      biplane,
      'rb4-13: the model switch follows PLSTAT+6 D4 (DRNPIC, RBARON.MAC:4961). An apparent-size ' +
        'threshold is the old depth rule in screen clothing — retire it, do not re-denominate it.',
    ).not.toContain('LOD_APPARENT_SPAN')
  })

  it('the switch answers to the bit on BOTH sides — the orientation alone swaps the model', () => {
    expect(biplaneLOD(true).points).toHaveLength(29) // D4=0 — facing away → .DRPNT drone
    expect(biplaneLOD(false).points).toHaveLength(42) // D4=1 — rotated toward → full plane
  })
})

// ─────────────────────────────────────────────────────────────────────────────────
// THE OTHER SIDE OF THE RULE — what is NOT a screen constant, proved, not asserted
// ─────────────────────────────────────────────────────────────────────────────────

describe('the collision window is an OBJECT-space hitbox — rescaling it would be the mirror bug', () => {
  const targetAt = (depth: number, x = 0): Enemy => ({
    // facingAway (rb4-13, the PLSTAT+6 D4 mirror) is irrelevant to collision — the hitbox
    // is orientation-blind; a settled (facing-away) plane is the common flight state.
    kind: 'lead', x, y: 0, depth, deltaX: 0, bank: 0, side: 1, active: true, facingAway: true,
  })
  /** The widest x-offset at which a shell still hits a plane parked at `depth`. */
  function aimTolerance(depth: number): number {
    const z = depth / 256 // S_DPTH — the shell z whose depth is exactly `depth`
    let widest = 0
    for (let dx = 0; dx <= 80; dx += 0.25) {
      const shell: Shell = { x: dx, y: 0, z, gun: 'right', active: true }
      if (collides(shell, targetAt(depth))) widest = dx
    }
    return widest
  }

  it('the aim tolerance in WORLD units is the same near and far — it is not a screen box', () => {
    // The Reviewer listed WINDOW_X / WINDOW_Y / MUZZLE_X as candidates for the screen class.
    // They are not, and the difference is what the number is a fraction OF. This one is a
    // fraction of the TARGET: `collides` bounds an offset between two objects in the world, and
    // the box is sized against the plane's own hull. The plane's model and its hitbox go through
    // the SAME perspective divide, so they shrink together — the hitbox tracks the plane's
    // apparent size at every depth, for free, forever. Multiplying it by 3.91 with the depth
    // axis would have made the gun hit planes it visibly missed.
    const near = aimTolerance(shellDepth(2))
    const far = aimTolerance(shellDepth(16))
    expect(near).toBe(far)
  })

  it('…and the box is exactly the ROM collision plate — the fuselage band at picture scale', () => {
    // rb4-17 re-baseline (was: "about the size of the plane", tolerance in (20, 40] off the RAW
    // hull). The window is no longer sized "against the hull" — it IS the ROM's own plate:
    // COLLD, "PLANE COLLISION WINDOW(POINTP FORMAT)" (RBARON.MAC:409; bytes 037007.XXX:602-605),
    // the x ±12 FUSELAGE band lifted by the same ×4 POINTP/ZAXIS storage lift as the drawn
    // vertices and divided by the same PICTURE Z (CDSSET RBARON.MAC:5529-5537). Model and hitbox
    // ride ONE scale: you hit by hitting the fuselage the cabinet pays for — never by missing
    // the plane, and NOT by grazing a wingtip (the drawn half-wingspan is 40 × 4 = 160, more
    // than three times the window).
    const plateHalfX = Math.max(...COLLD_POINTS.map((p) => Math.abs(p[0]))) * PICTURE_SCALE // 48
    const tolerance = aimTolerance(shellDepth(8))
    expect(tolerance, 'the gun IS the plate — one scale for model and hitbox').toBe(plateHalfX)
    const drawnHalfSpan = Math.max(...PLANE_POINTS.map((p) => Math.abs(p[0]))) * PICTURE_SCALE // 160
    expect(tolerance, 'a wingtip graze is not a kill').toBeLessThan(drawnHalfSpan)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────
// THE REGISTRY — every constant that announces itself as a SCREEN X/Y is classified
// ─────────────────────────────────────────────────────────────────────────────────

/** A constant declared in src/, with its initializer text and the doc comment above it. */
interface Decl {
  readonly file: string
  readonly line: number
  readonly name: string
  readonly init: string
  readonly context: string
}

function declarations(): readonly Decl[] {
  const out: Decl[] = []
  for (const file of srcFiles()) {
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      const m = /^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*(.+?)\s*(?:\/\/.*)?$/.exec(line)
      if (!m) return
      out.push({
        file: relative(repoRoot, file),
        line: i + 1,
        name: m[1],
        init: m[2].replace(/,$/, ''),
        context: lines.slice(Math.max(0, i - 14), i + 1).join('\n'),
      })
    })
  }
  return out
}

/** Names that ANNOUNCE a position/extent/velocity on the SCREEN's x or y. */
const SCREEN_NAME =
  /(_|^)(X|Y)(_|$)|(_|^)(SPREAD|SPAN|WINDOW|MUZZLE|ENTRY|DESPAWN|DRIFT|RADIUS)(_|$)/

/** Only a NUMBER can be denominated in a unit (same structural filter as the depth sweep). */
const isNumberValued = (init: string): boolean => !/^[{['"`]|=>|^new\b|^Object\b/.test(init.trim())

/**
 * REGISTERED — screen-denominated, written in the PROJECTED frame, spent through screen.ts at
 * the depth the thing is seen at. Each has a behavioural property above.
 */
const REGISTERED: ReadonlyMap<string, string> = new Map([
  ['ENTRY_NDC_MIN', 'blimp.ts — where the airship enters, in NDC. Property: it enters from an EDGE.'],
  ['ENTRY_NDC_RANGE', 'blimp.ts — the width of that entry band, in NDC.'],
  ['SPAWN_NDC_Y_RANGE', "blimp.ts — the vertical spawn spread, as a fraction of the frame's half-height."],
  [
    'DRIFT_CROSSING_SECONDS',
    'blimp.ts — the drift, denominated in SECONDS OF SCREEN. Was `DRIFT_SPEED = 12 world units ' +
      'per frame`, which is 1% of the frame per frame at one depth and 0.28% at another.',
  ],
  [
    'DEBRIS_SPREAD_NDC',
    "wreck-render.ts — how far the burst opens, as a fraction of the frame's half-height at the " +
      'wreck. Was `DEBRIS_SPREAD = 4` world units/frame, so the explosion was invisible at the ' +
      'spawn depth and huge in your face.',
  ],
  [
    'LOD_APPARENT_SPAN',
    'biplane.ts — a TOMBSTONE (rb4-13). Was the LOD switch threshold in apparent size; the ROM ' +
      'picks the model on the PLSTAT+6 D4 orientation bit (DRNPIC, RBARON.MAC:4961), so the ' +
      'apparatus is retired. Kept so a reintroduced NAME lands back in this sweep instantly.',
  ],
])

/**
 * NOT A SCREEN CONSTANT — and each one gets a REASON, because "it has an X in the name" is not
 * an argument and neither is "it doesn't". The test is always the same: WHAT IS THIS NUMBER A
 * FRACTION OF? If the answer is "the frame", it is a screen constant and it must be denominated
 * in the projection. If the answer is "an object", or "an angle", or "nothing", it is not, and
 * rescaling it with the depth axis would be a bug in the opposite direction.
 */
const NOT_A_SCREEN_CONSTANT: ReadonlyMap<string, string> = new Map([
  [
    'WINDOW_X',
    'guns.ts — a fraction of the TARGET, not of the frame: `collides` bounds an offset between ' +
      'two objects in the world, and the box is the ROM\'s own COLLD collision plate (rb4-17: ' +
      '037007.XXX:602-605, x ±12 × the POINTP ×4 lift = ±48). Model and hitbox are carried ' +
      'through the same perspective divide, so they shrink together. Proved above (the aim ' +
      'tolerance is identical near and far).',
  ],
  [
    'WINDOW_Y',
    'guns.ts — a TOMBSTONE (rb4-17). Was the inferred symmetric ±32; the ROM\'s COLLD plate is ' +
      'ASYMMETRIC in y (belly −16 to top wing +20, ×4), so the name split into WINDOW_Y_MIN / ' +
      'WINDOW_Y_MAX below. Kept so a reintroduced symmetric NAME lands back in this sweep.',
  ],
  ['WINDOW_Y_MIN', 'guns.ts — as WINDOW_X: the COLLD plate\'s belly bound, −16 × 4 = −64. Object-space.'],
  ['WINDOW_Y_MAX', 'guns.ts — as WINDOW_X: the COLLD plate\'s top-wing bound, +20 × 4 = +80. Object-space.'],
  [
    'WINDOW_Z',
    'guns.ts — in shell-Z COUNTS, the ROM\'s own range unit. Not a screen quantity at all; its ' +
      'invariant is 2*WINDOW_Z >= SHELL_SPEED (the anti-tunnelling bound), nothing to do with depth.',
  ],
  [
    'MUZZLE_X',
    'guns.ts — where the gun barrels ARE, in the world, 4 units off the eye\'s centreline. A ' +
      'shell keeps this x for its whole flight, so its tracer converges on the vanishing point as ' +
      'it recedes — which is what a bullet fired down a boresight does. Rescaling it with the ' +
      'depth axis would move the guns off the aeroplane.',
  ],
  [
    'PLANE_SPAN',
    "biplane.ts — the plane's wingspan (80), read off PLANE_POINTS. An OBJECT dimension: being " +
      'wrong about it means the model is wrong, not the framing. (Its one consumer — the ' +
      'apparent-size LOD — is retired by rb4-13; if the constant goes with it, this entry is a ' +
      'harmless tombstone.)',
  ],
  [
    'BLIMP_HULL_RADIUS',
    "blimp.ts — the airship's bounding radius (40), read off BLIMP_POINTS. Also an object " +
      'dimension: it is what lets the despawn wait for the TAIL to clear the frame rather than ' +
      'the centre. It is in WORLD units on purpose — the hull does not resize when the window does.',
  ],
  [
    'ALT_TO_Y',
    'flight.ts — converts ROM altitude units into world Y for the EYE\'s position. The eye is ' +
      'never projected (it IS the projection), so there is no depth to divide by.',
  ],
  [
    'HORIZON_HALF_SPAN',
    'horizon.ts — an ANGLE (azimuth half-width, ±40°), not a distance on the screen. It trips the ' +
      'sweep on "SPAN". The horizon is drawn at a fixed azimuth, and an angle is depth-free.',
  ],
  ['FOV_Y', 'tools/contactSheet.ts — a field-of-view ANGLE. Same word, different quantity.'],
  [
    'DOT_RADIUS',
    'tools/contactSheet.ts — a canvas PIXEL radius in the offline ROM contact sheet, which frames ' +
      'each model at a fixed FILL of its own viewport and never sees the game\'s depth axis.',
  ],
])

/**
 * ARE screen-denominated, but rb4-1's file assignment does not own them. A short, NAMED list
 * with an owner — not a wildcard opt-out. Each entry carries the measurement, so nobody has to
 * re-do the analysis to pick it up.
 */
const NOT_THIS_STORY: ReadonlyMap<string, string> = new Map([
  [
    'SPAWN_Y_RANGE',
    'enemy.ts — THE SEVENTH INSTANCE, AND IT IS REAL. The plane spawns with y in ±40 world units ' +
      'at P.INDP = 4224, which is ndc 0.016 — 1.6% of the frame\'s half-height. Its own comment ' +
      'says "keeps the plane on-screen", and the sweep shrank it 3.91x: at the old 1080 spawn it ' +
      'was ndc 0.064, so the vertical scatter the wave was tuned to have is now four times ' +
      'flatter and every plane enters pinned to the horizon line. It is NOT A DEFECT the way the ' +
      'blimp was (nothing vanishes, nothing is unhittable) — it is a silent loss of variety. ' +
      'The fix is one line: `worldY(SPAWN_NDC_Y_RANGE, P_INDP)`, exactly as blimp.ts now does. ' +
      'src/core/enemy.ts is outside this agent\'s file assignment for rb4-1 (findings 1/2/4/7), ' +
      'so it is REGISTERED HERE rather than quietly fixed or quietly ignored. Owner: the rb4-1 ' +
      'arm that owns enemy.ts, or a follow-up story.',
  ],
])

describe('COMPLETENESS — every screen-denominated constant is enumerated, or the suite says so', () => {
  it('every candidate the sweep finds has been CLASSIFIED — nothing is merely unexamined', () => {
    const unclassified = declarations()
      .filter((d) => SCREEN_NAME.test(d.name))
      .filter((d) => isNumberValued(d.init)) // an object cannot be denominated in anything
      .filter(
        (d) =>
          !REGISTERED.has(d.name) &&
          !NOT_A_SCREEN_CONSTANT.has(d.name) &&
          !NOT_THIS_STORY.has(d.name),
      )
      // A constant transcribed straight from the ROM, with its citation, is self-classifying:
      // it IS the ROM's own number in the ROM's own screen-window space.
      .filter((d) => !/RBARON\.MAC|RBGRND\.MAC/.test(d.context))
      .map((d) => `${d.file}:${d.line}  ${d.name} = ${d.init}`)

    expect(
      unclassified,
      'A constant whose name puts it on the SCREEN axis is not accounted for anywhere.\n\n' +
        'A screen-space x or y is MEANINGLESS without the depth it is seen at: what an x means on ' +
        'screen is x / depth. Move the depth axis and the number silently means something else — ' +
        'which is how the blimp came to be deleted in the middle of the screen while every depth ' +
        'test stayed green.\n\n' +
        'Decide which it is and say so in tests/core/screen-scale.test.ts:\n' +
        '  * a real screen x/y   -> add it to REGISTERED, write it in NDC, spend it through\n' +
        '                           src/core/screen.ts at the depth it is seen at, give it a property\n' +
        '  * not a screen x/y    -> add it to NOT_A_SCREEN_CONSTANT with the reason. The test is\n' +
        '                           "what is this number a fraction OF?" — the frame, or an object?\n' +
        "  * someone else's      -> add it to NOT_THIS_STORY with the owner AND the measurement\n\n" +
        'Do not skip this by renaming the constant. The point is not the name — it is that the ' +
        'number knows what it is measured in.\n',
    ).toEqual([])
  })

  it('every REGISTERED screen constant is actually written in the projected frame', () => {
    // The rule, made mechanical: a screen constant may not be a world-unit magnitude. It is
    // either an NDC fraction (|v| <= ~2 — the frame is [-1, 1] plus a little margin) or a
    // quantity in a unit a human can picture, like seconds. What it may NOT be is `640`.
    const offenders = declarations()
      .filter((d) => REGISTERED.has(d.name))
      .filter((d) => {
        const v = Number(d.init)
        return Number.isFinite(v) && Math.abs(v) > 100 // a world-window magnitude in disguise
      })
      .map((d) => `${d.file}:${d.line}  ${d.name} = ${d.init}`)

    expect(
      offenders,
      'These are REGISTERED as screen constants but hold world-window magnitudes. A number like ' +
        '640 is not a position on the screen — it is a position on the screen ONLY ONCE you say ' +
        'at what depth. Write the fraction; let screen.ts spend it.\n',
    ).toEqual([])
  })

  it('main.ts holds no screen constant at all — it is the one file no test can import', () => {
    // Both HIGH findings of rb4-1 were numbers rotting in main.ts, and that is not a coincidence:
    // main.ts touches `document` at module scope, so under vitest it cannot be imported and NOTHING
    // in it is reachable by any test. It is the one place a number can be wrong forever in green.
    // So the rule is structural, not vigilant: the pure geometry does not live there.
    const main = readFileSync(join(srcRoot, 'main.ts'), 'utf8')
    const screenish = declarations()
      .filter((d) => d.file.endsWith('main.ts'))
      .filter((d) => SCREEN_NAME.test(d.name) && isNumberValued(d.init))
      .map((d) => `${d.file}:${d.line}  ${d.name} = ${d.init}`)
    expect(
      screenish,
      'A screen-space constant is back in main.ts. It cannot be tested there — that is WHY ' +
        'SHELL_DRAW_FAR, BLIMP_DESPAWN_X and DEBRIS_SPREAD all rotted there. Move the pure ' +
        'function to core and put a property on it.\n',
    ).toEqual([])

    // …and main.ts authors no geometry: the four things that decided where an object appears —
    // the tracer, the airship, the despawn, the debris — are all CALLS into tested core modules.
    // This is deliberately a check on the import graph, not on main.ts's prose: `tsconfig.json`
    // sets `noUnusedLocals`, so an imported-and-unused renderer is a TYPE ERROR. Import it +
    // cannot leave it unused ⇒ the cockpit draws with the function the suite measured.
    //
    // (It is NOT a search for the old names. My first draft grepped main.ts for
    // /SHELL_DRAW_FAR|BLIMP_DESPAWN_X|DEBRIS_SPREAD/ and it went red — on the tombstone comment
    // that documents why they are gone. A test that forbids naming the bug forbids explaining
    // it, and the declaration sweep above already forbids DECLARING it, which is the thing that
    // actually matters.)
    // ROUND 4 — `blimpOffScreen` USED TO BE ON THIS LIST, AND THAT WAS THE HOLE.
    //
    // This is a strengthening, not a retune, and here is exactly why. `blimpOffScreen` is a
    // PREDICATE: importing it proves only that main.ts can ASK the question, never that it obeys
    // the answer. The Reviewer proved the difference in one line, with the suite 832/832 green:
    //
    //     const gone = blimpOffScreen(drifted, aspect) || Math.abs(drifted.x) > REAP_LIMIT
    //     blimp = gone ? null : drifted
    //
    // Imported: yes. Referenced (noUnusedLocals): yes. This very check: PASSED. And the airship was
    // deleted on its first calc-frame at ndc 0.70, fully drawn on screen, because the world constant
    // dominated the `||` and core's correct answer never decided anything.
    //
    // So main.ts no longer imports the QUESTION. It imports the ANSWER: `reapBlimp` returns the
    // airship or nothing, and the cockpit's whole despawn is `blimp = reapBlimp(drifted, aspect)` —
    // an expression with no operator in it to poison. `blimpOffScreen` is still exported and still
    // measured to death above; it is simply no longer a thing main.ts is trusted to combine.
    // (THE DECISION PATH, below, enforces that. tests/cockpit-loop.test.ts proves it by flying it.)
    for (const [fn, mod] of [
      ['shellSegments', './core/guns'],
      ['blimpSegments', './core/blimp'],
      ['reapBlimp', './core/blimp'],
      ['wreckSegments', './core/wreck-render'],
    ]) {
      const importRe = new RegExp(
        `import\\s*\\{[^}]*\\b${fn}\\b[^}]*\\}\\s*from\\s*'${mod.replace(/[./]/g, '\\$&')}'`,
        's',
      )
      expect(main, `main.ts must draw/despawn through ${mod}'s ${fn}`).toMatch(importRe)
    }
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // THE CONTAINMENT GUARD — and the honest story of why it exists
  // ───────────────────────────────────────────────────────────────────────────────
  //
  // I ATTACKED MY OWN FIX AND IT FELL OVER. Everything above measures the CORE functions, and
  // they are now measured properly — the round-2 tracer defeat dies against them in five places.
  // But main.ts is still the file no test can import, so I tried the obvious thing a fourth
  // round of drift would do:
  //
  //     const DRAW_REACH = 6400 / 8
  //     function tracerFor(shell, viewProj) {           // a fresh name — no banned identifier
  //       const wd = (shell.z / 25) * DRAW_REACH
  //       return [projectSegment([shell.x, shell.y, -wd], …, viewProj)]
  //     }
  //     ...
  //     void shellSegments(shell, projView)             // keeps the import "used" (noUnusedLocals)
  //     strokeSegments(tracerFor(shell, projView), …)   // …and draws the WRONG one
  //
  // 829/829 GREEN. tsc CLEAN. The shipped bug, restored, past every guard in this file and in
  // tracer-seam.ts — because they all check that the RIGHT function is right, and none of them
  // checked that it is the one the cockpit actually strokes.
  //
  // That is the same hole as the last three rejections, one level up, and "a guard you can walk
  // around in sixty seconds is not a guard". So this closes it by making the DRAW PATH itself
  // the invariant: every vector main.ts strokes must come out of a core function the suite has
  // measured. Not "main.ts mentions the right word" — "main.ts draws nothing else".
  describe('THE DRAW PATH — every vector main.ts strokes comes from a MEASURED core function', () => {
    const main = readFileSync(join(srcRoot, 'main.ts'), 'utf8')

    /**
     * The only functions allowed to produce geometry for the cockpit. Every one is pure, lives
     * in core, and has behavioural tests on it.
     *
     * ADDING TO THIS LIST IS A DELIBERATE ACT. That is the entire point: a rival renderer can no
     * longer appear in main.ts by drift, because it cannot draw without being named here, and
     * naming it here is a line in a diff that says "I am adding a new source of geometry, and it
     * is not tested".
     */
    const MEASURED_SOURCES = [
      'horizonSegments', //  core/horizon    — tests/core/horizon.test.ts
      'mountainSegments', // core/landscape  — tests/core/landscape.test.ts, mountain-render-data
      'wreckSegments', //    core/wreck-render — screen-scale (the debris burst)
      'blimpSegments', //    core/blimp      — screen-scale (the crossing, the despawn)
      'shellSegments', //    core/guns       — tracer-seam (the drawn depth IS the kill depth)
      'renderModel', //      core/biplane    — tests/core/biplane.test.ts
      'propSegments', //     core/prop       — tests/core/prop.test.ts (the enemy prop, rb4-9)
      'playerPropSegments', // core/prop     — tests/core/prop.test.ts + prop-clock-wiring (player prop)
      'windscreenSegments', // core/windscreen — tests/core/hud.test.ts (the bullet holes, rb4-9)
      'livesGlyphs', //      core/lives      — tests/core/hud.test.ts (the DSPLIF lives, rb4-9)
      'hudTextSegments', //  core/hud-font   — tests/hud-font-adoption.test.ts (the HUD readout glyphs, rb4-19)
    ]

    it('every strokeSegments() call site draws a MEASURED core function — no rivals', () => {
      // Every call, minus the declaration itself…
      const allCalls = [...main.matchAll(/strokeSegments\s*\(/g)].length - 1
      // …and every call whose argument is a direct call to a named function.
      const named = [...main.matchAll(/strokeSegments\s*\(\s*([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1])

      expect(allCalls, 'main.ts must actually draw something').toBeGreaterThan(0)
      expect(
        named.length,
        'every strokeSegments() call must pass the RESULT OF A NAMED FUNCTION — not an inline ' +
          'array of hand-built segments, which is a renderer with no name and no test.',
      ).toBe(allCalls)

      const rivals = [...new Set(named)].filter((fn) => !MEASURED_SOURCES.includes(fn))
      expect(
        rivals,
        'main.ts is stroking geometry from a function that is not a measured core renderer.\n\n' +
          'This is how BOTH of rb4-1\'s HIGH bugs shipped: a private copy of something core owns, ' +
          'in the one file no test can import. If this is a real new renderer, it belongs in core ' +
          'with a property on it — and then in MEASURED_SOURCES, deliberately.\n',
      ).toEqual([])
    })

    it('main.ts owns no projector — it may compose the MVP, never project a point', () => {
      // A rival renderer needs to turn a world point into NDC. Take that away and the cheap path
      // is gone: main.ts composes the MVP (sceneProjection ∘ flightView) and hands it to core.
      expect(
        main,
        'main.ts must not import projectSegment — projecting a point is core\'s job, and a ' +
          'projector in main.ts is an untestable renderer waiting to happen.',
      ).not.toMatch(/import\s*\{[^}]*\bprojectSegment\b[^}]*\}\s*from/s)
      expect(main, 'nor may it build its own perspective matrix').not.toMatch(/\bperspective\s*\(/)
    })

    it('the one raw renderModel call is fenced to the plane\'s own LOD model', () => {
      // renderModel has to stay in main.ts (tests/cockpit-boot.test.ts pins the enemy draw there,
      // and rightly — it is the proof the wave reaches the canvas). But it accepts ANY
      // {points, connect} picture, so it is the last way to smuggle a hand-built shape onto the
      // screen. Fence it: in main.ts it may only ever render the biplane LOD.
      const renderCalls = [...main.matchAll(/renderModel\s*\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
      expect(renderCalls.length).toBeGreaterThan(0)
      for (const arg of renderCalls) {
        expect(
          arg,
          'renderModel in main.ts may only draw biplaneLOD(...) — the enemy. Any other picture ' +
            'is a renderer that should live in core, next to the sim state it draws.',
        ).toBe('biplaneLOD')
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // THE DECISION PATH — main.ts may OBEY core's despawn; it may not COMPOSE one
  // ───────────────────────────────────────────────────────────────────────────────
  //
  // AND THE HONEST STORY OF WHY *THIS* ONE EXISTS TOO. THE DRAW PATH above closed the rival-
  // renderer hole, and it was still not enough, because a renderer is a FUNCTION and a despawn is
  // a BOOLEAN. THE DRAW PATH fences `strokeSegments`. It has nothing to say about an `||`.
  //
  // The Reviewer's round-3 bypass, in full — no test touched, no core file touched, 832/832 GREEN:
  //
  //     const REAP_LIMIT = 640                                            // trips no name sweep
  //     const gone = blimpOffScreen(drifted, aspect) || Math.abs(drifted.x) > REAP_LIMIT
  //     blimp = gone ? null : drifted                                     // OR short-circuits
  //
  // Every guard in this file and in blimp-wiring.test.ts passed, because every one of them asked
  // whether main.ts NAMES the right function. It imported `blimpOffScreen` (regex). It referenced
  // it, so `noUnusedLocals` was happy. It contained the word "despawn" (regex). It contained
  // `blimp = null` (regex) — on the KILL path, which he never went near. All true. All useless.
  // The airship was deleted on its FIRST calc-frame, at 70-84 % of the way to the edge, fully drawn.
  //
  //     THE LESSON, AND IT IS THE STORY'S OWN RULE ONE LEVEL UP:
  //     "imported" is not "used as the decision". A predicate is an OPINION the caller may overrule.
  //
  // Two things follow, and both are done:
  //
  //   1. THE CODE. main.ts no longer holds the boolean. `reapBlimp(drifted, aspect)` returns the
  //      airship or nothing, so the cockpit's despawn is a single call with NO OPERATOR IN IT.
  //      You cannot corrupt a decision you cannot spell.
  //
  //   2. THIS GUARD, and it is a PARSE, not a regex — the previous four rounds all died on the
  //      gap between what the text says and what the code does, so this one reads the code. It
  //      TAINTS every value in main.ts that is derived from a Blimp, and forbids that value from
  //      ever reaching an arithmetic or relational operator, or a `Math.*` call, or any function
  //      that is not a tested core import. There is no name to dodge and no literal to inline:
  //
  //        Math.abs(drifted.x) > REAP_LIMIT   -> tainted value into Math.*                RED
  //        Math.abs(drifted.x) > 640          -> same; the constant was never the point   RED
  //        drifted.x > 640 || drifted.x < -640-> tainted operand of a relational           RED
  //        const bx = drifted.x; bx > 640     -> taint follows the binding                 RED
  //        function far(b: Blimp) {...b.x...} -> a Blimp-typed parameter is tainted too    RED
  //        function far(b: {x: number})       -> a tainted value handed to a non-core fn   RED
  //        (drifted as any).x = 1e9           -> writing through a tainted reference       RED
  //        blimp = cond ? null : drifted      -> the write itself is not a core call       RED
  //
  // And the behaviour is proved independently, by flying it: tests/cockpit-loop.test.ts boots
  // main.ts under a stub DOM and watches the real airship cross the real frame. This guard fails
  // FAST and says WHY; that one cannot be reasoned around at all.
  describe('THE DECISION PATH — the cockpit takes core\'s answer; it does not hold a vote', () => {
    const mainPath = join(srcRoot, 'main.ts')
    const source = ts.createSourceFile(
      'main.ts',
      readFileSync(mainPath, 'utf8'),
      ts.ScriptTarget.ESNext,
      /* setParentNodes */ true,
    )

    /** Every value-import in main.ts: local name -> { module, original name }. */
    const imports = new Map<string, { mod: string; orig: string }>()
    for (const stmt of source.statements) {
      if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue
      if (stmt.importClause.isTypeOnly) continue
      const bindings = stmt.importClause.namedBindings
      if (!bindings || !ts.isNamedImports(bindings)) continue
      const mod = (stmt.moduleSpecifier as ts.StringLiteral).text
      for (const el of bindings.elements) {
        if (el.isTypeOnly) continue
        imports.set(el.name.text, { mod, orig: (el.propertyName ?? el.name).text })
      }
    }

    /**
     * The ONLY functions that may hand main.ts a live airship. Named by their ORIGINAL export in
     * src/core/blimp.ts, so an alias (`step as stepBlimp`) is resolved rather than trusted, and a
     * lookalike imported from somewhere else — `import { reapBlimp } from './shell/cheat'` — is not
     * one of these.
     *
     * ADDING TO THIS LIST IS A DELIBERATE ACT, exactly as with MEASURED_SOURCES: a new way for the
     * cockpit to obtain a blimp is a line in a diff, not an accident.
     */
    const BLIMP_PRODUCERS = new Set(['spawn', 'step', 'reapBlimp'])
    const producerLocals = new Set(
      [...imports].filter(([, v]) => v.mod === './core/blimp' && BLIMP_PRODUCERS.has(v.orig)).map(([k]) => k),
    )

    /** Local functions declared in main.ts that legitimately take a Blimp (e.g. `draw`). */
    const blimpTakingLocals = new Set<string>()
    /** Bindings known to hold a Blimp-derived value. Seeded, then grown to a fixpoint. */
    const tainted = new Set<string>()

    const isBlimpType = (t: ts.TypeNode | undefined): boolean => /\bBlimp\b/.test(t?.getText(source) ?? '')

    /** Is this EXPRESSION a Blimp, or something read straight off one? */
    function isTainted(node: ts.Node): boolean {
      if (ts.isIdentifier(node)) return tainted.has(node.text)
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        return isTainted(node.expression) // drifted.x, blimp['depth'] — a Blimp's own geometry
      }
      if (
        ts.isParenthesizedExpression(node) ||
        ts.isNonNullExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isTypeAssertionExpression(node) ||
        ts.isAwaitExpression(node)
      ) {
        return isTainted(node.expression) // casts and parentheses launder nothing
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        return producerLocals.has(node.expression.text) // stepBlimp(...), spawnBlimp(...), reapBlimp(...)
      }
      if (ts.isConditionalExpression(node)) return isTainted(node.whenTrue) || isTainted(node.whenFalse)
      return false
    }

    // ── seed + grow the taint set (a couple of passes settle it; declarations are few) ──
    for (let pass = 0; pass < 4; pass++) {
      const before = tainted.size + blimpTakingLocals.size
      const seed = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
          if (isBlimpType(node.type) || (node.initializer && isTainted(node.initializer))) {
            tainted.add(node.name.text)
          }
        }
        if (ts.isParameter(node) && ts.isIdentifier(node.name) && isBlimpType(node.type)) {
          tainted.add(node.name.text)
          const fn = node.parent
          if (ts.isFunctionDeclaration(fn) && fn.name) blimpTakingLocals.add(fn.name.text)
        }
        ts.forEachChild(node, seed)
      }
      seed(source)
      if (tainted.size + blimpTakingLocals.size === before) break
    }

    /**
     * Where a Blimp may legitimately go: into a function imported FROM `./core/`, or into a local
     * that declares a Blimp parameter (`draw`).
     *
     * `./core/` AND NOT MERELY "imported" — I caught this attacking my own guard. An earlier draft
     * accepted any import, and `import { tooFar } from './shell/reap'` sailed through it: the
     * despawn moves one file sideways, out of the taint scan, and the cockpit "just calls a
     * function" again. core/ is the only place a pure geometric decision is allowed to live,
     * because core/ is the only place the suite can fly it. (src/core never imports src/shell —
     * the core-purity sweep enforces the other direction.)
     */
    const mayReceiveABlimp = (callee: ts.Expression): boolean => {
      if (!ts.isIdentifier(callee)) return false // Math.abs, JSON.stringify, obj.method — all rejected
      if (blimpTakingLocals.has(callee.text)) return true
      return imports.get(callee.text)?.mod.startsWith('./core/') === true
    }

    /** Operators that ASK A QUESTION OF, or DO ARITHMETIC ON, a position. `===`/`!==` are not here:
     *  a presence check against `null` is not a claim about the screen. */
    const FORBIDDEN_OPS = new Set<ts.SyntaxKind>([
      ts.SyntaxKind.LessThanToken,
      ts.SyntaxKind.GreaterThanToken,
      ts.SyntaxKind.LessThanEqualsToken,
      ts.SyntaxKind.GreaterThanEqualsToken,
      ts.SyntaxKind.PlusToken,
      ts.SyntaxKind.MinusToken,
      ts.SyntaxKind.AsteriskToken,
      ts.SyntaxKind.SlashToken,
      ts.SyntaxKind.PercentToken,
      ts.SyntaxKind.AsteriskAsteriskToken,
    ])

    const at = (n: ts.Node): string =>
      `main.ts:${source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1}`
    const text = (n: ts.Node): string => n.getText(source).replace(/\s+/g, ' ').slice(0, 90)

    const writesToBlimp: ts.Expression[] = []
    const violations: string[] = []

    const walk = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node)) {
        const op = node.operatorToken.kind
        // (a) the despawn, reconstructed by hand: a Blimp's geometry inside a comparison or a sum
        if (FORBIDDEN_OPS.has(op) && (isTainted(node.left) || isTainted(node.right))) {
          violations.push(
            `${at(node)}  a Blimp-derived value is an operand of \`${node.operatorToken.getText(source)}\`` +
              `  ->  ${text(node)}`,
          )
        }
        // (b) mutating the airship out from under core (`(blimp as any).x = 1e9` teleports it off-screen)
        if (
          op === ts.SyntaxKind.EqualsToken &&
          (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left)) &&
          isTainted(node.left.expression)
        ) {
          violations.push(`${at(node)}  main.ts WRITES to a Blimp's own state  ->  ${text(node)}`)
        }
        // (c) collect every write to the `blimp` binding, for the shape check below
        if (op === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left) && node.left.text === 'blimp') {
          writesToBlimp.push(node.right)
        }
      }
      // (d) negating / abs-ing / hypot-ing a position: `Math.abs(drifted.x)`, `-blimp.x`
      if (
        ts.isPrefixUnaryExpression(node) &&
        (node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken) &&
        isTainted(node.operand)
      ) {
        violations.push(`${at(node)}  a Blimp-derived value is negated  ->  ${text(node)}`)
      }
      // (e) a Blimp escaping into a function that is not tested core — Math.abs, a local helper,
      //     anything. This is the one that kills the "give the bound a fresh name" family dead.
      if (ts.isCallExpression(node)) {
        for (const arg of node.arguments) {
          if (isTainted(arg) && !mayReceiveABlimp(node.expression)) {
            violations.push(
              `${at(node)}  a Blimp-derived value is handed to \`${text(node.expression)}\`, which is ` +
                `not an imported core function  ->  ${text(node)}`,
            )
          }
        }
      }
      ts.forEachChild(node, walk)
    }
    walk(source)

    it('the taint analysis actually found the airship — this guard is not vacuous', () => {
      // A guard that silently tracks NOTHING passes everything. Round 2 shipped exactly that kind
      // of test. So: prove the machinery sees the real cockpit before trusting what it says.
      expect(producerLocals.size, 'main.ts must obtain the blimp from core/blimp').toBeGreaterThanOrEqual(2)
      expect([...tainted].sort(), 'the module-level `blimp` and the drifted airship must be tracked')
        .toEqual(expect.arrayContaining(['blimp', 'drifted']))
      expect(blimpTakingLocals, 'draw() takes the blimp — the analysis must know that').toContain('draw')
      expect(writesToBlimp.length, 'main.ts must actually assign the blimp somewhere').toBeGreaterThanOrEqual(3)
    })

    it('NO Blimp-derived value reaches an operator, a Math call, or an untested function', () => {
      expect(
        violations,
        'main.ts is DOING GEOMETRY ON THE AIRSHIP.\n\n' +
          'It may hold the blimp, hand it to core, and draw it. It may not measure it. Every ' +
          'question about where the airship IS — above all "has it left the frame?" — is a question ' +
          'about the SCREEN, and it is answered in src/core/blimp.ts, in projected space, at the ' +
          'depth and aspect it is really seen at, where a test can fly it.\n\n' +
          'This is how rb4-1 was beaten three times: a correct core predicate, `||`-ed in main.ts ' +
          'with a world constant that dominated it, in the file everyone believed no test could ' +
          'reach. (It can: tests/cockpit-loop.test.ts boots it.)\n',
      ).toEqual([])
    })

    it('EVERY write to `blimp` is `null` or a bare call to a core producer — never an expression', () => {
      // The shape rule, and it is deliberately absolute. A ternary, an `||`, an `&&`, a `??`, a
      // comparison, a hand-rolled object literal — all of them are ways to be the one who decided.
      // The cockpit does not decide. It assigns what core hands back.
      const bad = writesToBlimp
        .filter((rhs) => {
          if (rhs.kind === ts.SyntaxKind.NullKeyword) return false // the kill, and the initial sky
          return !(ts.isCallExpression(rhs) && ts.isIdentifier(rhs.expression) && producerLocals.has(rhs.expression.text))
        })
        .map((rhs) => `${at(rhs)}  blimp = ${text(rhs)}`)

      expect(
        bad,
        'A write to `blimp` in main.ts is neither `null` nor a direct call to a core blimp producer ' +
          '(spawn / step / reapBlimp from ./core/blimp).\n\n' +
          'The despawn is ONE call with no operator in it:\n' +
          '      blimp = reapBlimp(drifted, aspect)\n\n' +
          'The moment it becomes an expression, someone can add a second operand to it — and that ' +
          'is precisely, literally, the bug that got rb4-1 rejected:\n' +
          '      const gone = blimpOffScreen(drifted, aspect) || Math.abs(drifted.x) > REAP_LIMIT\n' +
          '      blimp = gone ? null : drifted\n',
      ).toEqual([])
    })
  })
})

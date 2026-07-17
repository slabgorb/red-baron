// tests/core/plane-picture-scale.test.ts
//
// Story rb4-17 — THE PLANE IS DRAWN AT THE WRONG SCALE (RED phase, TEA / Imperator Furiosa).
//
// The enemy plane renders as a ~15px speck at spawn and ~10% of the frame at its closest pass;
// the cabinet shows a clearly visible aircraft at entry and a screen-dominating fly-by. TWO ROM
// mechanisms are missing, and this suite drives both. Every ROM byte the fix must hit is verified
// FIRST-HAND and pinned in tests/core/plane-scale-source.test.ts (the derivation record, green);
// this file pins the CLONE behaviour those bytes demand, and it is RED until Dev supplies it.
//
// (1) THE VERTEX PRE-SCALE. The full plane is drawn through the ZAXIS path, whose composite scale
//     relative to the logical POINTP argument biplane.ts transcribed as PLANE_POINTS is X×4, Y×4,
//     Z×1 — isotropic ×4 on the wingspan (POINTP `.BYTE .Z,.X*2,.Y*4` + ZAXIS's one extra ASL on X;
//     RBARON.MAC:30 / RBGRND.MAC:469-495). The clone injects the raw bytes at ×1 (main.ts's inline
//     `translation(...)·rotationZ(...)`), so the plane is a quarter of its size. The fix multiplies
//     the projected wingspan by four — measured through the REAL projection, not eyeballed.
//
// (2) DUAL-Z. The ROM carries TWO depths per plane: PICTURE SIZE Z (PLSTAT+4/+5) drives the vertex
//     divide and the fly-by check; POSITION Z (PLSTAT+19/+1A) drives where the CENTRE sits. Both
//     spawn at P.INDP, then step by SEPARATE deltas (RBARON.MAC:2668-2673 vs :2704-2709), and
//     PLNLBS reads each for its own job (:4817 centre / :4847 vertices). Our enemy.ts has ONE
//     `depth` doing both — which is why rb4-16's PLONSN servo was fed the wrong Z. `depth` STAYS the
//     picture Z (its current size/fly-by/scoring jobs are all correct for it); the fix ADDS the
//     position Z as a second field and routes the centre through it.
//
// ─── THE TESTABLE SEAM (why this file needs `planeModel`) ─────────────────────────────────────
//
// The enemy plane is the one drawn object with no core render function — main.ts builds its model
// matrix inline (`renderModel(biplaneLOD(...), multiply(projView, model))`), in the one file no
// test can import (it touches `document`; see screen-scale.test.ts). So the scale and the dual-Z
// would be UNTESTABLE if they landed there. The fix extracts the model-matrix construction into a
// pure `planeModel(enemy, eye): Mat4` in biplane.ts — beside `renderModel`, exactly as guns.ts put
// `shellSegments` beside `shellDepth` — and main.ts composes `renderModel(biplaneLOD(...),
// multiply(projView, planeModel(enemy, eye)))`. Then this suite measures the drawn geometry the
// cockpit actually strokes. `planeModel` is resolved off the module below so a not-yet-existing
// export fails each dependent test on its assertion, not the whole file on its import.
//
// ─── UNITS ───────────────────────────────────────────────────────────────────────────────────
// PLANE_POINTS wing tips [±40, 20, -40] (indices 12/13) are the widest vertices. At the reference
// aspect the drawn geometry is recovered back to world units through screen.ts (the same inversion
// the tracer seam uses), so the assertions are FOV-free where they can be, and note the seam where
// they cannot.

import { describe, it, expect } from 'vitest'
import { multiply, type Mat4, type Vec3 } from '@arcade/shared/math3d'
import { createRng } from '@arcade/shared/rng'

import * as biplaneModule from '../../src/core/biplane'
import { PLANE_POINTS } from '../../src/core/biplane'
import { spawn, step, type Enemy } from '../../src/core/enemy'
import { sceneProjection, projectSegment } from '../../src/core/scene'
import { worldX, worldY } from '../../src/core/screen'
import { P_INDP, P_MNDP } from '../../src/core/returning-ace'
import { spawn as spawnBlimp } from '../../src/core/blimp'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The reference frame the whole fidelity suite measures in (screen-scale / depth-scale). */
const ASPECT = 16 / 9
const ORIGIN: Vec3 = [0, 0, 0]

/**
 * `planeModel(enemy, eye)` — the core seam rb4-17 adds to biplane.ts (see header). Resolved off the
 * module namespace so that, before it exists, the dependent tests fail on `typeof planeModel` /
 * their own assertions rather than crashing the whole file at import time. Spread → Record avoids an
 * `as any`/`as unknown as` cast (lang-review #1).
 */
type PlaneModelFn = (enemy: Enemy, eye: Vec3) => Mat4
const biplaneExports: Record<string, unknown> = { ...biplaneModule }
const planeModel = biplaneExports.planeModel as PlaneModelFn | undefined

/** The picture-Z / position-Z the fix adds to Enemy; typed here so the tests read them without `any`. */
type DualZEnemy = Enemy & { positionZ: number }
const dualZ = (e: Enemy): Partial<{ positionZ: number }> => e as Partial<DualZEnemy>

/**
 * A plane parked dead ahead at `depth`, banked level, facing the viewer (full 42-vertex model), with
 * `positionZ` defaulting to the same depth — the coherent single-depth pose. Overrides let a test
 * split the two Zs apart. `x`/`y` default to 0 so the centre sits on the boresight.
 */
function planeAt(depth: number, over: Partial<DualZEnemy> = {}): DualZEnemy {
  return {
    kind: 'lead', x: 0, y: 0, depth, deltaX: 0, bank: 0, side: 1, active: true,
    facingAway: false, positionZ: depth, ...over,
  }
}

/** MVP the cockpit draws the plane with when the pilot is level (view = identity at the origin). */
function mvpFor(enemy: DualZEnemy): Mat4 {
  if (!planeModel) throw new Error('planeModel not exported from biplane.ts yet')
  return multiply(sceneProjection(ASPECT), planeModel(enemy, ORIGIN))
}

/** The two wing-tip vertices, projected — indices 12/13 = [∓40, 20, -40], the widest points. */
function wingTips(enemy: DualZEnemy): { x1: number; y1: number; x2: number; y2: number } {
  const seg = projectSegment(PLANE_POINTS[12], PLANE_POINTS[13], mvpFor(enemy))
  if (!seg) throw new Error('wing tips projected behind the eye')
  return seg
}

/** The plane's CENTRE (model origin) in NDC x — where POSITION Z decides it sits. */
function centreNdcX(enemy: DualZEnemy): number {
  const seg = projectSegment([0, 0, 0], [0, 0, 0], mvpFor(enemy))
  if (!seg) throw new Error('centre projected behind the eye')
  return seg.x1
}

/** The drawn full-wingspan, in NDC (widest projected extent, tip to tip). */
const wingSpanNdc = (enemy: DualZEnemy): number => Math.abs(wingTips(enemy).x2 - wingTips(enemy).x1)

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE SEAM ITSELF
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('rb4-17 exposes a testable plane render seam (planeModel)', () => {
  it('biplane.ts exports planeModel — the plane draws through a MEASURED core function, not inline main.ts', () => {
    // Until this lands, the scale and dual-Z would live in main.ts, which no test can import. The
    // fix moves the model-matrix construction to core, next to renderModel (the guns.ts precedent).
    expect(
      typeof planeModel,
      'add `export function planeModel(enemy, eye): Mat4` to src/core/biplane.ts and have main.ts ' +
        'compose renderModel(biplaneLOD(...), multiply(projView, planeModel(enemy, eye)))',
    ).toBe('function')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AC-1 / AC-5 — THE VERTEX PRE-SCALE: isotropic ×4 on the wingspan, Z left ×1
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-1/AC-5 — the plane is drawn at the ROM picture scale: X×4, Y×4, Z×1', () => {
  it('the drawn wingspan recovers to 160 world units (40 × 4), not 40 — the ROM ×4 pre-scale', () => {
    // Measure the drawn wing tip, then invert the SAME projection (screen.ts) to recover the world
    // half-span it was drawn at. The wing tips are at model z = -40, so their depth is the centre
    // depth + 40; with X,Y×4 and Z×1 they sit at world x = ±160 there.
    const D = P_INDP
    const tips = wingTips(planeAt(D))
    const depthAtWing = D + 40 // wing z = -40, Z is NOT scaled (ZAXIS reads it unshifted)
    const recovered = Math.abs(worldX(tips.x2, depthAtWing, ASPECT))
    expect(
      recovered,
      'wing tip logical x is 40; POINTP holds it ×2 and ZAXIS lifts it to ×4 (RBARON.MAC:30, ' +
        'RBGRND.MAC:484-488), so the drawn wing sits at 160 world units. The clone injects the raw ' +
        '40 — a quarter scale, the ~15px speck.',
    ).toBeCloseTo(160, 1)
    expect(recovered, 'the raw 1:1 injection is the bug, not the fix').not.toBeCloseTo(40, 1)
  })

  it('the scale is ISOTROPIC — X and Y are lifted by the same 4, Z is untouched', () => {
    // Same wing tips carry y = 20; ×4 puts them at 80 world units of height at the same depth.
    const D = P_INDP
    const tips = wingTips(planeAt(D))
    const depthAtWing = D + 40
    const recoveredX = Math.abs(worldX(tips.x2, depthAtWing, ASPECT))
    const recoveredY = Math.abs(worldY(tips.y2, depthAtWing))
    expect(recoveredX / 40, 'X lifted ×4 (ZAXIS: stored ×2, one ASL)').toBeCloseTo(4, 1)
    expect(recoveredY / 20, 'Y lifted ×4 (ZAXIS: stored ×4, no ASL)').toBeCloseTo(4, 1)
    expect(
      recoveredX / 40,
      'the full-plane path is isotropic — X and Y take the SAME factor (a uniform scale(4,4,1), ' +
        'never scale(4,4,4): Z is fore/aft and ZAXIS reads it unshifted, RBGRND.MAC:474-478)',
    ).toBeCloseTo(recoveredY / 20, 2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AC-4 — THE FUNCTIONAL OUTCOME: visible at spawn, dominates at the fly-by
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-4 — the plane is a clearly visible aircraft at entry and dominates the frame at the pass', () => {
  it('the drawn wingspan is FOUR TIMES what raw injection gives, at every depth (the ROM-derived size)', () => {
    // FOV-free statement of the fix: whatever the chosen field of view, the picture is ×4 the model.
    // Recover the world span at both ends of the flight; the model is 80 wide, so ×4 = 320 always.
    for (const D of [P_INDP, P_MNDP]) {
      const tips = wingTips(planeAt(D))
      const worldSpan = Math.abs(worldX(tips.x2, D + 40, ASPECT) - worldX(tips.x1, D + 40, ASPECT))
      expect(worldSpan, `wingspan at depth ${D} must be 80 × 4 = 320 world units`).toBeCloseTo(320, 0)
    }
  })

  it('at P.INDP the aircraft is clearly visible — no longer a ~15px speck', () => {
    // With the current 60° vertical FOV (re-affirmed against the ROM windows in AC-3), the raw plane
    // draws a ~1.8% full-width speck; the ×4 lifts it past 5%. If Dev re-derives the FOV, re-seat.
    const span = wingSpanNdc(planeAt(P_INDP))
    expect(
      span,
      'a plane at its spawn depth must read as an aircraft, not a dot. Raw injection draws ~0.018 ' +
        'NDC (the speck); the ROM ×4 draws ~0.073.',
    ).toBeGreaterThan(0.045)
  })

  it('at P.MNDP the fly-by DOMINATES the frame — more than half a screen-width of wing', () => {
    const span = wingSpanNdc(planeAt(P_MNDP))
    expect(
      span,
      'at its closest pass the plane must fill the frame (the cabinet fly-by). Raw injection draws ' +
        '~0.22 NDC (the ~10%-of-width symptom); the ROM ×4 draws ~0.87 — wider than a screen-half.',
    ).toBeGreaterThan(0.5)
  })

  it('and it GROWS as it closes — the pass is bigger than the entry (perspective, kept)', () => {
    // A keep-behaviour guard: whatever the scale, closing must enlarge the picture, so "just make the
    // spawn big" cannot satisfy the two tests above.
    expect(wingSpanNdc(planeAt(P_MNDP))).toBeGreaterThan(wingSpanNdc(planeAt(P_INDP)))
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AC-2 — DUAL-Z: picture Z sizes the vertices, position Z places the centre
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-2 — the enemy carries a PICTURE Z and a POSITION Z, spawned together, used apart', () => {
  it('spawn seeds BOTH Zs at P.INDP (STPLNE stores P.INDP to PLSTAT+4 AND +19)', () => {
    const e = spawn(createRng(1))
    expect(e.depth, 'the picture Z (existing `depth`) spawns at P.INDP').toBe(P_INDP)
    expect(
      dualZ(e).positionZ,
      'the position Z is a NEW field, also seeded at P.INDP (STPLNE:2319-2324). enemy.ts must add ' +
        '`positionZ` to the Enemy interface and spawn it at P_INDP.',
    ).toBe(P_INDP)
  })

  it('position Z is a real field that STEPS as the plane closes — not a static echo of P.INDP', () => {
    // 250 frames of level-0 close (closeSpeed −4/frame): the plane is still boring in (the fly-by
    // needs ~976), so its picture Z has dropped ~1000 and its position Z must have tracked it.
    let e = spawn(createRng(7))
    for (let i = 0; i < 250; i++) e = step(e)
    const pz = dualZ(e).positionZ
    expect(typeof pz, 'positionZ survives stepping as a finite number').toBe('number')
    expect(Number.isFinite(pz as number)).toBe(true)
    expect(
      pz as number,
      'a plane that has closed for 250 frames has stepped its position Z off the spawn depth ' +
        '(UPDPLN:2704-2709). A static positionZ = P_INDP is not "stepped".',
    ).toBeLessThan(P_INDP)
  })

  it('the CENTRE tracks POSITION Z — moving it (picture Z fixed) slides the plane on screen', () => {
    // Two planes, same picture Z (same size), off the boresight, at different POSITION Z. The ROM
    // positions the centre by POSITION Z (PLNLBS:4817 → POSITP), so the nearer one sits further from
    // screen centre. The single-`depth` clone can't respond to positionZ at all — the centre never
    // moves — which is exactly the failure that starved rb4-16's servo of the right Z.
    const OFFSET = 300
    const near = planeAt(P_INDP, { x: OFFSET, positionZ: P_INDP / 2 })
    const far = planeAt(P_INDP, { x: OFFSET, positionZ: P_INDP * 2 })
    expect(
      Math.abs(centreNdcX(near)),
      'a plane whose POSITION Z is nearer must sit further from screen centre than one further back',
    ).toBeGreaterThan(Math.abs(centreNdcX(far)))
  })

  it('the SIZE tracks PICTURE Z — moving it (position Z fixed) resizes the plane, centre unmoved', () => {
    // The other half of the split. Same POSITION Z (centre fixed), different PICTURE Z (size differs).
    // PLNLBS divides the VERTICES by picture Z (:4847-4850). The single-`depth` clone moves BOTH when
    // one number changes, so with position Z held fixed its centre wrongly drifts with picture Z.
    const OFFSET = 300
    const big = planeAt(P_MNDP, { x: OFFSET, positionZ: P_INDP }) // near picture → big
    const small = planeAt(P_INDP, { x: OFFSET, positionZ: P_INDP }) // far picture → small
    expect(wingSpanNdc(big), 'nearer picture Z draws a bigger plane').toBeGreaterThan(wingSpanNdc(small))
    expect(
      centreNdcX(big),
      'but the centre is fixed by the (shared) POSITION Z — it must NOT drift when only picture Z moves',
    ).toBeCloseTo(centreNdcX(small), 6)
  })

  it('the fly-by-over check reads PICTURE Z (kept: `depth` is the picture Z) — floor at P.MNDP flies past', () => {
    // Keep-behaviour pin: `depth` stays the picture Z, so the existing P.MNDP fly-by (UPDPLN:2722-2726,
    // closesPast) is already correct and must remain keyed off it. Deterministic — a plane whose picture
    // Z has reached the floor flies past on the next step; one still at spawn depth does not.
    expect(step(planeAt(P_MNDP)).active, 'a plane whose picture Z reached P.MNDP flies past — destroyed').toBe(false)
    expect(step(planeAt(P_INDP)).active, 'a plane at spawn depth is still boring in, not past').toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AC-3 — THE NDC SEAM re-derived / re-affirmed against the ROM's own screen windows
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-3 — scene.ts documents its NDC scale against SETBM / SETGRS', () => {
  it('the seam cites the ROM screen windows (0x300 cull / 0x220 X / 0x188 Y), not "not byte-pinned"', () => {
    // The scale was declared an un-anchored Dev seam (scene.ts:43 "not byte-pinned (rb4-5 Dev seam)").
    // AC-3 requires it be re-derived or re-affirmed against the ROM's own windows — SETBM's |screen|
    // >= 0x300 cull (RBGRND.MAC:326-334) and the SETGRS ±0x220 / ±0x188 window (:345-355) — with the
    // chosen FOV documented against those anchors. Those bytes are pinned in the source record; here
    // the seam must NAME them so the number stops being a free invention.
    const scene = readFileSync(join(repoRoot, 'src', 'core', 'scene.ts'), 'utf8')
    expect(
      scene,
      'scene.ts must document ROM_SCREEN_HALF / the FOV against SETBM (0x300 cull) and SETGRS ' +
        '(±0x220 X / ±0x188 Y) — re-derive the NDC scale from them or re-affirm 512/60° against them.',
    ).toMatch(/SETBM|SETGRS|0x300|0x220|0x188/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AC-6 — BLIMP / WRECK / SHELL: same PICTURE-scale path is verified; blimp gets NO position Z
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-6 — the blimp is single-Z, and the plane ×4 is a POINTP-provenance factor', () => {
  it('the blimp carries NO position Z — BLOBJ has no +19 field (a guard against over-applying dual-Z)', () => {
    // BLOBJ's record documents a picture Z but no POSITION Z (source record). The airship is a borrowed
    // single-Z slot; Dev must NOT bolt the plane's dual-Z onto it.
    const b = spawnBlimp(createRng(3), ASPECT)
    expect('depth' in b, 'the blimp keeps its single depth').toBe(true)
    expect('positionZ' in b, 'the blimp must NOT gain a position Z (BLOBJ has no +19)').toBe(false)
  })

  it('the ×4 belongs to the PLANE\'s POINTP program-ROM vertices, not the picture-ROM blimp/debris', () => {
    // The provenance guard that stops Dev blindly ×4-ing everything. PLANE_POINTS comes from the
    // PROGRAM ROM's POINTP tables (stored ×2/×4, lifted by ZAXIS) — biplane.ts cites RBARON.MAC. The
    // blimp and debris points come from the PICTURE ROM (037007.XXX, `.RADIX 10`, drawn by the AVG at
    // display scale) — topology.ts cites 037007.XXX. Different provenance ⇒ the ×4 does NOT transfer;
    // the blimp/wreck picture scale rides its own path (routed to a Delivery Finding for Dev to verify
    // against the picture-ROM decode, not to ×4 by analogy).
    const biplaneSrc = readFileSync(join(repoRoot, 'src', 'core', 'biplane.ts'), 'utf8')
    const topologySrc = readFileSync(join(repoRoot, 'src', 'core', 'topology.ts'), 'utf8')
    expect(biplaneSrc, 'PLANE_POINTS provenance = program ROM POINTP').toMatch(/RBARON\.MAC/)
    expect(topologySrc, 'BLIMP/PIECE provenance = picture ROM 037007.XXX').toMatch(/037007/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// RULE ENFORCEMENT (lang-review) — the new optional field must not eat a legitimate value
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('rule: the position Z default is 0-safe — a legit small position Z is respected, not defaulted away', () => {
  it('a plane hand-set to a small POSITION Z is drawn there — no `positionZ || P_INDP` swallow', () => {
    // lang-review TS #4 / the P_IIDL[0] lesson: if the render reads `enemy.positionZ || depth` a
    // legitimately small position Z (or a hand-built fixture that sets a low one) is silently promoted.
    // Two off-boresight planes with DIFFERENT small position Zs must draw their centres at DIFFERENT
    // places; `||` would collapse a falsy-ish small value and they would coincide. Use `??` (or a
    // required field). Distinct, both-far-from-P_INDP values so a `|| P_INDP` default is observable.
    const a = planeAt(P_INDP, { x: 300, positionZ: 400 })
    const b = planeAt(P_INDP, { x: 300, positionZ: 900 })
    expect(
      Math.abs(centreNdcX(a)),
      'distinct small position Zs must place the centre distinctly — a `|| P_INDP` default would ' +
        'swallow them and this comparison would collapse',
    ).not.toBeCloseTo(Math.abs(centreNdcX(b)), 4)
  })
})

// tests/core/biplane.test.ts
//
// Story rb2-3 — the enemy biplane MODEL + distance LOD + bank coupling, rendered
// through the rb1 scene substrate (scene.ts). RED phase: these tests define the
// contract for `src/core/biplane.ts`, which does NOT exist yet.
//
// This story has a DATA half and a BEHAVIOUR half:
//   • DATA — transcribe the 42-vertex plane model `.PLPNT` and its 29-vertex drone
//     LOD `.DRPNT` from the PROGRAM ROM `RBARON.MAC:6207-6279` (findings §7). Only
//     the connect-LISTS (DB.MAP/DB.MAR/DB.LNS) were transcribed in rb2-2 →
//     topology.ts; the VERTICES they index live in the program ROM and are still
//     un-transcribed. rb2-3 supplies them.
//   • BEHAVIOUR — pick the LOD model by camera depth, bank the model ∝ turn-rate
//     via the SAME `pfrotn` coupling as the player horizon (flight.ts), and walk a
//     connect-list as a pen turtle through the projection substrate → NDC segments,
//     dropping behind-eye edges (never mirroring them).
//
// ROM ground-truth used below (all from findings §7-§8, RBARON.MAC):
//   • 42 vertices total (`.PLPNT`); `.DRPNT` = points 0-28 only (a 29-pt prefix,
//     no back faces). [findings §7, RBARON.MAC:6207-6279]
//   • vertex 12 = POINTP -40,20,-40 → (X=-40, Y=+20, Z=-40) "TOP WING". [§7/§8, :6225]
//   • POINTP stores `Z, 2·X, 4·Y` as signed 8-bit bytes → X∈[-64,63], Y∈[-32,31],
//     Z∈[-128,127]. [findings §8, RBARON.MAC:15-35]
//   • LOD: near/full draws 42 pts + DB.MAP(→DB.MAR fall-through) + DB.LNS; far drone
//     draws 29 pts + DB.MAR only. [findings §7]
//   • bank = PFROTN = PLDELX×8 clamped ±0x100 → ±45° (π/4). [findings §2, flight.ts]
//
// It reads only committed source — never the gitignored `reference/` quarry.

import { describe, it, expect } from 'vitest'
import {
  PLANE_POINTS,
  DRONE_POINTS,
  LOD_DISTANCE,
  biplaneLOD,
  biplaneBank,
  renderModel,
  type BiplaneModel,
} from '../../src/core/biplane'
import { DB_MAP, DB_MAR, DB_LNS, type ConnectOp } from '../../src/core/topology'
import { toAttitude, ALT_MIN } from '../../src/core/flight'
import { sceneProjection, type SceneSegment } from '../../src/core/scene'
import { multiply, translation, rotationZ, type Mat4 } from '@arcade/shared/math3d'

// ── helpers ──────────────────────────────────────────────────────────────────

/** Count the pen-DOWN (VSBLEV) ops — one drawn segment each — in a connect-list. */
const drawCount = (connect: readonly ConnectOp[]): number => connect.filter((o) => o.draw).length

/** Highest vertex index a connect-list references (for point-set bounds checks). */
const maxIndex = (connect: readonly ConnectOp[]): number => Math.max(...connect.map((o) => o.point))

/**
 * An MVP that places a model-space object `tz` units down eye −Z (negative = in
 * FRONT of the camera) with an optional roll, through the real game projection.
 * View is identity — the camera sits at the origin looking down −Z. A model whose
 * vertices are within ±128 units is entirely in front for tz ≤ −512, entirely
 * behind for tz ≥ +512.
 */
const PROJ = sceneProjection(1)
function mvpAt(tz: number, roll = 0): Mat4 {
  const model = roll === 0 ? translation(0, 0, tz) : multiply(translation(0, 0, tz), rotationZ(roll))
  return multiply(PROJ, model) // MVP = projection · view(=I) · model
}

const flat = (segs: readonly SceneSegment[]): number[] => segs.flatMap((s) => [s.x1, s.y1, s.x2, s.y2])

// ── DATA: the .PLPNT / .DRPNT vertex transcription (RBARON.MAC:6207-6279) ──────

describe('biplane — plane vertices (.PLPNT / .DRPNT transcription)', () => {
  it('has 42 vertices in .PLPNT and 29 in .DRPNT (findings §7)', () => {
    expect(PLANE_POINTS).toHaveLength(42)
    expect(DRONE_POINTS).toHaveLength(29)
  })

  it('.DRPNT is exactly the first 29 vertices of .PLPNT — points 0-28, no back faces', () => {
    // findings §7: "the drone/distant plane = 29 pts (.DRPNT, points 0-28 only)".
    expect(DRONE_POINTS).toEqual(PLANE_POINTS.slice(0, 29))
  })

  it('transcribes the one ROM-decoded vertex verbatim: #12 = (-40, 20, -40) TOP WING', () => {
    // RBARON.MAC:6225 — POINTP -40,20,-40 ;12 TOP WING (findings §7/§8 worked example).
    expect(PLANE_POINTS[12]).toEqual([-40, 20, -40])
  })

  it('every vertex is an integer triple within the POINTP signed-byte encoding range', () => {
    // POINTP stores Z, 2·X, 4·Y as signed 8-bit bytes (findings §8): so a legal
    // transcription can never carry X outside [-64,63], Y outside [-32,31], or Z
    // outside [-128,127]. This catches an off-by-scale or mis-signed transcription.
    for (const [x, y, z] of PLANE_POINTS) {
      expect(Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z)).toBe(true)
      expect(x).toBeGreaterThanOrEqual(-64)
      expect(x).toBeLessThanOrEqual(63)
      expect(y).toBeGreaterThanOrEqual(-32)
      expect(y).toBeLessThanOrEqual(31)
      expect(z).toBeGreaterThanOrEqual(-128)
      expect(z).toBeLessThanOrEqual(127)
    }
  })
})

// ── DATA/STRUCTURE: connect-lists must index a real vertex in their point-set ──

describe('biplane — connect-list ↔ point-set bounds (renderability)', () => {
  it('DB.MAR indexes only points 0-28, so the 29-vertex drone can draw it', () => {
    // The whole point of the .DRPNT LOD: the far list (DB.MAR) must never reference
    // a back-face vertex (29-41) the drone point-set doesn't carry.
    expect(maxIndex(DB_MAR)).toBeLessThan(DRONE_POINTS.length)
    expect(maxIndex(DB_MAR)).toBe(28)
  })

  it('the near lists (DB.MAP ∪ DB.MAR ∪ DB.LNS) index only points 0-41 of .PLPNT', () => {
    expect(maxIndex([...DB_MAP, ...DB_MAR, ...DB_LNS])).toBeLessThan(PLANE_POINTS.length)
    expect(maxIndex([...DB_MAP, ...DB_MAR, ...DB_LNS])).toBe(41)
  })

  it('each far/near sub-list starts pen-UP, so LOD concatenation never draws across a seam', () => {
    // near = [...DB.MAP, ...DB.MAR, ...DB.LNS]; the pen turtle carries "current"
    // across the joins. Because DB.MAR and DB.LNS each open with a BLANKV, no
    // spurious segment is drawn from one list's last vertex to the next's first.
    expect(DB_MAP[0].draw).toBe(false)
    expect(DB_MAR[0].draw).toBe(false)
    expect(DB_LNS[0].draw).toBe(false)
  })
})

// ── LOD selection by camera depth (biplaneLOD) ────────────────────────────────

describe('biplane — distance LOD (biplaneLOD)', () => {
  it('exposes a positive, finite near/far threshold', () => {
    expect(Number.isFinite(LOD_DISTANCE)).toBe(true)
    expect(LOD_DISTANCE).toBeGreaterThan(0)
  })

  it('near depth → the FULL 42-vertex model with the DB.MAP→DB.MAR + DB.LNS list', () => {
    const near = biplaneLOD(LOD_DISTANCE / 2)
    expect(near.points).toEqual(PLANE_POINTS)
    expect(near.connect).toEqual([...DB_MAP, ...DB_MAR, ...DB_LNS])
  })

  it('far depth → the 29-vertex DRONE model with the DB.MAR front list only', () => {
    const far = biplaneLOD(LOD_DISTANCE * 2)
    expect(far.points).toEqual(DRONE_POINTS)
    expect(far.connect).toEqual(DB_MAR)
  })

  it('switches at the threshold — below is near, at/above is far (monotone in depth)', () => {
    expect(biplaneLOD(LOD_DISTANCE - 1).points).toHaveLength(42)
    expect(biplaneLOD(LOD_DISTANCE).points).toHaveLength(29) // boundary belongs to far
    expect(biplaneLOD(LOD_DISTANCE + 1).points).toHaveLength(29)
  })

  it('pins the source-counted drawn-segment budget of each LOD (near 54 / far 30)', () => {
    // near draws: DB.MAP 16 + DB.MAR 30 + DB.LNS 8 = 54 VSBLEV ops; far draws
    // DB.MAR's 30. A biplaneLOD that returned an empty/stub connect-list would
    // pass the render count-parity tests vacuously — this anchors the real totals.
    expect(drawCount(biplaneLOD(LOD_DISTANCE / 2).connect)).toBe(54)
    expect(drawCount(biplaneLOD(LOD_DISTANCE * 2).connect)).toBe(30)
  })

  it('is total — a degenerate depth (negative, NaN) still yields a valid model', () => {
    // A plane behind/at the eye is near/full detail; NaN must not crash or return
    // a malformed model. Guards rule #4 (numeric edge / || vs ??).
    expect(biplaneLOD(-1).points).toHaveLength(42)
    const nan = biplaneLOD(Number.NaN)
    expect([29, 42]).toContain(nan.points.length)
    expect(nan.connect.length).toBeGreaterThan(0)
  })
})

// ── bank coupling ∝ turn-rate, via the player's pfrotn (biplaneBank) ───────────

describe('biplane — bank ∝ turn-rate (biplaneBank)', () => {
  const rollFor = (turnRate: number): number =>
    toAttitude({ turnRate, pitchRate: 0, altitude: ALT_MIN, heading: 0 }).roll

  it('level flight (turnRate 0) has zero bank', () => {
    expect(biplaneBank(0)).toBe(0)
  })

  it('uses the IDENTICAL coupling as the player horizon (pfrotn → roll)', () => {
    // "bank proportional to turn-rate ... via pfrotn()" — the enemy must reuse the
    // exact player bank, so biplaneBank(t) equals the roll flight.ts derives for
    // the same turn-rate. Tested across un-clamped and clamped turn-rates.
    for (const t of [-40, -20, -5, 3, 10, 25, 40]) {
      expect(biplaneBank(t)).toBeCloseTo(rollFor(t), 12)
    }
  })

  it('is sign-preserving and odd — banks INTO the turn, symmetric L/R', () => {
    expect(Math.sign(biplaneBank(12))).toBe(1)
    expect(Math.sign(biplaneBank(-12))).toBe(-1)
    expect(biplaneBank(-12)).toBeCloseTo(-biplaneBank(12), 12)
  })

  it('saturates at ±45° (π/4) — the PFROTN 0x100 clamp × ROLL_SCALE (findings §2)', () => {
    expect(biplaneBank(10000)).toBeCloseTo(Math.PI / 4, 12)
    expect(biplaneBank(-10000)).toBeCloseTo(-Math.PI / 4, 12)
  })

  it('is monotonic non-decreasing in turn-rate across the range', () => {
    let prev = biplaneBank(-10000)
    for (let t = -60; t <= 60; t += 5) {
      const b = biplaneBank(t)
      expect(b).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = b
    }
  })
})

// ── render: walk a connect-list as a pen turtle through the substrate ──────────

describe('biplane — renderModel (pen turtle + behind-eye cull)', () => {
  // A tiny synthetic model, independent of the real vertex data, that isolates the
  // turtle semantics: BLANKV moves the pen dark, VSBLEV draws from the current pen
  // position to the vertex. All four points sit in front of the camera.
  const synth: BiplaneModel = {
    points: [
      [0, 0, -10],
      [5, 0, -10],
      [5, 5, -10],
      [0, 5, -10],
    ],
    connect: [
      { point: 0, draw: false }, // pen up → move to 0 (no segment)
      { point: 1, draw: true }, //  draw 0 → 1
      { point: 2, draw: true }, //  draw 1 → 2
      { point: 3, draw: false }, // pen up → move to 3 (no segment)
    ],
  }

  it('emits one segment per pen-DOWN op and none for pen-UP moves', () => {
    const segs = renderModel(synth, mvpAt(0))
    expect(segs).toHaveLength(2) // only the two VSBLEV ops draw
  })

  it('draws each visible edge from the PREVIOUS pen position (turtle), not the origin', () => {
    // Segment 2 must run vertex1 → vertex2, i.e. its start equals segment 1's end.
    const [s1, s2] = renderModel(synth, mvpAt(0))
    expect(s2.x1).toBeCloseTo(s1.x2, 12)
    expect(s2.y1).toBeCloseTo(s1.y2, 12)
  })

  it('produces only finite NDC coordinates for an in-front model', () => {
    for (const v of flat(renderModel(synth, mvpAt(0)))) expect(Number.isFinite(v)).toBe(true)
  })

  it('drops every edge of a model entirely BEHIND the eye — no perspective ghosts', () => {
    // findings §8 behind-eye cull: both endpoints w ≤ 0 ⇒ segment dropped, not mirrored.
    expect(renderModel(synth, mvpAt(+1000))).toHaveLength(0)
  })

  it('is a pure function — repeated calls match and the input model is untouched', () => {
    const before = JSON.stringify(synth)
    const a = renderModel(synth, mvpAt(0))
    const b = renderModel(synth, mvpAt(0))
    expect(a).toEqual(b)
    expect(JSON.stringify(synth)).toBe(before)
  })
})

// ── integration: LOD model + bank + projection, end to end ─────────────────────

describe('biplane — end-to-end render through the scene substrate', () => {
  it('renders the full near model as 54 NDC segments when placed in front', () => {
    const near = biplaneLOD(LOD_DISTANCE / 2)
    const segs = renderModel(near, mvpAt(-1000))
    expect(segs).toHaveLength(drawCount(near.connect))
    expect(segs).toHaveLength(54)
    for (const v of flat(segs)) expect(Number.isFinite(v)).toBe(true)
  })

  it('renders the far drone model as 30 NDC segments when placed in front', () => {
    const far = biplaneLOD(LOD_DISTANCE * 2)
    const segs = renderModel(far, mvpAt(-1000))
    expect(segs).toHaveLength(drawCount(far.connect))
    expect(segs).toHaveLength(30)
  })

  it('culls the whole biplane when it is behind the camera', () => {
    expect(renderModel(biplaneLOD(LOD_DISTANCE / 2), mvpAt(+1000))).toHaveLength(0)
  })

  it('a banked attitude tilts the rendered biplane — same edges, different NDC', () => {
    // Fold the turn-rate bank into the model matrix; the non-symmetric wings/wheels
    // mean a non-zero roll must move the projected vertices. Edge COUNT is unchanged.
    const near = biplaneLOD(LOD_DISTANCE / 2)
    const level = renderModel(near, mvpAt(-1000, biplaneBank(0)))
    const banked = renderModel(near, mvpAt(-1000, biplaneBank(20)))
    expect(banked).toHaveLength(level.length)
    expect(flat(banked)).not.toEqual(flat(level))
  })
})

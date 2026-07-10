// tests/core/topology.test.ts
//
// Verifies the Red Baron vector topology transcribed into `src/core/topology.ts`:
//   • rb2-2 — the aerial picture ROM `reference/red-baron/037007.XXX`
//     (= `RBPICS.MAC`): biplane / prop / explosion / star / blimp;
//   • rb3-1 — the ground-wave landscape DATA from `RBGRND.MAC`: the `SCAPE0..3`
//     mountain silhouettes, the `PFOCOL` collision boxes, and the horizon/
//     altitude constants.
//
// These are TRANSCRIPTION stories: the value is fidelity to the source bytes, so
// the suite guards (a) the BLANKV/VSBLEV opcode arithmetic, (b) the exact,
// source-counted length of every list / point-set, (c) FULL literal value pins of
// the transcribed coordinates against the .MAC listing, and (d) the structural
// invariants (every connect-op indexes a real vertex; every PFOCOL box pair is
// min ≤ max). It reads only red-baron's own committed source — never the
// gitignored `reference/` quarry — so it passes in a fresh clone.

import { describe, it, expect } from 'vitest'
import {
  type ConnectOp,
  type Point3,
  POINT_STRIDE,
  OP_BLANK,
  OP_VISIBLE,
  ENDDB,
  encodeOp,
  decodeOp,
  DB_MAP,
  DB_MAR,
  DB_LNS,
  COLLD_POINTS,
  DBPROP_POINTS,
  PPROPA,
  PPROPB,
  PPROPC,
  PROPS,
  PIECE0_POINTS,
  PIECE1_POINTS,
  PIECE2_POINTS,
  PIECE3_POINTS,
  PCDEC0,
  PCDEC1,
  PCDEC2,
  PLPCDE,
  EXPLOSION_PIECES,
  STAR0_POINTS,
  STAR1_POINTS,
  DESTR0,
  DESTR1,
  STAR_DEBRIS,
  BLIMP_POINTS,
  DBLIMP,
  BLIMP_PICTURE,
  type Point2,
  OP_SEGMENT,
  SCAPE0,
  SCAPE1,
  SCAPE2,
  SCAPE3,
  SCAPES,
  SCAPE_SEG_BYTES,
  PFOCOL,
  HORZ,
  HORIZN,
  PFPLOW,
} from '../../src/core/topology'

describe('topology — connect-list opcode semantics (BLANKV/VSBLEV)', () => {
  it('encodes as pointIndex * 6 + flag, matching the ROM macros', () => {
    // BLANKV 12 → 12*6+0 = 72; VSBLEV 29 → 29*6+1 = 175 (DB.MAP:330-331).
    expect(encodeOp({ point: 12, draw: false })).toBe(72)
    expect(encodeOp({ point: 29, draw: true })).toBe(175)
    expect(POINT_STRIDE).toBe(6)
    expect(OP_BLANK).toBe(0)
    expect(OP_VISIBLE).toBe(1)
    expect(ENDDB).toBe(0xff)
  })

  it('round-trips every op through encode → decode', () => {
    for (const list of [DB_MAP, DB_MAR, DB_LNS, PCDEC1, DBLIMP]) {
      for (const op of list) {
        const rt = decodeOp(encodeOp(op))
        expect(rt).toEqual(op)
      }
    }
  })

  it('the stride exceeds the largest flag, so the encoding is reversible', () => {
    // point = byte / 6, flag = byte % 6; a flag of 4 (SEGSTR) still never
    // collides with the next point's byte because 4 < 6.
    expect(decodeOp(72)).toEqual({ point: 12, draw: false })
    expect(decodeOp(175)).toEqual({ point: 29, draw: true })
  })
})

describe('topology — biplane connect-lists (DB.MAP / DB.MAR / DB.LNS)', () => {
  it('has the exact source-counted opcode length of each list', () => {
    expect(DB_MAP.length).toBe(24) // 037007.XXX:330-353
    expect(DB_MAR.length).toBe(43) // 037007.XXX:357-399
    expect(DB_LNS.length).toBe(17) // 037007.XXX:403-419
  })

  it('transcribes the first ops of each list verbatim', () => {
    expect(DB_MAP[0]).toEqual({ point: 12, draw: false }) // BLANKV 12 ;BACK WINGS UPPER
    expect(DB_MAP[1]).toEqual({ point: 29, draw: true }) //  VSBLEV 29
    expect(DB_MAR[0]).toEqual({ point: 0, draw: false }) //  BLANKV 0  ;TO END
    expect(DB_LNS[0]).toEqual({ point: 21, draw: false }) // BLANKV 21
    expect(DB_LNS[DB_LNS.length - 1]).toEqual({ point: 41, draw: false }) // BLANKV 41 ;POSITION FOR PROP
  })

  it('indexes only the 42-vertex plane model in the PROGRAM ROM (indices 0-41)', () => {
    // The plane vertices live in RBARON.MAC, not this picture ROM; the highest
    // index the lists reference is 41 (the prop mount in DB.LNS).
    const maxIndex = Math.max(...[...DB_MAP, ...DB_MAR, ...DB_LNS].map((o) => o.point))
    expect(maxIndex).toBe(41)
  })
})

describe('topology — propeller (DBPROP + PPROPA/B/C)', () => {
  it('has 14 shaft/blade vertices and three 7-op blade frames', () => {
    expect(DBPROP_POINTS.length).toBe(14)
    expect(PPROPA.length).toBe(7)
    expect(PPROPB.length).toBe(7)
    expect(PPROPC.length).toBe(7)
    expect(PROPS).toEqual([PPROPA, PPROPB, PPROPC])
  })

  it('transcribes the shaft points and a blade frame verbatim', () => {
    expect(DBPROP_POINTS[0]).toEqual([0, 0, -36]) // shaft front
    expect(DBPROP_POINTS[1]).toEqual([0, 0, -44]) // shaft back
    expect(PPROPA).toEqual([
      { point: 1, draw: true },
      { point: 2, draw: true },
      { point: 3, draw: true },
      { point: 1, draw: true },
      { point: 4, draw: true },
      { point: 5, draw: true },
      { point: 1, draw: true },
    ])
  })
})

describe('topology — explosion debris (PIECE0-3 + PCDEC0-2)', () => {
  it('has the source-counted vertices per piece', () => {
    expect(PIECE0_POINTS.length).toBe(14)
    expect(PIECE1_POINTS.length).toBe(23)
    expect(PIECE2_POINTS.length).toBe(9)
    expect(PIECE3_POINTS.length).toBe(9)
  })

  it('has the source-counted decode-list lengths', () => {
    expect(PCDEC0.length).toBe(27) // 037007.XXX:672-698
    expect(PCDEC1.length).toBe(40) // 037007.XXX:701-740
    expect(PCDEC2.length).toBe(13) // 037007.XXX:743-755
  })

  it('maps the four pieces to their decode-lists per the PLPCDE table (piece 3 reuses PCDEC2)', () => {
    expect(PLPCDE).toEqual([PCDEC0, PCDEC1, PCDEC2, PCDEC2])
    expect(EXPLOSION_PIECES).toHaveLength(4)
    expect(EXPLOSION_PIECES[3].connect).toBe(PCDEC2)
    expect(EXPLOSION_PIECES[0].points).toBe(PIECE0_POINTS)
  })

  it('ends each piece point-set on its [0,0,0] centroid', () => {
    for (const pts of [PIECE0_POINTS, PIECE1_POINTS, PIECE2_POINTS, PIECE3_POINTS]) {
      expect(pts[pts.length - 1]).toEqual([0, 0, 0])
    }
  })
})

describe('topology — star-burst debris (STAR0/1 + DESTR0/1)', () => {
  it('has a 10-vertex 5-point star and a 12-vertex 6-point star', () => {
    expect(STAR0_POINTS.length).toBe(10)
    expect(STAR1_POINTS.length).toBe(12)
    expect(DESTR0.length).toBe(11) // 037007.XXX:984-994
    expect(DESTR1.length).toBe(13) // 037007.XXX:997-1009
    expect(STAR_DEBRIS).toHaveLength(2)
  })
})

describe('topology — blimp / Zeppelin (BLIMP + DBLIMP)', () => {
  it('has 36 vertices and a 78-op connect-list', () => {
    expect(BLIMP_POINTS.length).toBe(36)
    expect(DBLIMP.length).toBe(78) // 037007.XXX:1052-1129
    expect(BLIMP_PICTURE.points).toBe(BLIMP_POINTS)
    expect(BLIMP_PICTURE.connect).toBe(DBLIMP)
  })

  it('transcribes the nose vertex and the trailing gun-barrel points verbatim', () => {
    expect(BLIMP_POINTS[0]).toEqual([0, 0, -40]) // nose
    expect(BLIMP_POINTS[34]).toEqual([0, -18, -8]) // gun barrel
    expect(BLIMP_POINTS[35]).toEqual([0, -18, -14])
  })
})

describe('topology — structural fidelity', () => {
  // For every SELF-CONTAINED picture (points + decode-list both from 037007.XXX),
  // every connect-op must index a real vertex. This catches a mis-transcribed
  // index that a length check would miss.
  const selfContained: ReadonlyArray<[string, readonly Point3[], readonly ConnectOp[]]> = [
    ['prop A', DBPROP_POINTS, PPROPA],
    ['prop B', DBPROP_POINTS, PPROPB],
    ['prop C', DBPROP_POINTS, PPROPC],
    ['piece 0', PIECE0_POINTS, PCDEC0],
    ['piece 1', PIECE1_POINTS, PCDEC1],
    ['piece 2', PIECE2_POINTS, PCDEC2],
    ['piece 3', PIECE3_POINTS, PCDEC2],
    ['star 0', STAR0_POINTS, DESTR0],
    ['star 1', STAR1_POINTS, DESTR1],
    ['blimp', BLIMP_POINTS, DBLIMP],
  ]

  it.each(selfContained)('every connect-op in %s indexes a real vertex', (_name, points, connect) => {
    for (const op of connect) {
      expect(op.point).toBeGreaterThanOrEqual(0)
      expect(op.point).toBeLessThan(points.length)
    }
  })

  it('COLLD is the four-point plane collision rectangle', () => {
    expect(COLLD_POINTS.length).toBe(4)
    expect(COLLD_POINTS[0]).toEqual([12, 20, -40])
  })

  it('totals 287 connect opcodes across the biplane + prop/explosion/blimp/star lists', () => {
    // Source-verified sum: 24+43+17 (plane) + 7*3 (prop) + 27+40+13 (explosion)
    // + 11+13 (star) + 78 (blimp) = 287. (The epic-context "346" figure sweeps in
    // the out-of-scope ground-wave mountain decode lists; see the delivery finding.)
    const lists = [DB_MAP, DB_MAR, DB_LNS, PPROPA, PPROPB, PPROPC, PCDEC0, PCDEC1, PCDEC2, DESTR0, DESTR1, DBLIMP]
    const total = lists.reduce((n, l) => n + l.length, 0)
    expect(total).toBe(287)
  })
})

// ─── rb3-1: ground / landscape data (RBGRND.MAC) ─────────────────────────────

describe('topology — mountain silhouettes (SCAPE0..3)', () => {
  it('has the exact source-counted point count per silhouette', () => {
    expect(SCAPE0.length).toBe(21) // RBGRND.MAC:725-745
    expect(SCAPE1.length).toBe(16) // RBGRND.MAC:747-762
    expect(SCAPE2.length).toBe(18) // RBGRND.MAC:764-781
    expect(SCAPE3.length).toBe(15) // RBGRND.MAC:783-797
  })

  // FULL literal pins — the ROM PFPNTS values (logical x,y; the packed x/2,y*2 and
  // the discarded third arg are the macro's job, not ours). An in-range coordinate
  // swap that a length/bounds check would miss fails these.
  it('transcribes SCAPE0 verbatim (Z discarded)', () => {
    expect(SCAPE0).toEqual([
      [-128, 0], [-104, 24], [-88, 24], [-64, 0], [-48, 16],
      [-16, 24], [0, 8], [24, 16], [48, 0], [64, 0],
      [80, 0], [96, 24], [120, 0], [112, 8], [120, 20],
      [128, 0], [-32, 8], [-48, 0], [8, 0], [100, 8],
      [112, 0],
    ])
  })

  it('transcribes SCAPE1 verbatim', () => {
    expect(SCAPE1).toEqual([
      [-128, 0], [-112, 0], [-64, 12], [0, 0], [16, 16],
      [48, 16], [64, 0], [96, 32], [112, 8], [104, 16],
      [112, 24], [128, 0], [-48, 4], [-64, 0], [92, 16],
      [104, 0],
    ])
  })

  it('transcribes SCAPE2 verbatim (index 5 is the PFPNT0 global)', () => {
    expect(SCAPE2).toEqual([
      [-128, 0], [-88, 8], [-64, 0], [-32, 24], [-16, 0],
      [0, 0], [16, 0], [32, 16], [48, 16], [64, 24],
      [88, 0], [72, 16], [96, 32], [128, 0], [-96, 0],
      [-40, 0], [40, 0], [56, 8],
    ])
    expect(SCAPE2[5]).toEqual([0, 0]) // PFPNT0
  })

  it('transcribes SCAPE3 verbatim', () => {
    expect(SCAPE3).toEqual([
      [-128, 0], [-112, 16], [-96, 16], [-64, 32], [-32, 24],
      [0, 0], [16, 24], [64, 0], [96, 0], [104, 16],
      [128, 0], [-96, 0], [-56, 16], [8, 0], [24, 8],
    ])
  })

  it('every silhouette spans the full playfield width from ∓128', () => {
    // Point 0 is the far-left edge (−128); the main outline reaches the far-right
    // edge (+128) at some point before the trailing detail vertices.
    for (const scape of SCAPES) {
      expect(scape[0][0]).toBe(-128)
      expect(scape.some(([x]) => x === 128)).toBe(true)
    }
  })

  it('SSEGS pointer table lists the four silhouettes in order', () => {
    expect(SCAPES).toEqual([SCAPE0, SCAPE1, SCAPE2, SCAPE3])
  })

  it('.SSEG byte-lengths are the last-point offset (pointCount − 1) × 2', () => {
    expect(SCAPE_SEG_BYTES).toEqual([40, 30, 34, 28]) // RBGRND.MAC:801-802
    SCAPES.forEach((scape, i) => {
      expect(SCAPE_SEG_BYTES[i]).toBe((scape.length - 1) * 2)
    })
  })

  it('decodes through the exported OP_SEGMENT (SEGSTR = pointIndex*6+4) opcode', () => {
    // The picture-ROM PFOPOS/SMAP connect-tables (rb3-3) start each segment with a
    // SEGSTR byte = point*6+4; the opcode those lists use is exported here.
    expect(OP_SEGMENT).toBe(4)
    // A hypothetical SEGSTR byte for SCAPE point 3: 3*6+4 = 22.
    expect(3 * 6 + OP_SEGMENT).toBe(22)
  })
})

describe('topology — ground-object collision boxes (PFOCOL)', () => {
  it('has 24 PFCOL corners = 12 (min, max) boxes', () => {
    expect(PFOCOL.length).toBe(24) // RBGRND.MAC:824-847
  })

  it('transcribes every PFCOL corner verbatim (logical x,y; ×8 packing is the macro)', () => {
    expect(PFOCOL).toEqual([
      [-104, 20], [-88, 32],
      [48, 0], [64, 12],
      [64, 0], [80, 12],
      [-128, 0], [-112, 12],
      [16, 12], [32, 24],
      [32, 12], [48, 24],
      [-16, 0], [0, 12],
      [0, 0], [16, 12],
      [32, 12], [48, 24],
      [-112, 12], [-96, 24],
      [64, 0], [80, 12],
      [80, 0], [96, 12],
    ])
  })

  it('reads as consecutive (min-corner, max-corner) pairs — every box is min ≤ max', () => {
    // GRDISP (R2BRON.MAC:3880-3902) treats entry 2n as the min corner and 2n+1 as
    // the max corner of box n; a mistranscribed corner that inverts a box fails here.
    for (let i = 0; i < PFOCOL.length; i += 2) {
      const min: Point2 = PFOCOL[i]
      const max: Point2 = PFOCOL[i + 1]
      expect(min[0]).toBeLessThanOrEqual(max[0]) // Xmin ≤ Xmax
      expect(min[1]).toBeLessThanOrEqual(max[1]) // Ymin ≤ Ymax
    }
  })
})

describe('topology — horizon / altitude constants (RBARON.MAC, .RADIX 16)', () => {
  it('transcribes HORZ / HORIZN / PFPLOW as their hex-radix values', () => {
    // The equate block is `.RADIX 16` (hex) — confirmed by the sibling `.STAR0=1B`
    // and by `P.MAXZ = 1001` = HORZ+1. Decimal misreads (e.g. HORZ=1000) are wrong.
    expect(HORZ).toBe(0x1000) // 4096 — horizon depth
    expect(HORIZN).toBe(0x40) // 64 — horizon Y offset ("$40")
    expect(PFPLOW).toBe(0x80 * 4) // 512 — plane min altitude
  })
})

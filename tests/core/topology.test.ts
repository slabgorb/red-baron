// tests/core/topology.test.ts
//
// Story rb2-2 — verifies the picture-ROM vector topology transcribed from
// `reference/red-baron/037007.XXX` (= `RBPICS.MAC`) into `src/core/topology.ts`.
//
// This is a TRANSCRIPTION story: the value is fidelity to the source bytes, so
// the suite guards (a) the BLANKV/VSBLEV opcode arithmetic, (b) the exact,
// source-counted length of every connect-list and point-set, (c) a spot-check of
// representative transcribed values against the .MAC listing, and (d) the
// structural invariant that every connect-op indexes a real vertex in its
// point-set. It reads only red-baron's own committed source — never the
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

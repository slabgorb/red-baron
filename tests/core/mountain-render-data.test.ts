// tests/core/mountain-render-data.test.ts
//
// Story rb3-3 — RED phase (Furiosa / TEA). The DATA half of the scrolling
// landscape: the picture-ROM SEGSTR connect-tables that rb3-1 EXPLICITLY DEFERRED
// to rb3-3 ("the picture-ROM PFOPOS segment table + SMAP*/SMP* connect-lists
// (037007.XXX) stay in the picture ROM for rb3-3 render" — topology.ts:304-309).
//
// rb3-1 landed the SCAPE0..3 silhouette POINT-sets (the `PFPNTS` vertices) but NOT
// the lists that STITCH those points into drawable mountain segments. Those live in
// the aerial picture ROM `reference/red-baron/037007.XXX` (= RBPICS.MAC):
//   • PFOPOS (037007.XXX:83-91) — the `SEGSTR` table: for each of the 4 SCAPE
//     silhouettes, the START point-index of each of its 4 scroll segments. Eight
//     rows: the first four are the L-TO-R scroll order, the last four the R-TO-L.
//     The `SEGSTR .A,.B,.C,.D` macro emits `.A*6+4 …` — point*POINT_STRIDE+OP_SEGMENT.
//   • SMAP00..SMAP33 (037007.XXX:93-172) — the 16 forward (L-TO-R) connect-lists,
//     `SMAP{scape}{segment}`. Each continues the polyline from its SEGSTR start,
//     using VV (pen down / draw) and BV (pen up / move) exactly like DB.MAP et al.
//
// CONTRACT for the GREEN phase (The Word Burgers / DEV): add to `src/core/topology.ts`:
//
//   /** ROM `PFOPOS` SEGSTR table (037007.XXX:83-91): per silhouette, the START
//     * point-index of each of its 4 scroll segments. Rows 0-3 = L→R, 4-7 = R→L. */
//   export const PFOPOS: readonly (readonly number[])[]
//
//   /** ROM SMAP** forward (L→R) connect-lists (037007.XXX:93-172), indexed
//     * [scapeIndex 0-3][segmentIndex 0-3]; each a ConnectOp[] (no ENDDB stored). */
//   export const MOUNTAIN_SEGMAPS: readonly (readonly (readonly ConnectOp[])[])[]
//
// This is a TRANSCRIPTION contract: the value is fidelity to the source bytes, so
// this suite FULL-value-pins every row/list against the .MAC listing, guards the
// SEGSTR opcode arithmetic (byte = point*6+4), and enforces the structural
// invariant that every start-point and every connect-op indexes a real SCAPE
// vertex. It reads only red-baron's OWN committed source (topology.ts) — never the
// gitignored `reference/` quarry — so it passes in a fresh clone.
//
// SCOPE (deviation logged): only the FORWARD (L→R) SMAP** stitch-lists are required
// here; the reverse-scroll SMP** set (037007.XXX:175+) is deferred as a non-blocking
// follow-up — one scroll direction is a complete playable mountain-pass slice, and
// the reverse lists are mechanical data. PFOPOS is transcribed in full (both
// directions) because it is one contiguous 8-row ROM table.

import { describe, it, expect } from 'vitest'
import {
  type ConnectOp,
  POINT_STRIDE,
  OP_SEGMENT,
  PFOPOS,
  MOUNTAIN_SEGMAPS,
  SCAPES,
  HORZ,
  HORIZN,
} from '../../src/core/topology'

// Compact expected-value builders mirroring the ROM VV / BV macros.
const V = (point: number): ConnectOp => ({ point, draw: true }) //  VSBLEV / VV — pen down, draw
const B = (point: number): ConnectOp => ({ point, draw: false }) // BLANKV / BV — pen up, move

describe('rb3-3 PFOPOS — SEGSTR segment-start table (037007.XXX:83-91)', () => {
  it('pins the 8 rows exactly: 4 L→R then 4 R→L, four start-points each', () => {
    expect(PFOPOS).toEqual([
      [0, 3, 6, 9], //  SCAPE0 L→R (037007.XXX:83)
      [0, 2, 3, 6], //  SCAPE1 L→R (:84)
      [0, 2, 5, 9], //  SCAPE2 L→R (:85)
      [0, 3, 5, 7], //  SCAPE3 L→R (:86)
      [3, 6, 9, 15], // SCAPE0 R→L (:88)
      [2, 3, 6, 11], // SCAPE1 R→L (:89)
      [2, 5, 9, 13], // SCAPE2 R→L (:90)
      [3, 5, 7, 10], // SCAPE3 R→L (:91)
    ])
  })

  it('is 8 rows of exactly 4 segment-starts (4 SCAPEs × 2 scroll directions)', () => {
    expect(PFOPOS).toHaveLength(8)
    for (const row of PFOPOS) expect(row).toHaveLength(4)
  })

  it('encodes back to the ROM SEGSTR bytes (byte = point*POINT_STRIDE + OP_SEGMENT)', () => {
    // SEGSTR .A,.B,.C,.D → .BYTE .A*6+4,.B*6+4,.C*6+4,.D*6+4 (037007.XXX:18-20).
    // SCAPE0 L→R [0,3,6,9] → [4, 22, 40, 58].
    const bytes = PFOPOS[0].map((p) => p * POINT_STRIDE + OP_SEGMENT)
    expect(bytes).toEqual([4, 22, 40, 58])
  })

  it('every SEGSTR start-point indexes a real vertex in its SCAPE silhouette', () => {
    // Rows 0-3 map to SCAPE 0-3 (L→R); rows 4-7 map to SCAPE 0-3 (R→L).
    PFOPOS.forEach((row, r) => {
      const scape = SCAPES[r % 4]
      for (const start of row) {
        expect(start).toBeGreaterThanOrEqual(0)
        expect(start).toBeLessThan(scape.length)
      }
    })
  })
})

describe('rb3-3 MOUNTAIN_SEGMAPS — forward (L→R) SMAP** connect-lists (037007.XXX:93-172)', () => {
  it('pins SCAPE0 segment lists SMAP00..SMAP03 exactly', () => {
    expect(MOUNTAIN_SEGMAPS[0]).toEqual([
      [V(1), V(2), V(3)], //                         SMAP00 (:93)
      [V(4), V(5), V(6)], //                         SMAP01 (:98)
      [V(7), V(8), V(9)], //                         SMAP02 (:103)
      [V(10), V(11), V(12), B(13), V(14), V(15)], // SMAP03 (:108) — note the BV 13 move
    ])
  })

  it('pins SCAPE1 segment lists SMAP10..SMAP13 exactly', () => {
    expect(MOUNTAIN_SEGMAPS[1]).toEqual([
      [V(1), V(2)], //                     SMAP10 (:116)
      [V(3)], //                           SMAP11 (:120)
      [V(4), V(5), V(6)], //               SMAP12 (:123)
      [V(7), V(8), B(9), V(10), V(11)], // SMAP13 (:128) — note the BV 9 move
    ])
  })

  it('pins SCAPE2 segment lists SMAP20..SMAP23 exactly', () => {
    expect(MOUNTAIN_SEGMAPS[2]).toEqual([
      [V(1), V(2)], //                 SMAP20 (:135)
      [V(3), V(4), V(5)], //           SMAP21 (:139)
      [V(6), V(7), V(8), V(9)], //     SMAP22 (:144)
      [V(10), B(11), V(12), V(13)], // SMAP23 (:150) — note the BV 11 move
    ])
  })

  it('pins SCAPE3 segment lists SMAP30..SMAP33 exactly', () => {
    expect(MOUNTAIN_SEGMAPS[3]).toEqual([
      [V(1), V(2), V(3)], //   SMAP30 (:156)
      [V(4), V(5)], //         SMAP31 (:161)
      [V(6), V(7)], //         SMAP32 (:165)
      [V(8), V(9), V(10)], //  SMAP33 (:169)
    ])
  })

  it('is 4 silhouettes × 4 segments of connect-lists', () => {
    expect(MOUNTAIN_SEGMAPS).toHaveLength(4)
    for (const scapeMaps of MOUNTAIN_SEGMAPS) expect(scapeMaps).toHaveLength(4)
  })

  it('every connect-op indexes a real vertex in its SCAPE silhouette', () => {
    MOUNTAIN_SEGMAPS.forEach((scapeMaps, s) => {
      const scape = SCAPES[s]
      for (const list of scapeMaps) {
        for (const op of list) {
          expect(op.point).toBeGreaterThanOrEqual(0)
          expect(op.point).toBeLessThan(scape.length)
        }
      }
    })
  })

  it('carries the exactly-three BV (pen-up move) discontinuities from the source', () => {
    // The ROM lists have precisely three interior moves: SMAP03 BV13, SMAP13 BV9,
    // SMAP23 BV11. Everything else is a VV draw. A dropped/added move is a defect.
    const moves = MOUNTAIN_SEGMAPS.flat(2).filter((op) => !op.draw)
    expect(moves).toEqual([{ point: 13, draw: false }, { point: 9, draw: false }, { point: 11, draw: false }])
  })
})

describe('rb3-3 horizon constants — HORZ (depth) vs HORIZN (screen offset)', () => {
  // The story text loosely says mountains "fall past the horizon line (HORIZN=$40)".
  // The ROM equates (RBARON.MAC:450-455, .RADIX 16) say otherwise, and this guards it:
  it('HORZ is the horizon DEPTH ($1000 = 4096), the Z mountains sit at on the horizon', () => {
    expect(HORZ).toBe(0x1000)
    expect(HORZ).toBe(4096)
  })

  it('HORIZN is a Y-AXIS SCREEN offset ($40 = 64) — NOT a depth threshold', () => {
    expect(HORIZN).toBe(0x40)
    expect(HORIZN).toBe(64)
    // The two are different constants with different roles: the mountain "fall"
    // is keyed to the DEPTH (HORZ), never to the screen offset (HORIZN).
    expect(HORZ).not.toBe(HORIZN)
  })
})

// tests/core/ground-target-data.test.ts
//
// Story rb4-11 — RED phase (Imperator Furiosa / TEA). THE GROUND TARGETS, data half.
//
// Cluster C10 (subsumes OB-017, MI-008, OB-016, OB-018): 037007.XXX:1132-1246 defines a
// complete, self-contained ground-object set that topology.ts does not contain AT ALL.
// This suite is the transcription contract for that set, in the mountain-render-data.test.ts
// (rb3-3) house style: FULL-value pins against red-baron's OWN committed source
// (src/core/topology.ts) — it never reads the gitignored `reference/` quarry, so it passes
// in a fresh clone. The line-by-line derivation against the citable quarry lives in
// tests/core/ground-target-source.test.ts (green from day one, like plane-scale-source).
//
// ── RADIX ──────────────────────────────────────────────────────────────────────────────
// The whole window sits under 037007.XXX:80 `.RADIX 10` (the file's ONLY radix change
// after :43): every literal below is DECIMAL, exactly as the existing (correct) topology.ts
// picture transcriptions read it. Do NOT apply rb4-1's hex correction here — that sweep was
// for RBARON.MAC's `.RADIX 16` constants, and applying it to this region corrupts the data.
// Where a two-digit value could bite (PFOFFS, BLCOLL), the hex misreading is REFUTED inline.
//
// ── CONTRACT for the GREEN phase (The Word Burgers / Dev) — add to src/core/topology.ts ──
//
//   /** Ground-target point-sets (`PFPNTS` pairs, 037007.XXX:1186-1225). */
//   export const PFPYRM: readonly Point2[]   // :1186-1189  PYRAMID   (4 points)
//   export const PFHOME: readonly Point2[]   // :1191-1197  HOUSE     (7 points)
//   export const PFTANK: readonly Point2[]   // :1199-1208  TANK     (10 points)
//   export const PFPBOX: readonly Point2[]   // :1210-1225  PILL BOX (16 points)
//
//   /** Ground-target decode-lists (BV/VV streams, 037007.XXX:1134-1184). */
//   export const DEPFPY: readonly ConnectOp[] // :1144-1150  (6 ops)
//   export const DEPFHS: readonly ConnectOp[] // :1134-1142  (8 ops)
//   export const DEPFTK: readonly ConnectOp[] // :1152-1163 (11 ops)
//   export const DEPFPB: readonly ConnectOp[] // :1165-1184 (19 ops)
//
//   /** ROM `PFODEC` pointer table (037007.XXX:1132) — decode-list per object type. */
//   export const PFODEC: readonly (readonly ConnectOp[])[]  // [DEPFPY, DEPFHS, DEPFTK, DEPFPB]
//   /** ROM `PFLOB` pointer table (037007.XXX:1227) — point-set per object type. */
//   export const PFLOB: readonly (readonly Point2[])[]      // [PFPYRM, PFHOME, PFTANK, PFPBOX]
//   /** ROM `.PFLOB` length table (037007.XXX:1229-1230) — byte offset of each set's LAST
//     * point, `(pointCount − 1) × 2` (each PFPNTS is 2 bytes) — the SCAPE_SEG_BYTES shape. */
//   export const PFLOB_SEG_BYTES: readonly number[]         // [6, 12, 18, 30]
//   /** ROM `PFOFFS` (037007.XXX:1232-1246) — 12 `PFCOL` screen offsets, 4 groups of 3. */
//   export const PFOFFS: readonly Point2[]
//
//   /** ROM `PFOBJN` (RBARON.MAC:3924-3927) — object number per (group, slot), 4 rows of 3.
//     * Values are PRE-DOUBLED word offsets into PFLOB/PFODEC: 0=pyramid 2=house 4=tank
//     * 6=pill box. (The story's table list omits it; without it AC-2's "ground targets
//     * appear" has no type assignment — scope extension logged as a deviation.) */
//   export const PFOBJN: readonly (readonly number[])[]
//
//   /** ROM `BLCOLL` (RBARON.MAC:6270-6277) — the blimp's 8-corner collision box, POINTP
//     * format, under the program ROM's `.RADIX 10` window (:6217..:6281). The only PLNDB
//     * master-table member (:6285-6287) missing from topology.ts. */
//   export const BLCOLL_POINTS: readonly Point3[]
//
// Object-type index convention (shared by PFODEC/PFLOB/PFLOB_SEG_BYTES and PFOBJN>>1):
//   0 = pyramid, 1 = house, 2 = tank, 3 = pill box.

import { describe, it, expect, beforeAll } from 'vitest'
import type { ConnectOp, Point2, Point3 } from '../../src/core/topology'

// Mirror of the exports this story ADDS to topology.ts. All optional so the suite is RED
// (need() throws per-test with the missing name), not a tsc failure, until Dev lands them.
interface GroundTargetTopology {
  PFPYRM?: readonly Point2[]
  PFHOME?: readonly Point2[]
  PFTANK?: readonly Point2[]
  PFPBOX?: readonly Point2[]
  DEPFPY?: readonly ConnectOp[]
  DEPFHS?: readonly ConnectOp[]
  DEPFTK?: readonly ConnectOp[]
  DEPFPB?: readonly ConnectOp[]
  PFODEC?: readonly (readonly ConnectOp[])[]
  PFLOB?: readonly (readonly Point2[])[]
  PFLOB_SEG_BYTES?: readonly number[]
  PFOFFS?: readonly Point2[]
  PFOBJN?: readonly (readonly number[])[]
  BLCOLL_POINTS?: readonly Point3[]
  BLIMP_POINTS?: readonly Point3[]
  encodeOp?: (op: ConnectOp) => number
  decodeOp?: (byte: number) => ConnectOp
}

let topo: GroundTargetTopology = {}
beforeAll(async () => {
  // `as unknown as`: RED mid-migration mirror (the mission-clock.test.ts house pattern) —
  // topology.ts does not yet export the ground-target set, so the mirror is the TARGET
  // shape, not the source's current shape. need() verifies each export at runtime.
  topo = (await import('../../src/core/topology')) as unknown as GroundTargetTopology
})

function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`topology.ts does not export ${name} yet (rb4-11 RED)`)
  return value
}

// Compact expected-value builders mirroring the ROM VV / BV macros (house style).
const V = (point: number): ConnectOp => ({ point, draw: true }) //  VV — pen down, draw
const B = (point: number): ConnectOp => ({ point, draw: false }) // BV — pen up, move

// ─── AC-1 — the four point-sets, byte-for-byte, DECIMAL ───────────────────────────────

describe('rb4-11 AC-1 — ground-target point-sets (037007.XXX:1186-1225, .RADIX 10)', () => {
  it('PFPYRM — the pyramid, 4 PFPNTS points exactly as written (:1186-1189)', () => {
    expect(need(topo.PFPYRM, 'PFPYRM')).toEqual([
      [-8, -4], // :1186  PFPNTS -8,-4,32   ;PYRAMID
      [0, -4], //  :1187  PFPNTS 0,-4,24
      [8, -4], //  :1188  PFPNTS 8,-4,32
      [0, 4], //   :1189  PFPNTS 0,4,32     ;4  (the apex)
    ])
  })

  it('PFHOME — the house, 7 points (:1191-1197)', () => {
    expect(need(topo.PFHOME, 'PFHOME')).toEqual([
      [-4, -4], // :1191  PFPNTS -4,-4,32   ;HOUSE
      [-4, 0], //  :1192
      [-8, 0], //  :1193  (left roof overhang)
      [0, 8], //   :1194  (roof peak)
      [8, 0], //   :1195  ;4  (right roof overhang)
      [4, 0], //   :1196
      [4, -4], //  :1197
    ])
  })

  it('PFTANK — the tank, 10 points (:1199-1208), INCLUDING the duplicate centre pair', () => {
    expect(need(topo.PFTANK, 'PFTANK')).toEqual([
      [-2, -4], // :1199  PFPNTS -2,-4,32   ;TANK
      [-4, -1], // :1200
      [4, -1], //  :1201
      [2, -4], //  :1202
      [-2, -1], // :1203  ;4
      [-2, 1], //  :1204
      [2, 1], //   :1205
      [2, -1], //  :1206
      [0, 0], //   :1207  ;8  PFPNTS 0,0,32
      [0, 0], //   :1208      PFPNTS 0,0,28
    ])
  })

  it('the tank centre pair is AUTHENTIC — PFPNTS discards its 3rd argument, so points 8 and 9 both land at [0,0]', () => {
    // The macro is `.MACRO PFPNTS .X,.Y,.Z / .BYTE .X/2,.Y*2 / .ENDM` (037007.XXX:10-12):
    // only X and Y are emitted. Points 8 (0,0,32) and 9 (0,0,28) differ ONLY in the
    // discarded Z, so the assembled ROM holds two identical (0,0) points — and DEPFTK ends
    // `BV 8 / VV 9`: a zero-length LIT vector, the tank's centre DOT. Do not "de-duplicate".
    const tank = need(topo.PFTANK, 'PFTANK')
    expect(tank[8]).toEqual([0, 0])
    expect(tank[9]).toEqual([0, 0])
  })

  it('PFPBOX — the pill box, 16 points (:1210-1225)', () => {
    expect(need(topo.PFPBOX, 'PFPBOX')).toEqual([
      [-4, -4], // :1210  PFPNTS -4,-4,32   ;PILL BOX
      [-4, 0], //  :1211  PFPNTS -4,0,34
      [4, 0], //   :1212  PFPNTS 4,0,34
      [4, -4], //  :1213
      [-4, -1], // :1214
      [-6, -1], // :1215  (left gun slit)
      [-6, -2], // :1216
      [-4, -2], // :1217
      [4, -1], //  :1218  ;8  (right gun slit)
      [6, -1], //  :1219
      [6, -2], //  :1220
      [4, -2], //  :1221
      [0, -1], //  :1222  ;12 (centre slit)
      [2, -1], //  :1223
      [2, -2], //  :1224
      [0, -2], //  :1225
    ])
  })
})

// ─── AC-1 — the four decode-lists ─────────────────────────────────────────────────────

describe('rb4-11 AC-1 — ground-target decode-lists (037007.XXX:1134-1184)', () => {
  it('DEPFPY — the pyramid decode (:1144-1150)', () => {
    expect(need(topo.DEPFPY, 'DEPFPY')).toEqual([B(0), V(3), V(2), V(0), B(1), V(3)])
  })

  it('DEPFHS — the house decode (:1134-1142)', () => {
    expect(need(topo.DEPFHS, 'DEPFHS')).toEqual([
      B(0), V(1), B(5), V(6), B(2), V(3), V(4), V(2),
    ])
  })

  it('DEPFTK — the tank decode (:1152-1163), ending in the centre-dot stroke BV 8 / VV 9', () => {
    expect(need(topo.DEPFTK, 'DEPFTK')).toEqual([
      B(0), V(1), V(2), V(3), V(0), B(4), V(5), V(6), V(7), B(8), V(9),
    ])
  })

  it('DEPFPB — the pill-box decode (:1165-1184)', () => {
    expect(need(topo.DEPFPB, 'DEPFPB')).toEqual([
      B(0), V(1), V(2), V(3), V(0),
      B(4), V(5), V(6), V(7),
      B(8), V(9), V(10), V(11), V(8),
      B(15), V(14), V(13), V(12), V(15),
    ])
  })

  it('every decode op indexes a real point of its paired point-set (no out-of-range vertex)', () => {
    const pairs: ReadonlyArray<readonly [string, readonly ConnectOp[], readonly Point2[]]> = [
      ['DEPFPY/PFPYRM', need(topo.DEPFPY, 'DEPFPY'), need(topo.PFPYRM, 'PFPYRM')],
      ['DEPFHS/PFHOME', need(topo.DEPFHS, 'DEPFHS'), need(topo.PFHOME, 'PFHOME')],
      ['DEPFTK/PFTANK', need(topo.DEPFTK, 'DEPFTK'), need(topo.PFTANK, 'PFTANK')],
      ['DEPFPB/PFPBOX', need(topo.DEPFPB, 'DEPFPB'), need(topo.PFPBOX, 'PFPBOX')],
    ]
    for (const [name, ops, points] of pairs) {
      for (const op of ops) {
        expect(op.point, `${name}: op indexes point ${op.point} of ${points.length}`).toBeLessThan(
          points.length,
        )
        expect(op.point, `${name}: negative point index`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('the decode bytes round-trip through the house encode/decode (byte = point*6 + pen)', () => {
    // The BV/VV opcode arithmetic is the SAME stream every other 037007 picture uses —
    // encodeOp/decodeOp (topology.ts) must reproduce each op from its ROM byte.
    const encodeOp = need(topo.encodeOp, 'encodeOp')
    const decodeOp = need(topo.decodeOp, 'decodeOp')
    for (const list of [
      need(topo.DEPFPY, 'DEPFPY'), need(topo.DEPFHS, 'DEPFHS'),
      need(topo.DEPFTK, 'DEPFTK'), need(topo.DEPFPB, 'DEPFPB'),
    ]) {
      for (const op of list) expect(decodeOp(encodeOp(op))).toEqual(op)
    }
  })
})

// ─── AC-2 — the four tables ───────────────────────────────────────────────────────────

describe('rb4-11 AC-2 — PFODEC / PFLOB / .PFLOB / PFOFFS (037007.XXX:1132, :1227-1246)', () => {
  it('PFODEC is the ROM pointer order — [DEPFPY, DEPFHS, DEPFTK, DEPFPB], by IDENTITY (:1132)', () => {
    const pfodec = need(topo.PFODEC, 'PFODEC')
    expect(pfodec).toHaveLength(4)
    // .WORD DEPFPY,DEPFHS,DEPFTK,DEPFPB — pointerS, so the exports themselves, not copies.
    expect(pfodec[0]).toBe(need(topo.DEPFPY, 'DEPFPY'))
    expect(pfodec[1]).toBe(need(topo.DEPFHS, 'DEPFHS'))
    expect(pfodec[2]).toBe(need(topo.DEPFTK, 'DEPFTK'))
    expect(pfodec[3]).toBe(need(topo.DEPFPB, 'DEPFPB'))
  })

  it('PFLOB is the ROM pointer order — [PFPYRM, PFHOME, PFTANK, PFPBOX], by IDENTITY (:1227)', () => {
    const pflob = need(topo.PFLOB, 'PFLOB')
    expect(pflob).toHaveLength(4)
    expect(pflob[0]).toBe(need(topo.PFPYRM, 'PFPYRM'))
    expect(pflob[1]).toBe(need(topo.PFHOME, 'PFHOME'))
    expect(pflob[2]).toBe(need(topo.PFTANK, 'PFTANK'))
    expect(pflob[3]).toBe(need(topo.PFPBOX, 'PFPBOX'))
  })

  it('PFLOB_SEG_BYTES pins the .PFLOB length table — [6, 12, 18, 30] (:1229-1230)', () => {
    // .BYTE PFHOME-PFPYRM-2, PFTANK-PFHOME-2, PFPBOX-PFTANK-2, PFLOB-PFPBOX-2 — each set's
    // last-point byte offset. Same shape as `.SSEG` → SCAPE_SEG_BYTES (topology.ts).
    expect(need(topo.PFLOB_SEG_BYTES, 'PFLOB_SEG_BYTES')).toEqual([6, 12, 18, 30])
  })

  it('PFLOB_SEG_BYTES obeys the assembler law — (pointCount − 1) × 2 per set', () => {
    const seg = need(topo.PFLOB_SEG_BYTES, 'PFLOB_SEG_BYTES')
    const pflob = need(topo.PFLOB, 'PFLOB')
    pflob.forEach((set, i) => expect(seg[i]).toBe((set.length - 1) * 2))
  })

  it('the byte layout reproduces RBARON.MAC:430-433 — PFLOB = PFODEC + $82', () => {
    // The program ROM mirrors this window by address arithmetic: PFODEC=DBLIMP+4F,
    // PFLOB=PFODEC+82, .PFLOB=PFLOB+8, PFOFFS=.PFLOB+4. The $82 gap is the 4-word PFODEC
    // (8 bytes) + the four decode-lists (each ops+ENDDB bytes) + the four point-sets
    // (each points×2 bytes). If any transcription drops or invents an entry, this sum breaks.
    const decodeBytes = [
      need(topo.DEPFPY, 'DEPFPY'), need(topo.DEPFHS, 'DEPFHS'),
      need(topo.DEPFTK, 'DEPFTK'), need(topo.DEPFPB, 'DEPFPB'),
    ].reduce((sum, list) => sum + list.length + 1, 0) // +1 = the ENDDB terminator byte
    const pointBytes = need(topo.PFLOB, 'PFLOB').reduce((sum, set) => sum + set.length * 2, 0)
    expect(8 + decodeBytes + pointBytes).toBe(0x82)
    // and .PFLOB (4 length bytes) sits 8 bytes (the 4-word PFLOB) past PFLOB, PFOFFS 4 past that:
    expect(need(topo.PFLOB, 'PFLOB').length * 2).toBe(8)
    expect(need(topo.PFLOB_SEG_BYTES, 'PFLOB_SEG_BYTES').length).toBe(4)
  })

  it('PFOFFS — the 12 PFCOL screen offsets, byte-for-byte DECIMAL (:1232-1246)', () => {
    expect(need(topo.PFOFFS, 'PFOFFS')).toEqual([
      [96, -28], //  :1232  — group 0
      [-56, -4], //  :1233
      [-72, -4], //  :1234
      [120, -4], //  :1236  — group 1
      [-24, -20], // :1237
      [-40, -20], // :1238
      [8, -4], //    :1240  — group 2
      [-8, -4], //   :1241
      [-40, -20], // :1242
      [104, -20], // :1244  — group 3
      [-72, -4], //  :1245
      [-88, -4], //  :1246
    ])
  })

  it('REFUTES the hex misreading of PFOFFS — this window is .RADIX 10 (037007.XXX:80)', () => {
    // rb4-1's sweep corrected RBARON.MAC constants that were transcribed as decimal from a
    // hex region. This region is the OPPOSITE case: genuinely decimal. Applying the "hex
    // correction" here reads 96 as 0x96=150 and -28 as -0x28=-40 — refute it permanently.
    const pfoffs = need(topo.PFOFFS, 'PFOFFS')
    expect(pfoffs[0]).toEqual([96, -28])
    expect(pfoffs[0]).not.toEqual([0x96, -0x28])
    expect(pfoffs[3]).toEqual([120, -4])
    expect(pfoffs[3]).not.toEqual([0x120, -4])
  })
})

// ─── PFOBJN — the (group, slot) → object-number table (scope extension, see deviation) ─

describe('rb4-11 — PFOBJN object-number table (RBARON.MAC:3924-3927)', () => {
  it('pins the 4 rows of 3 exactly — pre-doubled type indices', () => {
    expect(need(topo.PFOBJN, 'PFOBJN')).toEqual([
      [0, 2, 6], // :3924 — pyramid, house,   pill box
      [0, 0, 6], // :3925 — pyramid, pyramid, pill box
      [4, 2, 6], // :3926 — tank,    house,   pill box
      [4, 4, 6], // :3927 — tank,    tank,    pill box
    ])
  })

  it('every entry is an EVEN word offset whose half indexes PFLOB/PFODEC (types 0-3)', () => {
    // The display code reads `LDX AY,PFLOB / LDA AY,PFLOB+1` with the RAW byte as the word
    // index, then halves it for `.PFLOB` (RBARON.MAC:3637-3643) — so the stored values are
    // pre-doubled and must stay that way.
    const pfobjn = need(topo.PFOBJN, 'PFOBJN')
    const pflob = need(topo.PFLOB, 'PFLOB')
    for (const row of pfobjn) {
      expect(row).toHaveLength(3)
      for (const n of row) {
        expect(n % 2).toBe(0)
        expect(n / 2).toBeGreaterThanOrEqual(0)
        expect(n / 2).toBeLessThan(pflob.length)
      }
    }
  })

  it('every group deploys a PILL BOX in its last slot — the ROM invariant', () => {
    // All four PFOBJN rows end in 6 (= type 3, PFPBOX): every mountain target-group carries
    // exactly one pill box. A "plausible" re-typed table loses this instantly.
    for (const row of need(topo.PFOBJN, 'PFOBJN')) expect(row[2]).toBe(6)
  })

  it('has exactly the 4 groups the RANDOM AND I,3 selector can reach (RBARON.MAC:3450-3451)', () => {
    expect(need(topo.PFOBJN, 'PFOBJN')).toHaveLength(4)
    // and PFOFFS supplies exactly 3 offsets per group — 12 = 4 × 3.
    expect(need(topo.PFOFFS, 'PFOFFS')).toHaveLength(12)
  })
})

// ─── AC-4 — BLCOLL, the blimp's collision box ─────────────────────────────────────────

describe('rb4-11 AC-4 — BLCOLL blimp collision box (RBARON.MAC:6270-6277, .RADIX 10)', () => {
  it('pins the 8 POINTP corners exactly as written', () => {
    expect(need(topo.BLCOLL_POINTS, 'BLCOLL_POINTS')).toEqual([
      [16, 16, -40], //  :6270  POINTP 16,16,-40  ;POINT CD'S
      [16, -16, -40], // :6271
      [-16, 16, -40], // :6272
      [-16, -16, -40], // :6273
      [16, 16, 40], //   :6274
      [16, -16, 40], //  :6275
      [-16, 16, 40], //  :6276
      [-16, -16, 40], // :6277
    ])
  })

  it('is a full axis-aligned box — |x|=|y|=16, |z|=40, all 8 sign octants, no duplicates', () => {
    const box = need(topo.BLCOLL_POINTS, 'BLCOLL_POINTS')
    expect(box).toHaveLength(8)
    const octants = new Set<string>()
    for (const [x, y, z] of box) {
      expect(Math.abs(x)).toBe(16)
      expect(Math.abs(y)).toBe(16)
      expect(Math.abs(z)).toBe(40)
      octants.add(`${Math.sign(x)},${Math.sign(y)},${Math.sign(z)}`)
    }
    expect(octants.size).toBe(8)
  })

  it('REFUTES the hex misreading — BLCOLL sits INSIDE the .RADIX 10 window (:6217..:6281)', () => {
    // Hex would read 16 as 0x16=22 and 40 as 0x40=64. The program ROM flips to .RADIX 10 at
    // :6217 and back to .RADIX 16 at :6281 — BLCOLL (:6270-6277) is decimal, like the plane
    // vertex table around it (the epic's "topology.ts is byte-exact" region).
    for (const [x, y, z] of need(topo.BLCOLL_POINTS, 'BLCOLL_POINTS')) {
      expect(Math.abs(x)).not.toBe(0x16)
      expect(Math.abs(y)).not.toBe(0x16)
      expect(Math.abs(z)).not.toBe(0x40)
      void z
    }
  })

  it('EQUALS the blimp ENVELOPE’s bounding extents — the box bounds the hull, not the gondola', () => {
    // BLIMP_POINTS (topology.ts, rb2-2) spans ±16 in x and ±40 in z — matched exactly. In y
    // the ENVELOPE rings span ±16 (the real points [0, ±16, 0]); the GONDOLA hangs to −20
    // ([±8, −20, ±8]) and the ROM's box deliberately excludes it — BLCOLL is the envelope's
    // body, so a shot under the hull authentically misses. If either transcription drifts,
    // this cross-check breaks on the side that moved.
    // (rb4-11 GREEN correction: the RED premise "±16 in y" ignored the gondola — TEA never
    // saw this test run, it RED'd on the missing export. Logged as a Delivery Finding.)
    const blimp = need(topo.BLIMP_POINTS, 'BLIMP_POINTS')
    const box = need(topo.BLCOLL_POINTS, 'BLCOLL_POINTS')
    const extent = (pts: readonly Point3[], axis: 0 | 1 | 2): number =>
      Math.max(...pts.map((p) => Math.abs(p[axis])))
    expect(extent(box, 0)).toBe(extent(blimp, 0)) // 16
    expect(extent(box, 2)).toBe(extent(blimp, 2)) // 40
    // y: the box TOPS the envelope exactly (+16 is a drawn envelope point)…
    expect(Math.max(...box.map((p) => p[1]))).toBe(Math.max(...blimp.map((p) => p[1]))) // 16
    // …and the gondola dips BELOW the box floor — authentically outside BLCOLL:
    expect(Math.min(...blimp.map((p) => p[1]))).toBeLessThan(Math.min(...box.map((p) => p[1]))) // −20 < −16
  })
})

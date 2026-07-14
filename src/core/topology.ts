// src/core/topology.ts
//
// The authentic Red Baron vector topology, transcribed byte-for-byte from the ROM
// quarry: the aerial pictures from `reference/red-baron/037007.XXX` — which IS
// `RBPICS.MAC` (its own header reads `.TITLE RBPICS - RED BARON PICTURES`), the
// picture ROM misnamed by part number — and the ground-wave landscape DATA from
// `RBGRND.MAC` (rb3-1). This closes the fidelity doc's "gap #1" (findings §7/§9):
// the plane connect-list topology is NOT unrecoverable — the source shipped in
// the quarry.
//
// WHAT'S HERE (findings §7 "connect-lists / picture-ROM inventory"):
//   • the biplane connect-lists `DB.MAP` / `DB.MAR` / `DB.LNS` (topology only —
//     they index the 42-vertex plane model that lives in the PROGRAM ROM
//     `RBARON.MAC`, not this file);
//   • the self-contained pictures whose vertices AND decode-lists both live in
//     037007.XXX: the propeller, the four explosion-debris pieces, the two
//     star-burst debris shapes, and the blimp/Zeppelin;
//   • the plane collision-detect points `COLLD`;
//   • the ground-wave landscape data (rb3-1): the `SCAPE0..3` mountain
//     silhouettes, the `PFOCOL` collision boxes, and the horizon/altitude
//     constants — see the GROUND / LANDSCAPE section at the foot of the file.
//
// CONNECT-LIST OPCODE SEMANTICS (the `BLANKV`/`VSBLEV` macros, 037007.XXX:20-40):
// a connect-list is a stream of bytes, each `pointIndex * 6 + flag`, terminated
// by `ENDDB` = $FF. The `* 6` is the stride of a transformed-point record in the
// decode scratch buffer `DB.TRP` (Z,X,Y each 2 bytes). The low bits are the pen:
//   BLANKV/BV .P → .P*6+0  — pen UP, move dark to vertex P
//   VSBLEV/VV .P → .P*6+1  — pen DOWN, draw a visible line to vertex P
//   SEGSTR    .P → .P*6+4  — mountain-segment start. The `SCAPE0..3` point-sets it
//                            stitches now live below (rb3-1); the SEGSTR connect-
//                            tables themselves (`PFOPOS`/`SMAP*`, 037007.XXX) stay
//                            in the picture ROM for rb3-3 render, so no data in
//                            this module carries a flag-4 byte yet.
// Because the stride (6) exceeds the largest flag (4) the encoding is reversible:
// `point = byte / 6`, `flag = byte % 6`.
//
// PURE data + pure helpers. No DOM, no time, no randomness.

/**
 * One model-space vertex, as the ROM `POINTP .X,.Y,.Z` macro expresses it:
 * logical `[x, y, z]`, each a signed integer. (The macro packs the bytes as
 * `Z, 2·X, 4·Y` for sub-unit precision; we keep the logical coordinate its
 * arguments name — the axis convention is findings §8: +x right, +y up,
 * +z behind / −z forward.)
 */
export type Point3 = readonly [x: number, y: number, z: number]

/** One connect-list step: move or draw to `point` in the referenced point-set. */
export interface ConnectOp {
  /** Vertex index into the point-set this list decodes against. */
  readonly point: number
  /** `true` = VSBLEV/VV (pen down, draw a line); `false` = BLANKV/BV (pen up, move dark). */
  readonly draw: boolean
}

/** A self-contained vector picture: a point-set plus the connect-list that draws it. */
export interface VectorPicture {
  readonly points: readonly Point3[]
  readonly connect: readonly ConnectOp[]
}

/** Transformed-point record stride — a connect byte is `point * POINT_STRIDE + flag`. */
export const POINT_STRIDE = 6
/** Opcode flag: BLANKV/BV — pen up, dark move to the vertex. */
export const OP_BLANK = 0
/** Opcode flag: VSBLEV/VV — pen down, draw a visible line to the vertex. */
export const OP_VISIBLE = 1
/** Opcode flag: SEGSTR — mountain-segment start. Stitches the {@link SCAPES} silhouettes; its `PFOPOS`/`SMAP*` connect-tables are rb3-3's (picture ROM), so no list here carries a flag-4 byte yet. */
export const OP_SEGMENT = 4
/** End-of-connect-list sentinel (`ENDDB` → `.BYTE $FF`). */
export const ENDDB = 0xff

/** Encode a {@link ConnectOp} to its ROM connect-list byte. */
export function encodeOp(op: ConnectOp): number {
  return op.point * POINT_STRIDE + (op.draw ? OP_VISIBLE : OP_BLANK)
}

/** Decode a ROM connect-list byte (any value other than {@link ENDDB}) to a {@link ConnectOp}. */
export function decodeOp(byte: number): ConnectOp {
  return { point: Math.floor(byte / POINT_STRIDE), draw: byte % POINT_STRIDE === OP_VISIBLE }
}

// Compact builders mirroring the two source macros, so the lists below read like
// the assembly they were transcribed from.
const B = (point: number): ConnectOp => ({ point, draw: false }) // BLANKV / BV
const V = (point: number): ConnectOp => ({ point, draw: true }) //  VSBLEV / VV

// ─────────────────────────────────────────────────────────────────────────────
// BIPLANE — connect-lists only (037007.XXX:330-420). These index the 42-vertex
// plane model in the PROGRAM ROM (`RBARON.MAC` "PLANE POINTS DB"), which is a
// separate transcription, not part of this picture ROM.
//
// LOD + FALL-THROUGH (findings §7): DB_MAP has NO `ENDDB` in source — it falls
// straight through into DB_MAR. So pointing the decoder at DB.MAP draws the back
// faces AND then the front faces; pointing it at DB.MAR draws the front faces
// alone. The near/full plane draws DB_MAP (→ DB_MAR by fall-through) plus the
// DB_LNS struts; the far drone draws DB_MAR only. Callers compose:
//   near  = [...DB_MAP, ...DB_MAR, ...DB_LNS]
//   far   = DB_MAR
// ─────────────────────────────────────────────────────────────────────────────

/** Plane BACK faces — wings, fuselage struts, wheels. No terminator: falls through to {@link DB_MAR}. */
export const DB_MAP: readonly ConnectOp[] = [
  B(12), V(29), V(30), V(13), // back wings, upper
  B(15), V(32), V(31), V(14), //   "     "    lower
  B(33), V(18), B(34), V(20), B(35), V(22), // back fuselage struts
  B(25), V(37), V(38), V(26), // back left wheel
  B(27), V(39), V(40), V(28), // back right wheel
  B(24), V(36),
]

/** Plane FRONT faces — tail, fuselage, wing fronts, body struts, wheel fronts (`ENDDB`). */
export const DB_MAR: readonly ConnectOp[] = [
  B(0), V(3), V(16), V(1), V(2), V(16), // tail wings
  B(0), V(4), V(5), V(0), V(6), V(5), // fuselage
  B(6), V(7), V(0), V(8), V(7),
  B(8), V(9), V(0), V(10), V(9),
  B(10), V(11), V(4), B(11), V(0),
  B(12), V(13), // top wing front
  B(14), V(15), // bottom wing front
  B(17), V(18), B(19), V(20), B(21), V(22), V(24), V(23), // body struts
  B(25), V(26), B(27), V(28), // wheel front edge
]

/** Plane wing struts / inter-plane bracing lines (`ENDDB`). */
export const DB_LNS: readonly ConnectOp[] = [
  B(21), V(30), B(13), V(35), B(36), V(12), B(29), V(23),
  B(31), V(17), B(14), V(33), B(32), V(19), B(34), V(15),
  B(41), // position for prop
]

/** Plane collision-detect points — front-face rectangle (037007.XXX:602 `COLLD`). */
export const COLLD_POINTS: readonly Point3[] = [
  [12, 20, -40], [12, -16, -40], [-12, 20, -40], [-12, -16, -40],
]

// ─────────────────────────────────────────────────────────────────────────────
// PROPELLER (037007.XXX:426-470). One 14-point set (`DBPROP`); three blade
// connect-lists (`PPROPA/B/C`) selected per rotation frame by the `PROPS` table.
// ─────────────────────────────────────────────────────────────────────────────

/** Propeller vertices — shaft, then the three blade pairs (`DBPROP`). */
export const DBPROP_POINTS: readonly Point3[] = [
  [0, 0, -36], [0, 0, -44], //           prop shaft
  [0, 16, -44], [5, 15, -42], // vertical blade
  [0, -16, -44], [-5, -15, -42],
  [-14, 8, -44], [-11, 12, -42], // 60° blade
  [14, -8, -44], [11, -12, -42],
  [-14, -8, -44], [-16, -3, -42], // 120° blade
  [14, 8, -44], [16, 3, -42],
]

/** Prop blade connect-list, rotation frame A (`PPROPA`, `ENDDB`). */
export const PPROPA: readonly ConnectOp[] = [V(1), V(2), V(3), V(1), V(4), V(5), V(1)]
/** Prop blade connect-list, rotation frame B (`PPROPB`, `ENDDB`). */
export const PPROPB: readonly ConnectOp[] = [V(1), V(6), V(7), V(1), V(8), V(9), V(1)]
/** Prop blade connect-list, rotation frame C (`PPROPC`, `ENDDB`). */
export const PPROPC: readonly ConnectOp[] = [V(1), V(10), V(11), V(1), V(12), V(13), V(1)]

/** ROM `PROPS` table — the three prop-blade frames, indexed by prop rotation. */
export const PROPS: readonly (readonly ConnectOp[])[] = [PPROPA, PPROPB, PPROPC]

// ─────────────────────────────────────────────────────────────────────────────
// EXPLOSION DEBRIS (037007.XXX:613-773). Four `PIECE` point-sets; three `PCDEC`
// decode-lists (`PLPCDE` maps PIECE0→PCDEC0, 1→PCDEC1, 2→PCDEC2, 3→PCDEC2). The
// trailing [0,0,0] vertex of each piece is its centroid, not a drawn point.
// ─────────────────────────────────────────────────────────────────────────────

/** Explosion piece 0 vertices (`PIECE0`; last point is the centroid). */
export const PIECE0_POINTS: readonly Point3[] = [
  [-16, 26, 0], [0, 26, 0], [16, 26, 0], [0, 26, 16], [0, 4, 0],
  [-6, -30, 3], [-3, -26, 5], [3, -28, 5], [5, -26, 3], [5, -26, -3],
  [3, -28, -5], [-3, -26, -5], [-6, -30, -3], [0, 0, 0],
]
/** Explosion piece 1 vertices (`PIECE1`; last point is the centroid). */
export const PIECE1_POINTS: readonly Point3[] = [
  [-6, 8, 3], [-3, 12, 5], [3, 10, 5], [5, 12, 3], [5, 12, -3],
  [3, 10, -5], [-3, 12, -5], [6, 8, -3], [-8, -12, 4], [-4, -12, 8],
  [4, -12, 8], [8, -12, 4], [8, -12, -4], [4, -12, -8], [-4, -12, -8],
  [-8, -12, -4], [0, -12, 0], [0, -20, 0], [-16, -20, 0], [-15, -19, 4],
  [16, -20, 0], [15, -19, -4], [0, 0, 0],
]
/** Explosion piece 2 vertices (`PIECE2`; last point is the centroid). */
export const PIECE2_POINTS: readonly Point3[] = [
  [-20, 14, 14], [16, 14, 14], [24, -18, 14], [-20, -18, 14], [-20, 18, -14],
  [28, 18, -14], [12, -14, -14], [-20, -14, -14], [0, 0, 0],
]
/** Explosion piece 3 vertices (`PIECE3`; last point is the centroid). */
export const PIECE3_POINTS: readonly Point3[] = [
  [20, 14, 14], [-24, 14, 14], [-16, -18, 14], [20, -18, 14], [20, 18, -14],
  [-12, 18, -14], [-28, -14, -14], [20, -14, -14], [0, 0, 0],
]

/** Explosion decode-list 0 (`PCDEC0`, `ENDDB`). */
export const PCDEC0: readonly ConnectOp[] = [
  B(4), V(0), V(2), V(4), V(3), V(1), V(5), V(6), V(1), V(7), V(8), V(1),
  V(9), V(10), V(1), V(11), V(12), V(1),
  B(6), V(7), B(8), V(9), B(10), V(11), B(12), V(5), B(13),
]
/** Explosion decode-list 1 (`PCDEC1`, `ENDDB`). */
export const PCDEC1: readonly ConnectOp[] = [
  B(0), V(1), V(9), V(10), V(2), V(3), V(11), V(12), V(4), V(5), V(13), V(14),
  V(6), V(7), V(15), V(8), V(0),
  B(1), V(2), B(3), V(4), B(5), V(6), B(7), V(0),
  B(8), V(9), B(10), V(11), B(12), V(13), B(14), V(15),
  B(16), V(17), V(18), V(19), V(20), V(21), V(17),
]
/** Explosion decode-list 2 (`PCDEC2`; shared by pieces 2 and 3 via {@link PLPCDE}, `ENDDB`). */
export const PCDEC2: readonly ConnectOp[] = [
  B(0), V(1), V(2), V(3), V(0), V(7), V(6), V(5), V(4), V(7), B(4), V(3), B(8),
]

/** ROM `PLPCDE` table — the decode-list for each of the four explosion pieces. */
export const PLPCDE: readonly (readonly ConnectOp[])[] = [PCDEC0, PCDEC1, PCDEC2, PCDEC2]

/** The four explosion-debris pieces, each pairing its vertices with its decode-list. */
export const EXPLOSION_PIECES: readonly VectorPicture[] = [
  { points: PIECE0_POINTS, connect: PCDEC0 },
  { points: PIECE1_POINTS, connect: PCDEC1 },
  { points: PIECE2_POINTS, connect: PCDEC2 },
  { points: PIECE3_POINTS, connect: PCDEC2 },
]

// ─────────────────────────────────────────────────────────────────────────────
// STAR-BURST DEBRIS (037007.XXX:956-1010). A 5-point and a 6-point star, each
// with its own `DESTR` connect-list.
// ─────────────────────────────────────────────────────────────────────────────

/** 5-point star-burst vertices (`STAR0`). */
export const STAR0_POINTS: readonly Point3[] = [
  [2, 3, 0], [0, 8, 0], [-2, 3, 0], [-8, 5, 0], [-5, 0, 0],
  [-10, -5, 0], [-1, -3, 0], [1, -7, 0], [3, -1, 0], [10, -2, 0],
]
/** 6-point star-burst vertices (`STAR1`). */
export const STAR1_POINTS: readonly Point3[] = [
  [2, 3, 0], [-2, 11, 0], [-6, 3, 0], [-10, 3, 0], [-4, -2, 0], [-2, -11, 0],
  [-1, -4, 0], [6, -7, 0], [4, -3, 0], [11, 1, 0], [5, 1, 0], [7, 9, 0],
]

/** 5-point star connect-list (`DESTR0`, `ENDDB`). */
export const DESTR0: readonly ConnectOp[] = [
  B(0), V(1), V(2), V(3), V(4), V(5), V(6), V(7), V(8), V(9), V(0),
]
/** 6-point star connect-list (`DESTR1`, `ENDDB`). */
export const DESTR1: readonly ConnectOp[] = [
  B(0), V(1), V(2), V(3), V(4), V(5), V(6), V(7), V(8), V(9), V(10), V(11), V(0),
]

/** The two star-burst debris shapes, each pairing its vertices with its connect-list. */
export const STAR_DEBRIS: readonly VectorPicture[] = [
  { points: STAR0_POINTS, connect: DESTR0 },
  { points: STAR1_POINTS, connect: DESTR1 },
]

// ─────────────────────────────────────────────────────────────────────────────
// BLIMP / ZEPPELIN (037007.XXX:1013-1130). 36 vertices; one long `DBLIMP`
// connect-list (the gondola gun barrel is the last two points).
// ─────────────────────────────────────────────────────────────────────────────

/** Blimp/Zeppelin vertices — envelope rings, then the gondola + gun barrel (`BLIMP`). */
export const BLIMP_POINTS: readonly Point3[] = [
  [0, 0, -40], [0, 8, -32], [0, 16, 0], [0, 8, 32], [0, 0, 40], [0, -8, 32],
  [0, -16, 0], [0, -8, -32], [6, 6, -32], [11, 11, 0], [6, 6, 32], [6, -6, 32],
  [11, -11, 0], [6, -6, -32], [8, 0, -32], [16, 0, 0], [8, 0, 32], [-6, 6, -32],
  [-11, 11, 0], [-6, 6, 32], [-6, -6, -32], [-11, -11, 0], [-6, -6, 32],
  [-8, 0, -32], [-16, 0, 0], [-8, 0, 32], [8, -16, -8], [8, -20, -8],
  [8, -20, 8], [8, -16, 8], [-8, -16, -8], [-8, -20, -8], [-8, -20, 8],
  [-8, -16, 8], [0, -18, -8], [0, -18, -14], // last two: gun barrel
]

/** Blimp connect-list (`DBLIMP`, `ENDDB`). */
export const DBLIMP: readonly ConnectOp[] = [
  B(0), V(1), V(2), V(3), V(4), V(5), V(6), V(7), V(0),
  V(8), V(9), V(10), V(4), V(22), V(21), V(20), V(0),
  V(13), V(12), V(11), V(4), V(19), V(18), V(17), V(0),
  V(14), V(15), V(16), V(4), V(25), V(24), V(23), V(0),
  B(1), V(8), V(14), V(13), V(7), V(20), V(23), V(17), V(1),
  B(2), V(9), V(15), V(12), V(6), V(21), V(24), V(18), V(2),
  B(3), V(10), V(16), V(11), V(5), V(22), V(25), V(19), V(3),
  B(26), V(27), V(31), V(32), V(28), V(29), V(33), V(30), V(26), V(29),
  B(28), V(27), B(30), V(31), B(32), V(33), B(34), V(35),
]

/** The blimp as a single self-contained picture. */
export const BLIMP_PICTURE: VectorPicture = { points: BLIMP_POINTS, connect: DBLIMP }

// ─────────────────────────────────────────────────────────────────────────────
// GROUND / LANDSCAPE (rb3-1) — the ground-wave data rb2-2 scoped OUT, now landed.
//
// Transcribed from the canonical `RBGRND.MAC` (".TITLE RBGRND - RED BARON GROUND
// SEQUENCE" — the shipped RBARON/RBGRND release set, byte-identical to
// `RBGRND.MAC` across the whole SCAPE/PFOCOL block). The silhouettes and
// collision boxes sit in its "DISPLAY DB'S" section under `.RADIX 10`
// (RBGRND.MAC:723-848), so every coordinate below is DECIMAL, exactly as written.
//
// MOUNTAIN SILHOUETTES `SCAPE0..3` (RBGRND.MAC:725-797). Each is a `PFPNTS` list —
// the 2-D playfield-point macro (037007.XXX:11):
//     .MACRO PFPNTS .X,.Y,.Z  /  .BYTE .X/2,.Y*2  /  .ENDM
// It emits ONLY two bytes (`X/2`, `Y*2`); the THIRD argument is DISCARDED. We keep
// the logical `[x, y]` the arguments name (as `Point3` keeps POINTP's coords) and
// note the drop — a byte auditor halves x, doubles y, and ignores the source's
// third column.
//
// These silhouettes are stroked by the ground decoder through the SEGSTR
// (`OP_SEGMENT` = pointIndex*6+4) opcode exported above: the picture-ROM `PFOPOS`
// segment table + `SMAP*`/`SMP*` connect-lists (037007.XXX:83+) name which SCAPE
// points start and join each scroll segment. Those SEGSTR connect-tables are the
// RENDER concern (rb3-3) and live in a DIFFERENT ROM, so they are NOT transcribed
// here — rb3-1 lands the point DATA + collision boxes + horizon constants only.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One 2-D playfield point, logical `[x, y]`. The ROM `PFPNTS` macro packs it as
 * `.BYTE x/2, y*2` and discards a third argument; we keep the logical coordinate
 * its arguments name. (Distinct from {@link Point3}: playfield points are planar.)
 */
export type Point2 = readonly [x: number, y: number]

/** Mountain silhouette 0 — 21 points (`SCAPE0`, RBGRND.MAC:725-745). */
export const SCAPE0: readonly Point2[] = [
  [-128, 0], [-104, 24], [-88, 24], [-64, 0], [-48, 16], // 0-4
  [-16, 24], [0, 8], [24, 16], [48, 0], [64, 0], // 5-9
  [80, 0], [96, 24], [120, 0], [112, 8], [120, 20], // 10-14
  [128, 0], [-32, 8], [-48, 0], [8, 0], [100, 8], // 15-19
  [112, 0], // 20
]

/** Mountain silhouette 1 — 16 points (`SCAPE1`, RBGRND.MAC:747-762). */
export const SCAPE1: readonly Point2[] = [
  [-128, 0], [-112, 0], [-64, 12], [0, 0], [16, 16], // 0-4
  [48, 16], [64, 0], [96, 32], [112, 8], [104, 16], // 5-9
  [112, 24], [128, 0], [-48, 4], [-64, 0], [92, 16], // 10-14
  [104, 0], // 15
]

/** Mountain silhouette 2 — 18 points (`SCAPE2`, RBGRND.MAC:764-781; point 5 is the `PFPNT0` global). */
export const SCAPE2: readonly Point2[] = [
  [-128, 0], [-88, 8], [-64, 0], [-32, 24], [-16, 0], // 0-4
  [0, 0], [16, 0], [32, 16], [48, 16], [64, 24], // 5-9  (index 5 = PFPNT0)
  [88, 0], [72, 16], [96, 32], [128, 0], [-96, 0], // 10-14
  [-40, 0], [40, 0], [56, 8], // 15-17
]

/** Mountain silhouette 3 — 15 points (`SCAPE3`, RBGRND.MAC:783-797). */
export const SCAPE3: readonly Point2[] = [
  [-128, 0], [-112, 16], [-96, 16], [-64, 32], [-32, 24], // 0-4
  [0, 0], [16, 24], [64, 0], [96, 0], [104, 16], // 5-9
  [128, 0], [-96, 0], [-56, 16], [8, 0], [24, 8], // 10-14
]

/** ROM `SSEGS` pointer table — the four mountain silhouettes, index 0-3 (RBGRND.MAC:799). */
export const SCAPES: readonly (readonly Point2[])[] = [SCAPE0, SCAPE1, SCAPE2, SCAPE3]

/**
 * ROM `.SSEG` table (RBGRND.MAC:801-802) — per silhouette, the byte offset of its
 * LAST point: `SCAPE(n+1) − SCAPE(n) − 2` = `(pointCount − 1) × 2` (each `PFPNTS`
 * is 2 bytes). The ground draw loop uses it to bound the segment scan.
 */
export const SCAPE_SEG_BYTES: readonly number[] = [40, 30, 34, 28]

// GROUND-OBJECT COLLISION BOXES `PFOCOL` (RBGRND.MAC:824-847). 24 `PFCOL` entries —
// the collision-box macro (037007.XXX:14):
//     .MACRO PFCOL .X,.Y  /  .WORD .X*8,.Y*8  /  .ENDM
// each emitting the (X, Y) corner as two ×8-scaled words. We keep the logical
// `[x, y]`. `GRDISP` (RBARON.MAC:3885-3907) reads the entries in CONSECUTIVE PAIRS
// as (min-corner, max-corner): the 24 entries are 12 axis-aligned boxes, each
// `[Xmin,Ymin]` then `[Xmax,Ymax]` (every pair satisfies min ≤ max). Object type
// indexes this table; type ≥ 4 = active gun emplacement (rb3-4 consumes it).

/** `PFOCOL` — 24 `PFCOL` collision corners = 12 (min, max) box pairs (RBGRND.MAC:824-847). */
export const PFOCOL: readonly Point2[] = [
  [-104, 20], [-88, 32], // box 0
  [48, 0], [64, 12], // box 1
  [64, 0], [80, 12], // box 2
  [-128, 0], [-112, 12], // box 3
  [16, 12], [32, 24], // box 4
  [32, 12], [48, 24], // box 5
  [-16, 0], [0, 12], // box 6
  [0, 0], [16, 12], // box 7
  [32, 12], [48, 24], // box 8
  [-112, 12], [-96, 24], // box 9
  [64, 0], [80, 12], // box 10
  [80, 0], [96, 12], // box 11
]

// HORIZON / ALTITUDE CONSTANTS (RBARON.MAC:447-455, under `.RADIX 16` — HEX). The
// ground sequence consumes these program-ROM equates; transcribed here with the
// SCAPE data they govern. HEX is confirmed by the sibling equate `.STAR0 = 1B`
// (a `B` hex digit) and by `P.MAXZ = 1001` = HORZ+1 ("PF object max Z on horizon").

/** `HORZ` = $1000 — horizon depth (the Z at which mountains sit on the horizon line). */
export const HORZ = 0x1000 // 4096
/** `HORIZN` = $40 — horizon screen Y-offset added after the perspective divide. */
export const HORIZN = 0x40 // 64
/** `PFPLOW` = $80·4 — plane minimum altitude above the horizon (I4YPOS floor, ground mode). */
export const PFPLOW = 0x80 * 4 // 512

// ─────────────────────────────────────────────────────────────────────────────
// MOUNTAIN RENDER CONNECT-TABLES (rb3-3) — the SEGSTR stitch data rb3-1 DEFERRED.
//
// rb3-1 landed the SCAPE0..3 silhouette POINT-sets but left the lists that stitch
// those points into drawable mountain segments in the picture ROM. Transcribed here
// from `reference/red-baron/037007.XXX` (= RBPICS.MAC), the aerial picture ROM:
//   • PFOPOS (037007.XXX:83-91) — the `SEGSTR` table. Per silhouette, the START
//     point-index of each of its 4 scroll segments. Eight rows: 0-3 = L→R scroll
//     order, 4-7 = R→L. The `SEGSTR .A,.B,.C,.D` macro emits `.A*6+4 …` — i.e.
//     `point*POINT_STRIDE + OP_SEGMENT`.
//   • SMAP00..SMAP33 (037007.XXX:93-172) — the 16 forward (L→R) connect-lists,
//     `SMAP{scape}{segment}`. Each continues the polyline from its SEGSTR start,
//     using VV (pen down / draw) and BV (pen up / move), exactly like DB.MAP.
//
// SCOPE (rb3-3, TEA deviation): the reverse-scroll SMP** lists (037007.XXX:175+)
// are deferred as a non-blocking follow-up — one scroll direction is a complete
// playable mountain-pass slice. PFOPOS is transcribed in full (one 8-row ROM table).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ROM `PFOPOS` SEGSTR table (037007.XXX:83-91): per silhouette, the START
 * point-index of each of its 4 scroll segments. Rows 0-3 = L→R, rows 4-7 = R→L.
 * A row's segment g pairs with {@link MOUNTAIN_SEGMAPS}[row % 4][g].
 */
export const PFOPOS: readonly (readonly number[])[] = [
  [0, 3, 6, 9], //  SCAPE0 L→R (037007.XXX:83)
  [0, 2, 3, 6], //  SCAPE1 L→R (:84)
  [0, 2, 5, 9], //  SCAPE2 L→R (:85)
  [0, 3, 5, 7], //  SCAPE3 L→R (:86)
  [3, 6, 9, 15], // SCAPE0 R→L (:88)
  [2, 3, 6, 11], // SCAPE1 R→L (:89)
  [2, 5, 9, 13], // SCAPE2 R→L (:90)
  [3, 5, 7, 10], // SCAPE3 R→L (:91)
]

/**
 * ROM SMAP** forward (L→R) connect-lists (037007.XXX:93-172), indexed
 * `[scapeIndex 0-3][segmentIndex 0-3]`. Each list continues its segment's polyline
 * from {@link PFOPOS}[scape][segment]; VV → draw ({@link OP_VISIBLE}), BV → move
 * ({@link OP_BLANK}). The `ENDDB` terminators are structural, not stored.
 */
export const MOUNTAIN_SEGMAPS: readonly (readonly (readonly ConnectOp[])[])[] = [
  [
    // SCAPE0 — SMAP00..SMAP03
    [V(1), V(2), V(3)],
    [V(4), V(5), V(6)],
    [V(7), V(8), V(9)],
    [V(10), V(11), V(12), B(13), V(14), V(15)],
  ],
  [
    // SCAPE1 — SMAP10..SMAP13
    [V(1), V(2)],
    [V(3)],
    [V(4), V(5), V(6)],
    [V(7), V(8), B(9), V(10), V(11)],
  ],
  [
    // SCAPE2 — SMAP20..SMAP23
    [V(1), V(2)],
    [V(3), V(4), V(5)],
    [V(6), V(7), V(8), V(9)],
    [V(10), B(11), V(12), V(13)],
  ],
  [
    // SCAPE3 — SMAP30..SMAP33
    [V(1), V(2), V(3)],
    [V(4), V(5)],
    [V(6), V(7)],
    [V(8), V(9), V(10)],
  ],
]

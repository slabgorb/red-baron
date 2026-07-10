// src/core/topology.ts
//
// The authentic Red Baron picture-ROM vector topology, transcribed byte-for-byte
// from `reference/red-baron/037007.XXX` — which IS `RBPICS.MAC` (its own header
// reads `.TITLE RBPICS - RED BARON PICTURES`), the picture ROM misnamed by part
// number. This closes the fidelity doc's "gap #1" (findings §7/§9): the plane
// connect-list topology is NOT unrecoverable — the source shipped in the quarry.
//
// WHAT'S HERE (findings §7 "connect-lists / picture-ROM inventory"):
//   • the biplane connect-lists `DB.MAP` / `DB.MAR` / `DB.LNS` (topology only —
//     they index the 42-vertex plane model that lives in the PROGRAM ROM
//     `RBARON.MAC`, not this file);
//   • the self-contained pictures whose vertices AND decode-lists both live in
//     037007.XXX: the propeller, the four explosion-debris pieces, the two
//     star-burst debris shapes, and the blimp/Zeppelin;
//   • the plane collision-detect points `COLLD`.
//
// CONNECT-LIST OPCODE SEMANTICS (the `BLANKV`/`VSBLEV` macros, 037007.XXX:20-40):
// a connect-list is a stream of bytes, each `pointIndex * 6 + flag`, terminated
// by `ENDDB` = $FF. The `* 6` is the stride of a transformed-point record in the
// decode scratch buffer `DB.TRP` (Z,X,Y each 2 bytes). The low bits are the pen:
//   BLANKV/BV .P → .P*6+0  — pen UP, move dark to vertex P
//   VSBLEV/VV .P → .P*6+1  — pen DOWN, draw a visible line to vertex P
//   SEGSTR    .P → .P*6+4  — mountain-segment start (used only by the ground-wave
//                            SCAPE lists, which are out of this module's scope)
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
/** Opcode flag: SEGSTR — mountain-segment start (ground-wave lists only, not used here). */
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

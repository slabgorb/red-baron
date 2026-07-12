// src/tools/romCompare.ts
//
// Pairs the baked ROM pictures (romPictures.generated.ts) against red-baron's
// own ported geometry (core/topology.ts + core/biplane.ts) and diffs their
// edges. PURE — no DOM — so the pairing and the diff are unit-tested;
// contactSheet.ts only renders the result.
//
// UNLIKE star-wars's romCompare.ts (whose port edges were RECONSTRUCTED by
// heuristic, because WSOBJ.MAC held no draw list for many objects), every one
// of red-baron's port connect-lists (DB_MAP/DB_MAR/DB_LNS, PPROPA-C,
// PCDEC0-2, DESTR0-1, DBLIMP) was transcribed DIRECTLY from these same ROM
// tables (rb2-2, rb2-7, rb3-1 findings). So near-zero drift here is the
// EXPECTED result, not a first-look discovery — a genuine mismatch is a real
// transcription error worth reporting, never something to "fix" by editing
// the port to match this tool's output.
//
// Dev tool. Never imported by src/core.

import {
  type Point3,
  type ConnectOp,
  DB_MAP,
  DB_MAR,
  DB_LNS,
  COLLD_POINTS,
  DBPROP_POINTS,
  PPROPA,
  PPROPB,
  PPROPC,
  PIECE0_POINTS,
  PIECE1_POINTS,
  PIECE2_POINTS,
  PIECE3_POINTS,
  PCDEC0,
  PCDEC1,
  PCDEC2,
  STAR0_POINTS,
  STAR1_POINTS,
  DESTR0,
  DESTR1,
  BLIMP_POINTS,
  DBLIMP,
} from '../core/topology'
import { PLANE_POINTS, DRONE_POINTS } from '../core/biplane'
import { ROM_PICTURES, type RomPicture } from './romPictures.generated'

export type Edge = readonly [number, number]

/** Orientation-independent identity, so [1,3] and [3,1] are one edge. */
export function edgeKey([a, b]: Edge): string {
  return a <= b ? `${a}-${b}` : `${b}-${a}`
}

/** A degenerate edge whose two endpoints are the same vertex — draws nothing,
 * so it is never real connectivity and must never be reported as drift. */
function isSelfEdge([a, b]: Edge): boolean {
  return a === b
}

export function diffEdges(
  rom: readonly Edge[],
  port: readonly Edge[],
): { onlyInRom: string[]; onlyInPort: string[] } {
  const r = new Set(rom.filter((e) => !isSelfEdge(e)).map(edgeKey))
  const p = new Set(port.filter((e) => !isSelfEdge(e)).map(edgeKey))
  return {
    onlyInRom: [...r].filter((k) => !p.has(k)),
    onlyInPort: [...p].filter((k) => !r.has(k)),
  }
}

/** Mirrors scripts/rom-models/derive.mjs's `connectToEdges` (duplicated, not
 * imported — the browser build cannot import from scripts/, the same reason
 * star-wars's romCompare.ts is a separate TS-native implementation; see
 * derive.mjs's own header comment). Walks a connect-list as a pen turtle: a
 * BLANKV op (`draw: false`) moves the pen dark; a VSBLEV op (`draw: true`)
 * draws a line from the pen's current vertex to its own. */
function connectToEdges(connect: readonly ConnectOp[]): Edge[] {
  const edges: Edge[] = []
  let prev: number | null = null
  for (const op of connect) {
    if (op.draw && prev !== null) edges.push([prev, op.point])
    prev = op.point
  }
  return edges
}

/** Element-wise deep equality over two point arrays — same length AND every
 * [x,y,z] triple identical at every index. Edges are indices into the point
 * array, so a reorder (same length, same first point, different order past
 * that) would silently shift what every edge index points at and make an
 * edge diff meaningless even though it would still "run" without error.
 * Deliberately NOT a length/first-point spot check. */
function pointsEqual(a: readonly Point3[], b: readonly Point3[]): boolean {
  if (a.length !== b.length) return false
  return a.every((v, i) => v[0] === b[i][0] && v[1] === b[i][1] && v[2] === b[i][2])
}

/** A port picture's data, shaped to mirror `RomPicture`: raw points plus the
 * connect-list topology.ts/biplane.ts actually store (not pre-derived
 * edges — this module derives them itself, the same way the ROM side's baked
 * `edges` were derived, so both sides go through one `connectToEdges` walk). */
export interface PortPicture {
  readonly points: readonly Point3[]
  readonly connect: readonly ConnectOp[]
}

/**
 * ROM picture name (see ROM_PICTURES / the bake spec table) -> its port
 * counterpart's points + connect-list. Every entry cited against
 * topology.ts's / biplane.ts's own doc comments — not copied blind.
 *
 * - 'Plane (near)' composes the SAME [...DB_MAP, ...DB_MAR, ...DB_LNS] list
 *   biplane.ts's own NEAR_MODEL uses (topology.ts's DB_MAP/DB_MAR fall-through
 *   note); 'Plane (drone LOD)' is DRONE_POINTS + DB_MAR alone, mirroring
 *   biplane.ts's FAR_MODEL.
 * - 'Piece 3' maps to PCDEC2 (not a dedicated PCDEC3) — topology.ts's own
 *   PLPCDE table documents PIECE3 deliberately reusing PIECE2's decode-list.
 * - 'Collision pts' has an empty connect-list on BOTH sides: COLLD is a
 *   ROM point-table only (037007.XXX), and topology.ts's COLLD_POINTS has no
 *   companion connect-list either — there is nothing to diff edges over.
 */
export const ROM_TO_PORT: Readonly<Record<string, PortPicture>> = {
  'Plane (near)': { points: PLANE_POINTS, connect: [...DB_MAP, ...DB_MAR, ...DB_LNS] },
  'Plane (drone LOD)': { points: DRONE_POINTS, connect: DB_MAR },
  'Prop A': { points: DBPROP_POINTS, connect: PPROPA },
  'Prop B': { points: DBPROP_POINTS, connect: PPROPB },
  'Prop C': { points: DBPROP_POINTS, connect: PPROPC },
  'Piece 0': { points: PIECE0_POINTS, connect: PCDEC0 },
  'Piece 1': { points: PIECE1_POINTS, connect: PCDEC1 },
  'Piece 2': { points: PIECE2_POINTS, connect: PCDEC2 },
  'Piece 3': { points: PIECE3_POINTS, connect: PCDEC2 },
  'Star 0': { points: STAR0_POINTS, connect: DESTR0 },
  'Star 1': { points: STAR1_POINTS, connect: DESTR1 },
  Blimp: { points: BLIMP_POINTS, connect: DBLIMP },
  'Collision pts': { points: COLLD_POINTS, connect: [] },
}

export interface PicturePair {
  readonly name: string
  readonly rom: RomPicture
  readonly port: PortPicture | null
  /** The port's edges, derived from `port.connect` the same way the ROM
   * side's `rom.edges` were baked. Empty when there is no port mapping. */
  readonly portEdges: readonly Edge[]
  /** True when the ROM picture itself carries no connect-list (only
   * `Collision pts` today — 037007.XXX's `COLLD` table is points-only). Cells
   * in this state must render dots and must NEVER claim edge drift. */
  readonly pointsOnly: boolean
  /** Whether the ROM and port point arrays are deep-equal. Only meaningful
   * when `port` is non-null; false (not "unknown") otherwise. */
  readonly verticesMatch: boolean
  readonly onlyInRom: string[]
  readonly onlyInPort: string[]
}

/** Pure per-pair logic, split out of `pairPictures` so it is unit-testable
 * against fabricated fixtures without touching the real ROM_PICTURES data. */
export function pairOne(rom: RomPicture, port: PortPicture | null): PicturePair {
  const pointsOnly = rom.connect.length === 0
  const portEdges = port ? connectToEdges(port.connect) : []
  const verticesMatch = port ? pointsEqual(rom.points, port.points) : false
  // Edges are indices into `points` — an edge diff is only meaningful when
  // the picture actually carries a connect-list on both sides AND the two
  // point arrays agree. Refuse otherwise: reporting edge drift over
  // mismatched point arrays (or over a points-only picture) would be a
  // fabricated result.
  const d = port && !pointsOnly && verticesMatch
    ? diffEdges(rom.edges, portEdges)
    : { onlyInRom: [], onlyInPort: [] }
  return { name: rom.name, rom, port, portEdges, pointsOnly, verticesMatch, ...d }
}

/** Every baked ROM picture, paired with its port counterpart. */
export function pairPictures(): PicturePair[] {
  return ROM_PICTURES.map((rom) => pairOne(rom, ROM_TO_PORT[rom.name] ?? null))
}

export interface Verdict {
  readonly text: string
  /** Whether this verdict represents real ROM/port disagreement (drives the
   * contact sheet's warning colour). */
  readonly drift: boolean
}

/**
 * The contact sheet cell's verdict line — extracted from contactSheet.ts so
 * the decision logic is unit-testable without a canvas.
 *
 * Must NEVER report edge drift for a `pointsOnly` pair (Collision pts): there
 * is no connect-list on either side to diff, so the only honest comparison is
 * the points themselves.
 *
 * Must ALSO never print an edge-drift count when the ROM and port point
 * arrays disagree: edges are indices into `points`, so a mismatch invalidates
 * any edge diff `pairOne` might otherwise have computed (it already refuses
 * to compute one in that case — this checks `verticesMatch` first and
 * reports that state honestly instead of falling through to "match" on the
 * resulting zero drift).
 */
export function verdictFor(p: PicturePair): Verdict {
  if (!p.port) return { text: '— no port mapping', drift: false }
  if (p.pointsOnly) {
    return p.verticesMatch
      ? { text: '✓ points match (points only)', drift: false }
      : { text: '⚠ points differ (points only)', drift: true }
  }
  if (!p.verticesMatch) {
    return { text: 'vertices differ — edge diff not meaningful', drift: true }
  }
  const drift = p.onlyInRom.length + p.onlyInPort.length
  if (drift > 0) {
    return {
      text: `⚠ ${p.onlyInRom.length} in ROM not in port · ${p.onlyInPort.length} in port not in ROM`,
      drift: true,
    }
  }
  return { text: '✓ edges match', drift: false }
}

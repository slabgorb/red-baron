// src/core/landscape.ts
//
// The scrolling ground-wave landscape (story rb3-3): up to 4 PFOBJ mountain slots
// that scroll toward the player and "fall" from the horizon (PFOBMN,
// RBARON.MAC:3264-3430), stroked as glowing vectors THROUGH the rb1 scene substrate
// (scene.ts / camera.ts) — this module adds NO renderer of its own.
//
// THE MODEL (findings §4/§8, PFOBMN). A mountain is a 2-D SCAPE silhouette placed at
// a depth Z in front of the eye and given apparent size by the SAME divide-by-depth
// projection as the biplanes. Its depth DECREASES each calc-frame — the mountain
// approaches. While depth >= HORZ it is "on the horizon" (a far silhouette); below
// HORZ (ROM threshold P.MAXZ = HORZ+1) it has "fallen" off the horizon and grows as
// it nears. Near the eye (depth <= MIN_DEPTH) it RECYCLES back to the horizon
// (RBARON.MAC:3356-3364) so the four slots feed a continuous pass.
//
// HEX-RADIX NOTE (the recurring red-baron footgun): the horizon depth is HORZ = $1000
// (4096), NOT HORIZN = $40. HORIZN is the "HORIZON OFFSET (Y AXIS)" (RBARON.MAC:455) —
// a post-divide SCREEN offset — and has nothing to do with the mountain's fall depth.
//
// SCOPE: forward (L→R) scroll only; the reverse SMP** stitch-lists are a deferred
// follow-up (rb3-3 TEA deviation). The exact per-frame scroll delta is a display
// tuning parameter, not a ported ROM constant (ROM P.OBDZ/$180 counts raw ROM Z units;
// this port's Z is in scene world units, like enemy P_INDP=1080).
//
// PURE and deterministic. No DOM, no time, no randomness.

import { multiply, type Vec3 } from '@arcade/shared/math3d'
import { flightView, type Attitude } from './camera'
import { projectSegment, sceneProjection, type SceneSegment } from './scene'
import { SCAPES, PFOPOS, MOUNTAIN_SEGMAPS, HORZ, type Point2 } from './topology'

/** The four PF-object slots — N.PFOB = 3*L.PFOB names four records (RBARON.MAC:245/441). */
export const MAX_MOUNTAINS = 4

/** Horizon spawn / recycle depth — the Z a mountain (re)appears at, on the horizon (HORZ = $1000). */
export const SPAWN_DEPTH = HORZ

/** Near-plane recycle threshold — the ROM `$0C0` minimum depth (RBARON.MAC:3349). 0 < MIN_DEPTH < HORZ. */
export const MIN_DEPTH = 0xc0 // 192

/** World Z the mountain scrolls in per calc-frame — a display-feel delta, not a ROM constant. */
const DEPTH_STEP = 64

/** One scrolling mountain — a SCAPE silhouette closing on the eye. */
export interface Mountain {
  /** Which SCAPE silhouette (0-3); indexes {@link SCAPES}. */
  readonly scape: number
  /** Z distance in front of the eye — SPAWN_DEPTH on the horizon, decreasing toward the player. */
  readonly depth: number
  /** Lateral world offset (the PFOBJ X scroll). */
  readonly x: number
  /** Occupies a slot / is drawn. */
  readonly active: boolean
}

/** A single mountain freshly on the horizon at {@link SPAWN_DEPTH}. */
export function spawnMountain(scape: number): Mountain {
  return { scape, depth: SPAWN_DEPTH, x: 0, active: true }
}

/**
 * The opening ≤4-slot fill: one of each SCAPE silhouette, staggered in depth across
 * the pass so the player meets a landscape already in progress rather than an empty
 * horizon that suddenly populates.
 */
export function initialMountains(): readonly Mountain[] {
  const gap = (SPAWN_DEPTH - MIN_DEPTH) / MAX_MOUNTAINS
  return Array.from({ length: MAX_MOUNTAINS }, (_, i) => ({
    scape: i,
    depth: SPAWN_DEPTH - i * gap,
    x: 0,
    active: true,
  }))
}

/**
 * One calc-frame of scroll: the mountain's depth decreases toward the eye. When it
 * reaches the near-plane minimum it recycles back to the horizon (a continuous pass),
 * rather than vanishing (RBARON.MAC:3356-3364).
 */
export function stepMountain(m: Mountain): Mountain {
  if (!m.active) return m
  const next = m.depth - DEPTH_STEP
  return next <= MIN_DEPTH ? { ...m, depth: SPAWN_DEPTH } : { ...m, depth: next }
}

/** Whether the mountain is still on the horizon (depth at/above the horizon depth HORZ) — not yet fallen. */
export function onHorizon(m: Mountain): boolean {
  return m.depth >= HORZ
}

/** A silhouette point at a mountain's world position: forward is −Z, so depth negates. */
function worldPoint(p: Point2, m: Mountain): Vec3 {
  return [m.x + p[0], p[1], -m.depth]
}

/**
 * The active mountains projected to NDC segments for the shell to stroke — through
 * the rb1 scene substrate (scene.projectSegment under the shared camera + projection).
 * Each silhouette is stitched from its SEGSTR start-points ({@link PFOPOS}, forward)
 * and SMAP** connect-lists ({@link MOUNTAIN_SEGMAPS}): VV draws a line, BV lifts the
 * pen. Behind-eye segments (projectSegment → null) are dropped, never leaked.
 */
export function mountainSegments(
  mountains: readonly Mountain[],
  attitude: Attitude,
  eye: Vec3,
  aspect: number,
): readonly SceneSegment[] {
  const active = mountains.filter((m) => m.active)
  if (active.length === 0) return []
  const mvp = multiply(sceneProjection(aspect), flightView(attitude, eye))
  const out: SceneSegment[] = []
  for (const m of active) {
    const points = SCAPES[m.scape]
    const segMaps = MOUNTAIN_SEGMAPS[m.scape]
    const starts = PFOPOS[m.scape] // forward (L→R) segment starts
    for (let g = 0; g < segMaps.length; g++) {
      let current = starts[g]
      for (const op of segMaps[g]) {
        if (op.draw) {
          const seg = projectSegment(worldPoint(points[current], m), worldPoint(points[op.point], m), mvp)
          if (seg) out.push(seg)
        }
        current = op.point
      }
    }
  }
  return out
}

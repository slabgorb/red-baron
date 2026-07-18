// src/core/prop.ts
//
// The propeller — the ROM's most prominent foreground element (rb4-9). Both the
// player's own prop (a cockpit-foreground picture) and each enemy plane's prop are
// drawn from ONE transcribed model: DBPROP_POINTS + the three blade-pair connect
// lists PPROPA/B/C (topology.ts, from 037007.XXX:426-470).
//
// THE DISPLAY CLOCK. PLPROP (RBARON.MAC:880-895) switches the prop picture once per
// VG frame (62.5 Hz) — `JSR PLPROP` runs right after `INTWAIT ;WAIT FOR EOF`
// (:851-855), stepping PROP.F by 2 and wrapping at 6, so the PICTURE (PROP.F/2)
// cycles 0 → 1 → 2 → 0, ONE picture per display frame. The shell advances a display
// counter once per frame() and selects with `propFrame` — NOT off the ~10.4 Hz calc
// frame, or the blade would turn ~6× too slow (the Red Baron ÷N trap, timing.ts).
//
// PURE + deterministic. No DOM, no time, no randomness — geometry lives in core
// (main.ts:63-101). Mirrors biplane.ts's renderModel pen turtle.

import { DBPROP_POINTS, PROPS } from './topology'
import { sceneProjection, projectSegment, type SceneSegment } from './scene'
import { multiply, scaling, translation, type Mat4 } from '@arcade/shared/math3d'

/** The three blade-pair pictures the prop cycles through (PROP.F/2 ∈ {0,1,2}). */
export const PROP_PICTURES = 3

/**
 * The prop PICTURE to draw on a given DISPLAY frame — PLPROP's PROP.F, one advance per VG frame,
 * wrapping through the three pictures (RBARON.MAC:880-887). A pure function of the display counter.
 */
export function propFrame(displayCount: number): number {
  const n = Math.trunc(displayCount)
  return ((n % PROP_PICTURES) + PROP_PICTURES) % PROP_PICTURES
}

/**
 * Render one prop picture to NDC segments through a composed MVP — the DBPROP point-set walked by
 * the selected blade connect-list, exactly like renderModel's pen turtle: a VSBLEV op draws a line
 * from the pen's current vertex, a BLANKV op moves it dark. Segments behind the eye are dropped
 * (scene.ts never mirrors a ghost). `picture` is clamped into the three-picture table.
 */
export function propSegments(picture: number, mvp: Mat4): readonly SceneSegment[] {
  const connect = PROPS[propFrame(picture)]
  const segments: SceneSegment[] = []
  let current = null as (typeof DBPROP_POINTS)[number] | null
  for (const op of connect) {
    const vertex = DBPROP_POINTS[op.point]
    if (op.draw && current !== null) {
      const segment = projectSegment(current, vertex, mvp)
      if (segment !== null) segments.push(segment)
    }
    current = vertex
  }
  return segments
}

/**
 * The PLAYER's own propeller — the same picture, posed in the cockpit foreground (large, just ahead
 * of the eye) so it sweeps across the bottom of the view. The pose is OUR seam (the ROM patches it
 * straight into a VG buffer slot); scale/placement are playtest-tunable. Drawn every display frame
 * with `propFrame(displayCounter)` as the picture.
 */
const PLAYER_PROP_SCALE = 8
const PLAYER_PROP_Z = 100
export function playerPropSegments(picture: number, aspect: number): readonly SceneSegment[] {
  const model: Mat4 = multiply(
    translation(0, 0, -PLAYER_PROP_Z),
    scaling(PLAYER_PROP_SCALE, PLAYER_PROP_SCALE, 1),
  )
  return propSegments(picture, multiply(sceneProjection(aspect), model))
}

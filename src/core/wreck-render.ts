// src/core/wreck-render.ts
//
// The downed enemy's PICTURE — story rb2-6's render arm, extracted from main.ts by rb4-1.
//
// explosion.ts owns the wreck's KINEMATICS (the UPPLEX fall, the spin, the phase timers, all
// ROM-pinned). This module owns what that wreck LOOKS LIKE: a spinning biplane while it
// FALLS, then the four authentic PIECE0-3 debris models bursting outward while it EXPLODES,
// then nothing.
//
// ─── WHY IT IS ITS OWN MODULE ───────────────────────────────────────────────────
//
// It was `drawWreck` in main.ts, and main.ts touches `document` at module scope — so under
// vitest's node environment it cannot be imported, and nothing in it could ever be tested.
// That is not a documentation problem, it is a structural one: rb4-1's HIGH findings are both
// bugs that lived in main.ts precisely BECAUSE main.ts is the one place a test cannot look.
// The tracer's depth conversion drifted 8x there; the blimp's despawn bound drifted 3.5x
// there. This is pure geometry — a function of (wreck, mvp) — so it moves somewhere a test
// can call it, and the burst is now measured instead of merely rendered.
//
// It does not go into explosion.ts because explosion.ts is the ROM's arithmetic and imports
// nothing but the debris data; hanging the projection substrate off it would drag scene.ts,
// biplane.ts and the shared Math Box into the module that owns EX.ACY. (guns.ts and blimp.ts
// took the other route — their pictures live beside their sims — because in both cases the
// picture had to AGREE with a number the sim owns: the shell's depth, the airship's hull. The
// wreck's picture agrees with nothing but itself.)
//
// ─── THE DEBRIS SPREAD IS A SCREEN CONSTANT (rb4-1 Reviewer, finding 1's class) ──
//
// `DEBRIS_SPREAD = 4` window units per exploding frame was a position ON THE SCREEN written in
// world units, so the 3.91x depth sweep silently shrank the burst. A plane killed at its spawn
// depth (4224) burst into a cloud 2% of the frame's half-height wide — an invisible pop where
// there had been an explosion. See src/core/screen.ts for the class; it is denominated in the
// frame now, at the depth the wreck is actually seen at.
//
// PURE and deterministic. No DOM, no time, no randomness.

import { EXPL2_FRAMES, type Wreck } from './explosion'
import { EXPLOSION_PIECES } from './topology'
import { biplaneLOD, renderModel } from './biplane'
import { frustumHalfHeight } from './screen'
import type { SceneSegment } from './scene'
import { multiply, rotationZ, translation, type Mat4 } from '@arcade/shared/math3d'

/** Each of the four PIECE0-3 debris fragments flies out along a distinct diagonal. Inferred. */
const DEBRIS_DIRS: readonly (readonly [number, number])[] = [
  [-1, 1],
  [1, 1],
  [-1, -1],
  [1, -1],
]

/**
 * How far the burst has opened by its LAST exploding frame, as a fraction of the frame's
 * HALF-HEIGHT at the wreck's depth. (Half-height, so the burst is the same size on a phone and
 * on an ultrawide — see screen.ts.) Inferred: the ROM's debris spread is not byte-transcribed.
 *
 * 0.12 of the half-height ≈ 6% of the screen's height at full spread — a burst you can see,
 * at ANY depth. The old `4 units per frame` was 14% of the half-height at the blimp's old
 * cruise depth and 2% at a plane's spawn depth: the same constant, a seven-fold difference in
 * what the player saw, decided entirely by how far away the thing that died happened to be.
 */
const DEBRIS_SPREAD_NDC = 0.12

/**
 * The half-spread of the debris cloud, in world units, `framesElapsed` frames into the
 * EXPL2 window, for a wreck at `depth`. Opens linearly to DEBRIS_SPREAD_NDC of the frame's
 * half-height by the final frame — so the burst subtends the same angle whatever depth the
 * plane died at.
 */
export function debrisSpread(depth: number, framesElapsed: number): number {
  const half = frustumHalfHeight(depth)
  return (half * DEBRIS_SPREAD_NDC * framesElapsed) / EXPL2_FRAMES
}

/**
 * The downed enemy as NDC segments for the shell to stroke: a spinning biplane while it FALLS,
 * the four PIECE0-3 debris models bursting outward while it EXPLODES, and nothing once it is
 * 'done'. `renderModel` accepts any {points, connect} picture, so the topology debris pieces
 * render exactly like the plane does.
 */
export function wreckSegments(wreck: Wreck, viewProj: Mat4): readonly SceneSegment[] {
  if (wreck.phase === 'done') return []

  if (wreck.phase === 'falling') {
    const model = multiply(translation(wreck.x, wreck.y, -wreck.depth), rotationZ(wreck.spin))
    // rb4-13: the model follows the D4 bit the plane died wearing — never its depth.
    return renderModel(biplaneLOD(wreck.facingAway), multiply(viewProj, model))
  }

  // exploding — the burst opens as the EXPL2 window counts down
  const framesElapsed = EXPL2_FRAMES - wreck.timer
  const spread = debrisSpread(wreck.depth, framesElapsed)
  const segments: SceneSegment[] = []
  EXPLOSION_PIECES.forEach((piece, i) => {
    const [dx, dy] = DEBRIS_DIRS[i]
    const model = multiply(
      translation(wreck.x + dx * spread, wreck.y + dy * spread, -wreck.depth),
      rotationZ(wreck.spin),
    )
    segments.push(...renderModel(piece, multiply(viewProj, model)))
  })
  return segments
}

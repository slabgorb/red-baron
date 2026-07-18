// src/core/windscreen.ts
//
// The windscreen bullet holes (rb4-9 / AC-4). As the ace shoots you, holes crack
// across the glass — the ROM's WNDSHD / B.HOLE sequence (RBARON.MAC:1099-1103,
// 1482-1496). Each hit steps B.HOLE (capped), and the holes are drawn on the side
// the enemy attacks from: ENSIDE + X → SEQUNA (right), − X → SEQUNB (left).
//
// PURE state + geometry. No DOM, no time, no randomness.

import { type SceneSegment, V_BRIT_MAX } from './scene'

/**
 * The most holes the glass accumulates. The ROM steps B.HOLE by 2 and stops once it reaches 0x0C
 * (`LDA B.HOLE / CMP I,0C / BCS 30$`, RBARON.MAC:1099-1102), so 0x0C / 2 = SIX holes.
 */
export const MAX_BULLET_HOLES = 6

/** The accumulated windscreen damage: how many holes, and which side the last hits came from. */
export interface Windscreen {
  readonly holes: number
  /** ENSIDE — the side the enemy attacks from: +1 draws holes RIGHT (SEQUNA), −1 LEFT (SEQUNB). */
  readonly side: -1 | 1
}

/** Clean glass. */
export function initialWindscreen(): Windscreen {
  return { holes: 0, side: 1 }
}

/**
 * One more hit — `INC B.HOLE`, capped at {@link MAX_BULLET_HOLES}. The hole lands on the attacker's
 * side (ENSIDE), so the record follows the side of the shot that made it.
 */
export function addBulletHole(ws: Windscreen, side: -1 | 1): Windscreen {
  return { holes: Math.min(MAX_BULLET_HOLES, ws.holes + 1), side }
}

/**
 * The cracked glass as NDC vectors — one small starburst per hole, clustered on the ENSIDE half of
 * the windscreen. HUD overlay geometry (screen space), so it is authored directly in NDC rather
 * than projected. Empty on clean glass.
 */
export function windscreenSegments(ws: Windscreen): readonly SceneSegment[] {
  const segments: SceneSegment[] = []
  const r = 0.03
  for (let i = 0; i < ws.holes; i++) {
    // Spread the holes across the attacker's half: x keeps the ENSIDE sign, y walks up the glass.
    const cx = ws.side * (0.2 + 0.12 * (i % 3))
    const cy = 0.25 - 0.14 * Math.floor(i / 3)
    // A four-spoke starburst — a shattered pane, centred at (cx, cy).
    for (const [dx, dy] of [[r, 0], [0, r], [r, r], [r, -r]]) {
      segments.push({ x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy, intensity: V_BRIT_MAX })
    }
  }
  return segments
}

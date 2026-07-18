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
// follow-up (rb3-3 TEA deviation).
//
// rb4-1: the scroll deltas ARE ported ROM constants — the old comment here claimed they
// were "display tuning", and a single invented DEPTH_STEP=64 stood in for both of them.
// The ROM runs TWO closing rates (P_OBDZ on the horizon, PF_FALLEN_DZ once fallen), and
// the mountains' opening depths and lanes are AUTHORED (PFOBIZ), not generated.
//
// rb4-8 lands the two MACHINES those numbers feed (PFOBMN, RBARON.MAC:3269-3410):
//   * The on-horizon status is a LATCHED bit (PFOBJ+6 D7), not a live `depth >= HORZ`
//     test. It drives the close rate and flips on→fallen at P_MAXZ (0x1001, `AND I,0F`
//     :3400) and fallen→on ONLY at recycle (`ORA I,80` :3358) — genuine hysteresis.
//   * FALLEN mountains scroll LATERALLY: the ROM subtracts PLYRDL from each free object's
//     X each calc frame (:3299-3306) and WRAPs it at ±0x0C01 (WRAPIT, :4341-4348). rb4-5
//     centralised the pilot's pan in the WORLD EYE for the non-wrapping playfield (the
//     horizon), but a wrapping free object needs BOUNDED per-object lateral state, so the
//     mountain pan lives in `m.x` here — and `mountainSegments` takes altitude ONLY, never
//     the lateral eye, so the pan is applied exactly once (see the render note below).
//
// PURE and deterministic. No DOM, no time, no randomness.

import { multiply, type Vec3 } from '@arcade/shared/math3d'
import { flightView, type Attitude } from './camera'
import { projectWorldSegment, sceneProjection, type SceneSegment } from './scene'
import { SCAPES, PFOPOS, MOUNTAIN_SEGMAPS, type Point2 } from './topology'

/** The four PF-object slots — N.PFOB = 3*L.PFOB names four records (RBARON.MAC:245/441). */
export const MAX_MOUNTAINS = 4

// ─── ROM-exact data (RBARON.MAC, `.RADIX 16` region — HEX) ───────────────────

/**
 * P.OBZI — the Z a mountain (re)appears at when it recycles, FAR beyond the horizon.
 * RBARON.MAC:443 `P.OBZI =7F00`, .RADIX 16 region (set at :74) → 0x7F00 = 32512.
 *
 * We had `SPAWN_DEPTH = HORZ` (4096) — 7.94× too shallow, and the consequence was not
 * subtle: a mountain spawned AT the horizon depth and the very first step dropped it
 * below, so OUR MOUNTAINS WERE NEVER ON THE HORIZON AT ALL. The ROM's closes from
 * 0x7F00 to the fall threshold at P_OBDZ/frame — (32512 − 4097) / 384 ≈ 74 calc-frames
 * ≈ 7.1 SECONDS as a distant silhouette before it starts to grow.
 */
export const SPAWN_DEPTH = 0x7f00

/**
 * The near-plane recycle threshold — a 16-BIT compare, and that is the whole point.
 * RBARON.MAC:3349-3355 is the standard 6502 16-bit idiom: `CPY I,0C0` against the LOW
 * byte, then `SBC I,1` against the HIGH byte. The constant is therefore
 * (0x01 << 8) | 0xC0 = 0x01C0 = 448 — not the CPY operand 0xC0 = 192 alone.
 *
 * The same idiom appears twelve lines later against P.MAXZ (`CPY I,P.MAXZ&0FF` /
 * `SBC I,P.MAXZ&0FF00/100`, RBARON.MAC:3397-3398), where the assembler itself splits
 * 0x1001 into LSB and MSB — which proves the pattern. We took only the CPY operand.
 */
export const MIN_DEPTH = 0x01c0

/**
 * WRAPIT's lateral screen limit. RBARON.MAC:4341-4348: a free object whose |X| reaches
 * the limit "CHANGE[s] SIDES" — it is folded back to the far edge (`LDX I,-0C01…`, :4347).
 * So a fallen mountain's X lives in [−WRAP_LIMIT, +WRAP_LIMIT] and recycles laterally into
 * a continuous band as the pilot turns. 0x0C01 = 3073 = one unit beyond the outermost
 * authored lane PFOBIZ_X = ±0x0C00 (:1306).
 */
export const WRAP_LIMIT = 0x0c01

/**
 * P.OBDZ — the closing rate WHILE ON THE HORIZON.
 * RBARON.MAC:444 `P.OBDZ =180`, .RADIX 16 region (set at :74) → 0x180 = 384.
 * (";PF OBJECT Y DELTA Z (WHILE ON HORIZON)")
 */
export const P_OBDZ = 0x180

/**
 * P.MAXZ — the on→fallen threshold. RBARON.MAC:445 `P.MAXZ =1001`, .RADIX 16 → 0x1001.
 * ("PF OBJECT MAX Z (WHILE ON HORIZON)".) An on-horizon mountain stays on the horizon
 * while depth >= P_MAXZ (`BCS 35$`, :3399); the calc frame its depth drops BELOW P_MAXZ,
 * PFOBMN clears D7 (`AND I,0F`, :3400) to "START PF OBJECT 'FALL'". This is HORZ+1, not
 * HORZ — the fall fires one unit past the horizon depth.
 */
export const P_MAXZ = 0x1001

/**
 * The closing rate ONCE FALLEN — a bare literal in PFOBMN's free-object branch:
 * RBARON.MAC:3341 `LDA I,20 ;STANDARD DELTA`, .RADIX 16 region → 0x20 = 32.
 *
 * So a mountain closes 384/frame while distant and 32/frame while near — a 12:1 ratio.
 * We shipped a single invented `DEPTH_STEP = 64`, which is neither.
 */
export const PF_FALLEN_DZ = 0x20

/**
 * PFOBIZ — the four mountains' AUTHORED opening depths.
 * RBARON.MAC:1305 `PFOBIZ: .WORD 8200,6E0,3220,0D20`, .RADIX 16 region → HEX.
 *
 * GMINIT classifies each by its Z MSB against 0x11 (RBARON.MAC:1258-1261), so the
 * arcade OPENS with two mountains on the horizon (0x82, 0x32) and two already fallen
 * (0x06, 0x0D). We generated an even arithmetic stagger instead.
 */
export const PFOBIZ_DEPTHS: readonly number[] = Object.freeze([0x8200, 0x06e0, 0x3220, 0x0d20])

/**
 * PFOBIZ — the four mountains' AUTHORED lateral lanes.
 * RBARON.MAC:1306 `.WORD -0C00,-400,400,0C00`, .RADIX 16 region → HEX:
 * −3072, −1024, +1024, +3072. We placed ALL FOUR at x = 0, stacked in one lane.
 */
export const PFOBIZ_X: readonly number[] = Object.freeze([-0x0c00, -0x400, 0x400, 0x0c00])

/** One scrolling mountain — a SCAPE silhouette closing on the eye. */
export interface Mountain {
  /** Which SCAPE silhouette (0-3); indexes {@link SCAPES}. */
  readonly scape: number
  /** Z distance in front of the eye — SPAWN_DEPTH on the horizon, decreasing toward the player. */
  readonly depth: number
  /** Lateral world offset (the PFOBJ X scroll) — for a FALLEN mountain this is the
   *  ROM's stored free-object X: it pans with the pilot and WRAPs at ±{@link WRAP_LIMIT}. */
  readonly x: number
  /** Occupies a slot / is drawn. */
  readonly active: boolean
  /** The LATCHED on-horizon status bit (PFOBJ+6 D7). It drives the close rate and gates
   *  the lateral scroll; it flips on→fallen at {@link P_MAXZ} and fallen→on ONLY at recycle
   *  — a stored bit with hysteresis, NOT a live `depth >= HORZ` recompute. */
  readonly onHorizon: boolean
}

/** A single mountain freshly on the horizon at {@link SPAWN_DEPTH} — latched on-horizon. */
export function spawnMountain(scape: number): Mountain {
  return { scape, depth: SPAWN_DEPTH, x: 0, active: true, onHorizon: true }
}

/**
 * The opening 4-slot fill — AUTHORED, not generated (GMINIT, RBARON.MAC:1258-1269).
 * Each slot takes its depth from {@link PFOBIZ_DEPTHS} and its lane from
 * {@link PFOBIZ_X}, so the player meets the arcade's opening landscape: two mountains
 * still on the horizon, two already fallen, spread across four lateral lanes.
 */
export function initialMountains(): readonly Mountain[] {
  return Array.from({ length: MAX_MOUNTAINS }, (_, i) => ({
    scape: i,
    depth: PFOBIZ_DEPTHS[i],
    x: PFOBIZ_X[i],
    active: true,
    // GMINIT classifies each slot by its Z MSB against 0x11 (RBARON.MAC:1258-1262:
    // `CMP I,11` / `BCC` skip / `ORA I,80`): MSB >= 0x11 opens on the horizon, below is
    // already fallen. PFOBIZ MSBs [0x82,0x06,0x32,0x0D] ⇒ [horizon, fallen, horizon, fallen].
    onHorizon: PFOBIZ_DEPTHS[i] >> 8 >= 0x11,
  }))
}

/**
 * One calc-frame of the mountain (PFOBMN, RBARON.MAC:3269-3410). The stored `onHorizon`
 * bit — NOT a live depth test — selects the branch:
 *
 *   * ON HORIZON (D7 set, 45$): close by P_OBDZ (384)/frame, NO lateral scroll. The frame
 *     depth drops below P_MAXZ (0x1001), the bit latches to fallen (`AND I,0F`, :3400).
 *   * FALLEN (D7 clear, 15$): pan the stored X by `playerDX` (the ROM's `SBC A,PLYRDL`,
 *     :3299-3306) and WRAP it into the ±WRAP_LIMIT band, then close by PF_FALLEN_DZ (32)/
 *     frame. At the near-plane minimum (0x01C0) it recycles to P.OBZI and re-latches to
 *     on-horizon (`ORA I,80`, :3358) — the only fallen→on transition, giving the hysteresis.
 *
 * `playerDX` is the per-frame scaled player X delta (PLYRDL) in stored-X units; the caller
 * hands ONE value to every mountain. On-horizon mountains ignore it — only free objects pan.
 */
export function stepMountain(m: Mountain, playerDX: number): Mountain {
  if (!m.active) return m
  if (m.onHorizon) {
    const depth = m.depth - P_OBDZ
    return { ...m, depth, onHorizon: depth >= P_MAXZ }
  }
  const x = wrapLateral(m.x - playerDX)
  const depth = m.depth - PF_FALLEN_DZ
  return depth <= MIN_DEPTH
    ? { ...m, x, depth: SPAWN_DEPTH, onHorizon: true }
    : { ...m, x, depth, onHorizon: false }
}

/**
 * WRAPIT (RBARON.MAC:4341-4348): fold a free object's X back into the ±{@link WRAP_LIMIT}
 * screen band, changing sides when it crosses the limit — so a fallen mountain recycles
 * laterally into a continuous band instead of sliding off. Modular (period 2·WRAP_LIMIT)
 * so even a large pan lands in-band in one step.
 */
function wrapLateral(x: number): number {
  const period = 2 * WRAP_LIMIT
  return (((x + WRAP_LIMIT) % period) + period) % period - WRAP_LIMIT
}

/** A silhouette point at a mountain's world position: forward is −Z, so depth negates. */
function worldPoint(p: Point2, m: Mountain): Vec3 {
  return [m.x + p[0], p[1], -m.depth]
}

/**
 * The active mountains projected to NDC segments for the shell to stroke — through
 * the rb1 scene substrate (scene.projectWorldSegment: the shared camera + projection PLUS
 * the ROM's POSITH HORIZN lift, since mountains are PLAYFIELD objects). Each silhouette is
 * stitched from its SEGSTR start-points ({@link PFOPOS}, forward) and SMAP** connect-lists
 * ({@link MOUNTAIN_SEGMAPS}): VV draws a line, BV lifts the pen. Behind-eye segments
 * (projectWorldSegment → null) are dropped, never leaked.
 *
 * rb4-8: takes the eye's ALTITUDE only, never its lateral pan. A fallen mountain is a free
 * object whose lateral lives in {@link Mountain.x} (panned + wrapped by {@link stepMountain}),
 * so applying the eye's X here too would DOUBLE-count the pilot's turn. This mirrors
 * groundCollision, which likewise takes `eyeHeight` and reads lateral from `m.x`.
 */
export function mountainSegments(
  mountains: readonly Mountain[],
  attitude: Attitude,
  eyeHeight: number,
  aspect: number,
): readonly SceneSegment[] {
  const active = mountains.filter((m) => m.active)
  if (active.length === 0) return []
  const eye: Vec3 = [0, eyeHeight, 0]
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
          const seg = projectWorldSegment(worldPoint(points[current], m), worldPoint(points[op.point], m), mvp)
          if (seg) out.push(seg)
        }
        current = op.point
      }
    }
  }
  return out
}

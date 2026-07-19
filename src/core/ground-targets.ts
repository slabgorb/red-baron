// src/core/ground-targets.ts
//
// THE GROUND TARGETS (story rb4-11): the deploy machine that decorates the scrolling
// mountains with pyramid / house / tank / pill-box groups during a ground wave, and the
// stroke function that draws a deployed group against its carrying mountain.
//
// THE ROM MACHINE (RBARON.MAC): INITGR arms a ground wave with GRNDCT=2 target-groups and
// GTIMER=1 (:1403-1406). Then, per mountain step in ground mode, with A = the mountain's
// |scroll-band position| (SPABS of the sign-extended 5-bit band, :3417-3425):
//
//     DEC GTIMER            ; the pacing clock ALWAYS decrements          (:3426)
//     BMI 55$               ; expired -> deploy ("PF OBJECT TIME-OUT")    (:3427)
//     CMP I,8 / BCS 60$     ; not expired: deploy only NEAR CENTRE, <8    (:3428-3429)
// 55$: LDA GRNDCT / BEQ 60$ ; no groups left -> nothing (the CALLER's gate, :3430-3431)
//     DEC GRNDCT            ; one group spent                             (:3432)
//     LDA I,1 / STA GTIMER  ; deploy RE-ARMS the clock to 1               (:3448-3449)
//     JSR RANDOM / AND I,3  ; group = random & 3                          (:3450-3451)
//     ... STA AX,PFOBJ+7    ; RANDOM PF OBJECT GROUPS (stored ×3 — a PFOFFS byte index)
//
// Group r deploys THREE targets: slot s gets object number PFOBJN[r][s] (:3924-3927,
// pre-doubled — >>1 is the type) at playfield offset PFOFFS[3r + s] (037007.XXX:1232-1246).
// The stored ×2/×3/6t+4s scalings GRDISP walks (:3582-3591) are ROM byte-storage details;
// this port keeps the LOGICAL group index (the TEA alignment finding, recorded in the
// machine suite's header).
//
// DRAWING (GRDISP, :3562-3650): a decorated mountain's slots are drawn WHILE drawing that
// mountain — each PFOFFS word goes through DDIVIT (the depth divide) into the projection's
// translation before PFPNT0 (the carrier centre) is projected, so the offsets are PRE-divide
// playfield units at the CARRIER's depth, and the carrier is an argument here, never
// implicit state (the blimpSegments/mountainSegments house principle).
//
// PURE and deterministic. No DOM, no time, no randomness — the group roll's random byte is
// drawn by the caller.

import { multiply, type Vec3 } from '@arcade/shared/math3d'
import { flightView, type Attitude } from './camera'
import { projectWorldSegment, sceneProjection, type SceneSegment } from './scene'
import { PFLOB, PFODEC, PFOBJN, PFOFFS, type Point2 } from './topology'
import type { Mountain } from './landscape'

/** INITGR arms the deploy pacing clock at exactly 1 — `LDA I,1 / STA GTIMER` (RBARON.MAC:1405-1406). */
export const GTIMER_INITIAL = 1

/** One deployed ground target: a typed object at its PFOFFS playfield offset. */
export interface GroundTarget {
  /** 0 pyramid | 1 house | 2 tank | 3 pill box — PFOBJN[group][slot] >> 1. */
  readonly type: number
  /** The PFOFFS playfield offset this slot deployed with, relative to the carrier's centre. */
  readonly offset: Point2
}

/**
 * One mountain event of the deploy gate (RBARON.MAC:3426-3429, :3448-3449): DEC GTIMER
 * always; deploy on expiry (BMI) OR near centre (|pos| < 8 — CMP I,8/BCS is a STRICT
 * bound, 8 does not deploy); a deploy re-arms the clock to {@link GTIMER_INITIAL}.
 *
 * `absPos` is the ROM's |scroll-band position| in its own 5-bit band units (SPABS of the
 * sign-extended `AND I,1F` band, :3417-3425) — the mapping from Mountain state to that
 * band is the caller's representation seam (see main.ts). The `GRNDCT > 0` spent-gate
 * (LDA GRNDCT / BEQ, :3430-3431) is likewise the CALLER's, exactly as rb4-7 left
 * groundModeEnds' GRMODE/GREND gates with its caller. An already-negative clock still
 * reads as expired — the ROM's 8-bit DEC keeps a spent wave's clock minus until INITGR
 * re-arms it.
 */
export function deployGate(gtimer: number, absPos: number): { deploy: boolean; gtimer: number } {
  const decremented = gtimer - 1
  if (decremented < 0 || absPos < 8) return { deploy: true, gtimer: GTIMER_INITIAL }
  return { deploy: false, gtimer: decremented }
}

/** The group a random byte selects — `JSR RANDOM / AND I,3` (RBARON.MAC:3450-3451). */
export function groupFromRandom(byte: number): number {
  return byte & 3
}

/**
 * A mountain's |scroll-band position| in the ROM's own 5-bit band units — the value the
 * deploy gate compares against 8. The ROM computes the band from its scroll bytes and
 * applies `AND I,1F / CMP I,10 / ORA I,0F0 ;SIGN EXTEND`, then `JSR SPABS` for the
 * absolute (RBARON.MAC:3417-3425). Our {@link Mountain} stores its lateral in the ROM's
 * stored-X units (landscape.ts: authored lanes ±0x0C00, WRAPIT band ±0x0C01), so the band
 * here is the stored X's MSB under the SAME 5-bit sign-extension idiom: the opening lanes
 * read |4| (the two centre lanes — near centre, immediate deploy) and |12| (the outer
 * pair). This Mountain→band mapping is the REPRESENTATION SEAM the TEA deviation routes to
 * Dev — declared here, in core where a test can reach it, not buried in main.ts.
 */
export function scrollBandAbs(x: number): number {
  const band = (Math.round(x) >> 8) & 0x1f
  return Math.abs(band >= 0x10 ? band - 0x20 : band)
}

/**
 * The three targets group `group` deploys: slot s is type PFOBJN[group][s] >> 1 at offset
 * PFOFFS[3·group + s] (RBARON.MAC:3924-3927 × 037007.XXX:1232-1246). Every group's last
 * slot is the pill box — the ROM invariant every PFOBJN row ends in 6.
 */
export function deployGroup(group: number): readonly GroundTarget[] {
  return PFOBJN[group].map((objectNumber, slot) => ({
    type: objectNumber >> 1,
    offset: PFOFFS[3 * group + slot],
  }))
}

/** A target's model point placed in the world: the carrier's lateral, the PFOFFS offset and
 *  the point in one playfield frame at the CARRIER's depth (GRDISP's DDIVIT arrangement). */
function worldPoint(p: Point2, target: GroundTarget, m: Mountain): Vec3 {
  return [m.x + target.offset[0] + p[0], target.offset[1] + p[1], -m.depth]
}

/**
 * Stroke a deployed group against its carrying mountain — the ONLY function the cockpit
 * draws ground targets with (the blimpSegments/mountainSegments principle: where an object
 * APPEARS cannot sit in main.ts untestable). Each target strokes ITS decode-list
 * ({@link PFODEC}[type]) over ITS point-set ({@link PFLOB}[type]): VV draws, BV moves.
 * The tank's terminal `BV 8 / VV 9` zero-length stroke — its centre DOT — is projected
 * like any other segment, never culled as degenerate. Same substrate as mountainSegments:
 * the eye's ALTITUDE only (a carrier's lateral pan lives in `mountain.x`), the POSITH
 * HORIZN lift via projectWorldSegment, behind-eye segments dropped.
 */
export function groundTargetSegments(
  targets: readonly GroundTarget[],
  mountain: Mountain,
  attitude: Attitude,
  eyeHeight: number,
  aspect: number,
): readonly SceneSegment[] {
  if (targets.length === 0) return []
  const eye: Vec3 = [0, eyeHeight, 0]
  const mvp = multiply(sceneProjection(aspect), flightView(attitude, eye))
  const out: SceneSegment[] = []
  for (const target of targets) {
    const points = PFLOB[target.type]
    const ops = PFODEC[target.type]
    let current = ops[0].point // every decode-list opens with a BV, so no draw precedes this
    for (const op of ops) {
      if (op.draw) {
        const seg = projectWorldSegment(
          worldPoint(points[current], target, mountain),
          worldPoint(points[op.point], target, mountain),
          mvp,
        )
        if (seg) out.push(seg)
      }
      current = op.point
    }
  }
  return out
}

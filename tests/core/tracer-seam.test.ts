// tests/core/tracer-seam.test.ts
//
// Story rb4-1 — RED, round 2. THE SEAM ONE LAYER OUT.
//
// ─── WHAT BROKE, AND WHY NO TEST SAW IT ─────────────────────────────────────────
//
// engagement.test.ts closed the guns->SCORING seam: it fires real shells at a real plane
// and scores the real hit. It was written because every scoring test had been calling
// scoreKill(depth) directly, and so nobody noticed the gun could not reach the plane.
//
// It closed one fork of the data path and left the other open. The player's trigger runs
// into a FORK:
//
//     guns.fire -> guns.step -> collides(shell, enemy)  ->  Hit  ->  scoreKill   [tested]
//                            \
//                             -> main.ts shellSegments  ->  projectSegment -> canvas   [NOT]
//
// Both arms convert between a shell's range-progress `z` and a world depth. They must
// agree — they are describing the same bullet. They no longer do:
//
//     collision arm:  depthToShellZ(depth) = depth / S_DPTH        (guns.ts:178)  -> z x 256
//     render arm:     wd = (shell.z / S_MAXZ) * SHELL_DRAW_FAR     (main.ts:126)  -> z x 32
//
// The rework moved the gun's reach from an invented 800 to the ROM's 6400 and never touched
// SHELL_DRAW_FAR = 800, the hand-copied mirror sitting in main.ts. Measured at a real kill:
// the shell that destroys the plane at depth 4224 is DRAWN at depth 528. An 8x divergence —
// exactly the 6400/800 ratio.
//
// What the player sees: tracers dying in the foreground while a distant plane explodes for
// no visible reason. It makes this story's own headline restoration — "fire on sight, the
// far snipe pays 300" — read as a bug.
//
// SHELL_DRAW_FAR's own doc comment states the invariant it violates:
//     "mirrors guns.ts's internal SHELL_RANGE_DEPTH so a tracer appears at the same depth
//      as the enemy it will hit."
// A comment is not a test. This file is the test.
//
// ─── WHY IT COULD DRIFT: THE PROJECTION LIVES SOMEWHERE UNTESTABLE ──────────────
//
// The root cause is structural, not arithmetic. `shellSegments` is module-private inside
// main.ts, and main.ts touches `document` at module scope — under vitest's node environment
// it cannot be imported at all. So the render arm of that fork has never been reachable by
// a unit test, and a copied constant inside it was free to rot.
//
// A shell's world depth is a PURE function of the shell. It is the exact inverse of the
// `depthToShellZ` that guns.ts already has, and it belongs next to it in core, where both
// arms of the fork can read the SAME function and a test can watch them agree.
//
// ─── ROUND 3: THE FIX WAS REAL AND THE GUARD WAS NOT ────────────────────────────
//
// Dev exported `shellDepth(z) = z * S_DPTH` from core/guns and called it from main.ts. The
// ARITHMETIC was right. The STRUCTURE that produced the bug was untouched: `shellSegments` —
// the call site, the thing that actually decides where the tracer is drawn — still lived in
// main.ts, which cannot be imported under vitest. So the seam was guarded by four REGEXES over
// main.ts's source text, and the Reviewer walked around all four in under a minute:
//
//     const DRAW_REACH = SHELL_RANGE_DEPTH / 8   // arithmetically 800; no literal, no banned name
//     function shellSegments(shell, viewProj) {
//       void shellDepth(0)                       // a dead call, and the /shellDepth\s*\(/ regex passes
//       const wd = (shell.z / S_MAXZ) * DRAW_REACH
//       ...
//     }
//
// => the exact rejected bug, restored, 799/799 green, tsc clean. A regex can only ask what the
// code SAYS. The bug is what the code DOES.
//
// ─── THE CONTRACT (round 3) ─────────────────────────────────────────────────────
//
//   1. `core/guns.ts` exports `shellDepth(z)` = `z * S_DPTH` — the ROM's own arithmetic
//      (PSTSHL `INC AX,SHELLS+5`; S.MAXZ's comment, ";SHELL MAX Z (* 100)"): one z count IS
//      0x100 of depth.
//   2. `core/guns.ts` exports `shellSegments(shell, mvp)` — THE CALL SITE, moved out of main.ts
//      into the module that owns the Shell, where a test can call it. main.ts only calls it.
//
// The four regexes are GONE. What replaces them is not another regex: the tests below fire REAL
// shells at a REAL enemy through fire()/step(), take the Hit the sim reports, run it through the
// REAL shellSegments, and RECOVER THE DEPTH FROM THE PROJECTED GEOMETRY — then assert that the
// depth the bullet is DRAWN at is the depth it KILLED at. The round-2 defeat above scores
// `z * 32` where the kill is at `z * 256`; recovered from its own segment, that reads 528 where
// the plane died at 4224, and it fails. A dead call cannot satisfy a measurement.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { P_INDP, type Enemy } from '../../src/core/enemy'
import { sceneProjection } from '../../src/core/scene'
import {
  fire,
  step as stepGuns,
  collides,
  shellDepth,
  shellSegments,
  INITIAL_GUNS,
  S_MAXZ,
  S_DPTH,
  SHELL_RANGE_DEPTH,
  type Guns,
  type Hit,
  type Shell,
} from '../../src/core/guns'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The frame the cockpit draws into; the shell's own MVP when the pilot is flying level. */
const ASPECT = 16 / 9
const PROJ = sceneProjection(ASPECT)

/** A target parked dead ahead at `depth` — this is a RANGE test, not an aim test. */
function targetAt(depth: number): Enemy {
  // facingAway (rb4-13 D4 mirror): orientation-blind hitbox; settled flight state.
  return { kind: 'lead', x: 0, y: 0, depth, deltaX: 0, bank: 0, side: 1, active: true, facingAway: true }
}

/** Hold the trigger until a shell strikes the target; return the Hit the sim reports. */
function killAt(depth: number, maxFrames = 200): Hit | null {
  const target = targetAt(depth)
  let guns: Guns = INITIAL_GUNS
  for (let f = 0; f < maxFrames; f++) {
    guns = fire(guns, true)
    const { guns: next, hits } = stepGuns(guns, [target])
    guns = next
    if (hits.length > 0) return hits[0]
  }
  return null
}

/**
 * THE MEASUREMENT — the depth a tracer is ACTUALLY DRAWN AT, read back out of the geometry
 * `shellSegments` produced. This is the whole point of the round-3 rework: the question stops
 * being "does main.ts mention the right identifier?" and becomes "where is the light?"
 *
 * Under sceneProjection the perspective divide gives `ndc.x = mvp[0] * x / depth`, so the depth
 * a projected point is at is recoverable exactly: `depth = mvp[0] * x / ndc.x`. It is well-posed
 * because a shell's x is the L/R muzzle offset (±4) and is NEVER zero — a bullet fired from a
 * gun that is offset from the boresight carries its own ruler.
 *
 * `x1` is the segment's FRONT endpoint (projectSegment(front, back, …)) — the shell's nose,
 * which is the point that must sit on the enemy.
 */
function drawnDepthOf(shell: Shell): number {
  const segs = shellSegments(shell, PROJ)
  expect(segs, 'a live shell must produce exactly one tracer streak').toHaveLength(1)
  return (PROJ[0] * shell.x) / segs[0].x1
}

/**
 * How far the drawn depth may sit from the kill depth: ONE Z COUNT.
 *
 * That is not slack, it is the sim's own granularity — `collides` bounds |dz| by WINDOW_Z = 1
 * Z count, so a shell may legitimately register its hit up to one count short of the target,
 * and one count IS S_DPTH of depth. The `+ 1e-9` is float noise only: `drawnDepthOf` recovers
 * the depth through a perspective divide, and several of these land EXACTLY on the boundary,
 * where 256.0000000000001 > 256. It buys nothing else — the 8x divergence this file exists to
 * catch is 3696 units wide.
 */
const ONE_Z_COUNT = S_DPTH + 1e-9

// ─────────────────────────────────────────────────────────────────────────────────
// The conversion itself — one function, so both arms of the fork can share it
// ─────────────────────────────────────────────────────────────────────────────────

describe('a shell knows what depth it is at (guns.shellDepth)', () => {
  it('is the ROM arithmetic: one Z count is one high-byte of depth (S.DPTH)', () => {
    // PSTSHL increments the shell's Z MSB once per sub-step; S.MAXZ's own comment gives the
    // unit out loud — ";SHELL MAX Z (* 100)", and 0x100 = S_DPTH.
    expect(shellDepth(1)).toBe(S_DPTH) // 256
    expect(shellDepth(0)).toBe(0)
    expect(shellDepth(S_MAXZ)).toBe(SHELL_RANGE_DEPTH) // a spent shell is at the gun's reach
  })

  it('is the exact INVERSE of the depth->z map the collision arm uses', () => {
    // Round-trip through the real collision predicate. If these two ever disagree the
    // tracer stops being where the bullet is, which is precisely the shipped bug.
    for (const depth of [0, S_DPTH, 0x400, 0x1000, P_INDP, SHELL_RANGE_DEPTH]) {
      const z = depth / S_DPTH
      expect(shellDepth(z)).toBe(depth)
    }
  })

  it('is NOT the 800-unit mirror main.ts shipped', () => {
    // The exact wrong arithmetic, pinned as a refutation: (z / S_MAXZ) * 800 = z * 32.
    const wrong = (z: number): number => (z / S_MAXZ) * 800
    expect(shellDepth(S_MAXZ)).not.toBe(wrong(S_MAXZ))
    expect(shellDepth(S_MAXZ) / wrong(S_MAXZ)).toBe(8) // the 6400/800 divergence, exactly
  })
})

// ─────────────────────────────────────────────────────────────────────────────────
// THE SEAM: the depth a shell is DRAWN at is the depth it KILLS at
// ─────────────────────────────────────────────────────────────────────────────────

describe('the tracer is DRAWN at the depth the bullet KILLS at (measured, not asserted)', () => {
  it('a shell that kills a plane at its SPAWN depth is drawn out there with it', () => {
    // The headline case. The plane spawns at 4224 and the ROM lets you shoot it there.
    // Before the fix that shell was drawn at 528 — a stub of light in the player's face
    // while the plane exploded 4224 units away.
    const hit = killAt(P_INDP)
    expect(hit, 'the spawn depth is inside the gun reach — engagement.test.ts pins this').not.toBeNull()

    // NOT `shellDepth(z)` — that would only re-check the arithmetic against itself. Read the
    // depth back out of the SEGMENT THE COCKPIT STROKES.
    const drawn = drawnDepthOf(hit!.shell)
    expect(
      Math.abs(drawn - P_INDP),
      `the shell killed the plane at depth ${P_INDP} but its tracer is drawn at ${drawn}. A ` +
        `tracer must appear at the depth of the thing it hits.`,
    ).toBeLessThanOrEqual(ONE_Z_COUNT) // the collision window's own granularity
  })

  it('across the WHOLE reach, the kill depth and the DRAWN depth never diverge', () => {
    // Sweep the gun's entire range, measuring the drawn geometry at every step. This is the
    // assertion that makes the seam impossible to reopen: any future edit to either arm that
    // does not edit the other lands here — including an edit that never names a constant.
    const divergences: string[] = []
    for (let depth = S_DPTH; depth <= SHELL_RANGE_DEPTH; depth += S_DPTH) {
      const hit = killAt(depth)
      if (hit === null) continue // out of reach is engagement.test.ts's business, not ours
      const drawn = drawnDepthOf(hit.shell)
      if (Math.abs(drawn - depth) > ONE_Z_COUNT) {
        divergences.push(`killed at ${depth}, drawn at ${Math.round(drawn)}`)
      }
    }
    expect(divergences).toEqual([])
  })

  it('the DRAWN depth is exactly shellDepth(z) — no scale factor survives anywhere in between', () => {
    // The refutation, stated as a measurement. The round-2 defeat draws at (z / S_MAXZ) * 800 =
    // z * 32 while the gun kills at z * 256 — an 8x divergence that a regex over main.ts could
    // not see and this cannot miss. ANY factor other than 1 lands here, whatever it is called.
    for (let z = 1; z <= S_MAXZ; z++) {
      for (const shell of [
        { x: -4, y: 0, z, gun: 'left', active: true } as Shell,
        { x: 4, y: 0, z, gun: 'right', active: true } as Shell,
      ]) {
        expect(drawnDepthOf(shell), `a shell at z=${z} must be drawn at depth ${shellDepth(z)}`)
          .toBeCloseTo(shellDepth(z), 6)
      }
    }
  })

  it('the drawn depth agrees with the COLLISION predicate, not just with arithmetic', () => {
    // Cross the seam through the real `collides`, so the test cannot pass by both arms
    // being wrong in the same way. A shell drawn at depth D must be a shell that would
    // strike a plane parked at D.
    for (const depth of [S_DPTH, 0x800, 0x1000, P_INDP]) {
      const hit = killAt(depth)
      expect(hit).not.toBeNull()
      const drawnDepth = drawnDepthOf(hit!.shell)
      expect(
        collides(hit!.shell, targetAt(drawnDepth)),
        `a shell drawn at depth ${drawnDepth} must be able to hit a plane AT ${drawnDepth}`,
      ).toBe(true)
    }
  })

  it('the shell is a DOT (VGDOT), not a streak — a single point at the kill depth (rb4-9)', () => {
    // rb4-9 / AC-5: the ROM draws the shell with `JSR VGDOT ;DISPLAY DOT` (RBARON.MAC:5258) — a
    // POINT, not the clone's old trailing streak. Both endpoints coincide. This RETIRES the former
    // "the streak trails the bullet" assertion; what it must NOT lose is the depth-truth the depth
    // tests above pin — a dot drawn at the wrong depth still lands there, so this only fixes the SHAPE.
    const shell: Shell = { x: 4, y: 0, z: 10, gun: 'right', active: true }
    const [seg] = shellSegments(shell, PROJ)
    expect(seg.x1, 'a dot has no trail: x1 === x2').toBe(seg.x2)
    expect(seg.y1, 'a dot has no trail: y1 === y2').toBe(seg.y2)
  })

  it('a shell at the muzzle (z = 0) is not drawn behind the pilot', () => {
    // z = 0 is depth 0 — the eye. Total: whatever it does, it must not produce a NaN or a
    // mirrored ghost segment (scene.ts drops both-endpoints-behind-eye; this is the boundary).
    const segs = shellSegments({ x: -4, y: 0, z: 0, gun: 'left', active: true }, PROJ)
    for (const s of segs) {
      for (const v of [s.x1, s.y1, s.x2, s.y2]) expect(Number.isNaN(v)).toBe(false)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────
// THE WIRING — what is left of it, and why it is no longer the guard
// ─────────────────────────────────────────────────────────────────────────────────
//
// The four source-text regexes that used to live here (SHELL_DRAW_FAR absent, `shellDepth(`
// called, the import present, `\b800\b` absent) are DELETED. They were the whole guard, and
// they were defeatable in a minute, and everything above replaces them with a measurement.
//
// One structural claim survives, and it is a different KIND of claim: not "main.ts says the
// right words" but "main.ts owns no rival". It is worth keeping because the behavioural tests
// above prove `shellSegments` is right, not that the cockpit CALLS it — and main.ts is still
// the one module a test cannot import.
//
// It is not gameable the way the old four were, because it leans on a compiler check rather
// than on a spelling: `tsconfig.json` sets `noUnusedLocals`, so an imported-but-unused
// `shellSegments` is a TYPE ERROR. Import it (asserted) + cannot leave it unused (tsc) +
// cannot declare a second one (asserted) ⇒ the tracer main.ts strokes is the tested one. To
// beat it now you have to deliberately call the real renderer, throw its output away, and
// hand-roll a 4x4 multiply — which is sabotage, not drift, and drift is what ships bugs.

describe('main.ts calls the core tracer — and owns no rival', () => {
  const main = (): string => readFileSync(join(repoRoot, 'src', 'main.ts'), 'utf8')

  it('imports shellSegments from core/guns (and noUnusedLocals means it must USE it)', () => {
    expect(main(), 'main.ts must draw tracers through core/guns.shellSegments').toMatch(
      /import\s*\{[^}]*\bshellSegments\b[^}]*\}\s*from\s*'\.\/core\/guns'/,
    )
  })

  it('declares no shellSegments of its own — the copy IS the bug', () => {
    // A local definition would SHADOW the import and silently take over the draw. This is the
    // exact shape of both HIGH findings: a private copy of something core already owns.
    expect(
      main(),
      'main.ts must not define its own shellSegments — the projection lives in core/guns, ' +
        'beside the z<->depth conversion it has to agree with.',
    ).not.toMatch(/(?:function|const|let)\s+shellSegments\b/)
  })
})

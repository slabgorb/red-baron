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
// ─── THE CONTRACT (the mechanism is Dev's; the property is not) ─────────────────
//
//   1. `src/core/guns.ts` exports `shellDepth(z: number): number` — the world depth of a
//      shell at range-progress z. It is `z * S_DPTH`: the ROM counts a shell's range in the
//      HIGH BYTE of its 16-bit Z (PSTSHL `INC AX,SHELLS+5`; S.MAXZ's comment, ";SHELL MAX Z
//      (* 100)"), so one z count IS 0x100 of depth.
//   2. main.ts's `shellSegments` uses it, and main.ts keeps NO private copy of the reach.
//
// Then the render arm and the collision arm are the same arithmetic BY CONSTRUCTION, and
// this seam cannot open again.

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { P_INDP, type Enemy } from '../../src/core/enemy'
import {
  fire,
  step as stepGuns,
  collides,
  INITIAL_GUNS,
  S_MAXZ,
  S_DPTH,
  SHELL_RANGE_DEPTH,
  type Guns,
  type Hit,
} from '../../src/core/guns'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// `shellDepth` is the export this story owes and does not yet have. Load it the way the
// house does for a RED contract (enemy.test.ts / radix-transcription.test.ts): dynamically,
// behind an optional type, so `tsc --noEmit` stays CLEAN while the assertions fail loudly.
// A RED phase that breaks the typecheck takes Dev's own tooling away while he implements.
interface GunsRedContract {
  /** The world depth of a shell at range-progress `z`. The inverse of depthToShellZ. */
  shellDepth?: (z: number) => number
}
let g: GunsRedContract = {}
beforeAll(async () => {
  g = (await import('../../src/core/guns')) as GunsRedContract
})

/** The contract export, or a failure naming exactly what Dev owes. */
function shellDepth(z: number): number {
  if (g.shellDepth === undefined) {
    throw new Error(
      'src/core/guns.ts must export `shellDepth(z)` — the world depth of a shell at range-' +
        'progress z (= z * S_DPTH). It is the inverse of the private depthToShellZ, and main.ts ' +
        'must render through it instead of keeping its own SHELL_DRAW_FAR copy of the gun reach.',
    )
  }
  return g.shellDepth(z)
}

/** A target parked dead ahead at `depth` — this is a RANGE test, not an aim test. */
function targetAt(depth: number): Enemy {
  return { kind: 'lead', x: 0, y: 0, depth, deltaX: 0, bank: 0, side: 1, active: true }
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

describe('the tracer is drawn where the bullet actually is', () => {
  it('a shell that kills a plane at its SPAWN depth is drawn out there with it', () => {
    // The headline case. The plane spawns at 4224 and the ROM lets you shoot it there.
    // Before the fix that shell was drawn at 528 — a stub of light in the player's face
    // while the plane exploded 4224 units away.
    const hit = killAt(P_INDP)
    expect(hit, 'the spawn depth is inside the gun reach — engagement.test.ts pins this').not.toBeNull()

    const drawn = shellDepth(hit!.shell.z)
    expect(
      Math.abs(drawn - P_INDP),
      `the shell killed the plane at depth ${P_INDP} but is drawn at ${drawn}. A tracer must ` +
        `appear at the depth of the thing it hits — SHELL_DRAW_FAR's own comment says so.`,
    ).toBeLessThanOrEqual(S_DPTH) // one Z count: the collision window's own granularity
  })

  it('across the WHOLE reach, the kill depth and the drawn depth never diverge', () => {
    // Sweep the gun's entire range. This is the assertion that makes the seam impossible to
    // reopen: any future edit to either arm that does not edit the other lands here.
    const divergences: string[] = []
    for (let depth = S_DPTH; depth <= SHELL_RANGE_DEPTH; depth += S_DPTH) {
      const hit = killAt(depth)
      if (hit === null) continue // out of reach is engagement.test.ts's business, not ours
      const drawn = shellDepth(hit.shell.z)
      if (Math.abs(drawn - depth) > S_DPTH) {
        divergences.push(`killed at ${depth}, drawn at ${drawn}`)
      }
    }
    expect(divergences).toEqual([])
  })

  it('the drawn depth agrees with the COLLISION predicate, not just with arithmetic', () => {
    // Cross the seam through the real `collides`, so the test cannot pass by both arms
    // being wrong in the same way. A shell drawn at depth D must be a shell that would
    // strike a plane parked at D.
    for (const depth of [S_DPTH, 0x800, 0x1000, P_INDP]) {
      const hit = killAt(depth)
      expect(hit).not.toBeNull()
      const drawnDepth = shellDepth(hit!.shell.z)
      expect(
        collides(hit!.shell, targetAt(drawnDepth)),
        `a shell drawn at depth ${drawnDepth} must be able to hit a plane AT ${drawnDepth}`,
      ).toBe(true)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────
// THE WIRING: the pure function is worthless if main.ts keeps its own copy
// ─────────────────────────────────────────────────────────────────────────────────
//
// vitest runs environment:'node' and main.ts touches `document` at module scope, so — as
// with tests/blimp-wiring.test.ts, multiplane-wiring, ground-mode-wiring and cockpit-boot —
// the wiring is asserted STRUCTURALLY, against non-gameable symbols.

describe('main.ts reads the shell depth from core — it does not keep a copy', () => {
  const main = (): string => readFileSync(join(repoRoot, 'src', 'main.ts'), 'utf8')

  it('the private SHELL_DRAW_FAR mirror is GONE', () => {
    expect(
      main(),
      'SHELL_DRAW_FAR was a hand-copy of the gun reach, and its comment promised it would ' +
        'track SHELL_RANGE_DEPTH. It did not — because copies do not track anything. Delete it.',
    ).not.toMatch(/SHELL_DRAW_FAR/)
  })

  it('shellSegments projects through the CORE conversion', () => {
    expect(main(), 'main.ts must import the shell-depth conversion from core/guns').toMatch(
      /import\s*\{[^}]*\bshellDepth\b[^}]*\}\s*from\s*'\.\/core\/guns'/,
    )
    expect(main(), 'shellSegments must USE it, not re-derive the depth from a local constant')
      .toMatch(/shellDepth\s*\(/)
  })

  it('the invented 800 does not survive anywhere in main.ts', () => {
    // The number itself, not just the name — so it cannot be reintroduced under an alias.
    expect(main()).not.toMatch(/\b800\b/)
  })
})

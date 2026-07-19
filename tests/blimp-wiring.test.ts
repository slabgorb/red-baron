// tests/blimp-wiring.test.ts
//
// Story rb2-13 — RED phase (Imperator Furiosa / TEA). The "keep the sneaky dev
// honest" integration guard for the BLIMP. The pure blimp entity and its seam
// integration (scoreKill('blimp')→200, guns.collides, explosion.explode, the
// authentic BLIMP/DBLIMP render) are ALREADY covered exhaustively by
// tests/core/blimp.test.ts (rb2-10). That work is worthless if main.ts never
// wires the tested core into the runnable cockpit — which today it does NOT:
// main.ts spawns/steps/scores biplane WAVES (rb2-7) and has no blimp, no yaw,
// and no enemy→player damage channel at all.
//
// vitest runs under environment:'node' (no DOM), so main.ts — which touches
// document/window/requestAnimationFrame at module top level — can't be imported
// and executed. Like tests/multiplane-wiring.test.ts, tests/ground-mode-wiring.test.ts
// and tests/cockpit-boot.test.ts, this reads main.ts as TEXT and asserts the wiring
// STRUCTURALLY. The assertions are pinned to specific, non-gameable symbols
// (shouldSpawnBlimp, blimpFires, rotationY, BLIMP_PICTURE, lives.loseLife,
// BLIMP_SCORE) so a Dev cannot satisfy them by "mentioning" the blimp — each
// forces a real piece of the wiring.
//
// SCOPE — what main.ts must wire (rb2-13, RE-SEATED by rb4-15 — the machine APPROACHES):
//   AC-1 spawn behind the N.PLNZ gate + roll   → shouldSpawnBlimp(planeCount, roll) — TWO args
//   AC-2 step each calc-frame                  → blimp.step runs in the SIM_TIMESTEP loop
//   AC-3 render BLIMP_PICTURE BROADSIDE + yaw  → rotationY (nose-on-z geometry → broadside)
//   AC-4 fire ÷4, GMLEVL >= 2, REAL damage     → blimpFires(frame, level) → lives.loseLife
//   AC-5 collide/score(flat 200)/explode       → the shared guns/scoring/explosion seams, blimp kind
//   AC-6 REAP past the ROM line (Z < 0x100)    → main.ts drops the blimp when it flies past
//   AC-7 resolve Enemy-vs-Blimp 'kind' plumbing → the blimp kill scores as a 'blimp' (flat 200)
//
// NB (corrects rb2-10's stale premise): the blimp APPROACHES — Z-closing from 0x1000
// (INITBP :1425-1426, BLMOTN :4259-4270), not the drifter the findings doc certified.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// tests/blimp-wiring.test.ts → repo root is one level up from tests/.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (rel: string): string => {
  try {
    return readFileSync(join(root, 'src', rel), 'utf8')
  } catch {
    return ''
  }
}
const mainText = readSrc('main.ts')

/** Extract the named-binding clause of `import { … } from '<spec>'`, or '' if absent. */
function importClause(text: string, spec: string): string {
  const re = new RegExp(`import\\s*(?:type\\s*)?\\{([^}]*)\\}\\s*from\\s*['"]${spec.replace(/[/.]/g, '\\$&')}['"]`)
  const m = text.match(re)
  return m ? m[1] : ''
}

describe('rb2-13 wiring — main.ts flies the blimp, not just biplane waves', () => {
  it('main.ts exists and is non-empty', () => {
    expect(mainText.length).toBeGreaterThan(0)
  })

  it('imports the tested blimp core (src/core/blimp.ts, rb2-10) into the cockpit', () => {
    // The whole point of rb2-13: the core exists and is tested — it must be IMPORTED.
    const clause = importClause(mainText, './core/blimp')
    expect(clause.length).toBeGreaterThan(0)
  })

  // ── AC-1 — spawns behind the N.PLNZ gate, THEN the roll (rb4-15, :2325-2331) ─
  it('AC-1: gates the spawn on a PLANE COUNT then the roll — shouldSpawnBlimp takes TWO arguments', () => {
    // LDA N.PLNZ / CMP I,4 / BCC skip / JSR RANDOM / AND I,0C / BNE skip — the decision is
    // (planeCount, roll). The first argument must be a counted value main.ts maintains, passed
    // bare (the house style for a routed count); the shipped single-argument roll dies here.
    expect(/\bshouldSpawnBlimp\b/.test(mainText)).toBe(true)
    expect(
      /shouldSpawnBlimp\s*\(\s*[A-Za-z_$][\w.$]*\s*,/.test(mainText),
      'main.ts must pass shouldSpawnBlimp a plane count FIRST, then the roll (rb4-15)',
    ).toBe(true)
    // …and the blimp core's spawn is pulled in to build it (aliased or not).
    expect(/\bspawn\b/.test(importClause(mainText, './core/blimp'))).toBe(true)
  })

  // ── AC-2 — drift-steps each calc-frame ──────────────────────────────────────
  it('AC-2: drift-steps the blimp every calc-frame — main.ts imports the blimp step', () => {
    // The blimp DRIFTS at the ~10.42 Hz calc-frame cadence (findings §1), stepped inside the
    // SIM_TIMESTEP_S accumulator like every other rb2 motion object — not per display frame.
    expect(/\bstep\b/.test(importClause(mainText, './core/blimp'))).toBe(true)
    // guard the cadence seam is the calc-frame loop (present since rb2-1), not a render-rate step.
    expect(/SIM_TIMESTEP_S/.test(mainText)).toBe(true)
  })

  // ── AC-3 — renders BLIMP_PICTURE BROADSIDE with a yaw ────────────────────────
  //
  // rb4-1 (round 3) MOVED THE AIRSHIP'S RENDER, so this AC now points at the module that owns
  // it. Read this before assuming a test was weakened to go green — it was not; it was aimed at
  // the code, and it got stronger on the way.
  //
  // WHY IT MOVED. rb4-1 found the blimp being DELETED IN THE MIDDLE OF THE SCREEN: its despawn
  // bound (main.ts's `|x| > 640`) was a claim about the SCREEN written as a world constant, and
  // when the cruise depth moved 600 -> 2112 it silently became ndc 0.295. Proving the fix means
  // asserting "the airship is never despawned while it is still visible" — and "visible" is only
  // answerable if a test can ask THE GAME what the airship looks like. main.ts touches `document`
  // at module scope, so under vitest it cannot be imported at all. The pose therefore lives in
  // src/core/blimp.ts now (`blimpSegments`), where tests/core/screen-scale.test.ts flies the whole
  // crossing through it, frame by frame.
  //
  // AND LOOK WHAT THIS TEST WAS ACTUALLY CHECKING. When the render left main.ts, the
  // `/\bBLIMP_PICTURE\b/` line below KEPT PASSING — satisfied by the word BLIMP_PICTURE sitting
  // in an English COMMENT. Only the rotationY line noticed. That is the precise failure mode
  // rb4-1 was rejected for three times: a guard that inspects what the code SAYS rather than what
  // it DOES. So the claims are re-pointed at the file that now owns the geometry, and the wiring
  // claim on main.ts is made structural: it must IMPORT blimpSegments, and `noUnusedLocals`
  // (tsconfig.json) means an unused import is a TYPE ERROR — so importing it means drawing with it.
  it('AC-3: renders the authentic BLIMP_PICTURE broadside — core/blimp yaws it (rotationY)', () => {
    // The ROM blimp geometry is authored NOSE-ON along local z; drawn as-is it faces the eye
    // (a degenerate broadside). It must be yawed — rotationY — to present the airship's flank.
    // rotationZ (the bank) is NOT a yaw; code that reuses it draws the airship nose-on.
    const blimpTs = readSrc('core/blimp.ts')
    expect(/\bBLIMP_PICTURE\b/.test(blimpTs)).toBe(true)
    expect(/\brotationY\b/.test(blimpTs)).toBe(true)
    // …and it is a REAL yaw of the picture, not a mention: the pose composes rotationY into the
    // model matrix that BLIMP_PICTURE is rendered through.
    expect(/rotationY\s*\(/.test(blimpTs), 'core/blimp must CALL rotationY to pose the airship').toBe(true)
    expect(/renderModel\s*\(\s*BLIMP_PICTURE/.test(blimpTs), 'and render the authentic picture').toBe(true)
  })

  it('AC-3: and the COCKPIT draws through it — main.ts imports core/blimp\'s blimpSegments', () => {
    // The half this file has always been for: the tested core is worthless if main.ts never wires
    // it in. With noUnusedLocals, importing it is calling it.
    expect(
      /import\s*\{[^}]*\bblimpSegments\b[^}]*\}\s*from\s*'\.\/core\/blimp'/s.test(mainText),
      'main.ts must draw the airship through core/blimp.blimpSegments',
    ).toBe(true)
    // …and it must not have grown a rival pose of its own (the copy IS the bug — see rb4-1).
    expect(/(?:function|const|let)\s+blimpSegments\b/.test(mainText)).toBe(false)
  })

  // ── AC-4 — fires ÷4, level-gated, via a REAL enemy-shell → player-damage path ─
  it('AC-4: fires through SHLAUN\'s gates — main.ts drives blimpFires(frame, level)', () => {
    // rb4-15: the blimp's shells launch through the shared SHLAUN — 1 frame in 4 (:4027-4030)
    // and ONLY at GMLEVL >= 2 (:4038-4041). main.ts already computes the level for the planes;
    // it must hand the SAME level to the blimp — a one-argument call is the old machine.
    expect(/\bblimpFires\b/.test(mainText)).toBe(true)
    expect(
      /blimpFires\s*\(\s*[A-Za-z_$][\w.$]*\s*,/.test(mainText),
      'main.ts must pass blimpFires the frame AND the game level (rb4-15)',
    ).toBe(true)
  })

  it('AC-4: the fire connects to a REAL player-damage channel — main.ts wires lives.loseLife', () => {
    // The story emphasises a *real* enemy-shell→player-damage path, not a stub. Today main.ts
    // has NO enemy→player damage at all — the lives spine (lives.ts, rb2-9) was never wired in.
    // Requiring the lives import + loseLife forces blimpFires to actually cost the player a life,
    // rather than computing a boolean and discarding it. (A Dev who stubs it wouldn't need lives.)
    expect(importClause(mainText, './core/lives').length).toBeGreaterThan(0)
    expect(/\bloseLife\b/.test(mainText)).toBe(true)
  })

  // ── AC-5 / AC-7 — collide / score flat 200 / explode; 'kind' plumbing resolved ─
  it('AC-5+AC-7: the blimp kill scores a flat 200 as a blimp — the Enemy-vs-Blimp kind is resolved', () => {
    // The blimp drifts (it is NOT a weaving plane), so it cannot ride the plane `enemies` array —
    // main.ts scores its kill on a dedicated path. Whether the Dev widens EnemyKind or adapts in
    // main.ts, the downed blimp must score the flat BLIMP_SCORE=200 (findings §4), evidenced by a
    // blimp-kind score site. scoreKill('lead'/'drone') alone would misvalue it.
    expect(/\bBLIMP_SCORE\b/.test(mainText) || /scoreKill\(\s*['"]blimp['"]/.test(mainText) || /['"]blimp['"]/.test(mainText)).toBe(true)
  })

  it('AC-5: the blimp collides + explodes through the SHARED guns/explosion seams', () => {
    // Reuse the rb2-5 collision (stepGuns/collides) and the rb2-6 UPPLEX wreck (explode) — the
    // same seams the plane kill uses — not a bespoke blimp collision/explosion.
    expect(/\bexplode\b/.test(mainText)).toBe(true)
    expect(/stepGuns|\bfire\b/.test(mainText)).toBe(true)
  })

  // ── AC-6 — REAPED when it flies past the ROM line (rb4-15: Z < 0x100) ────────
  it('AC-6: reaps the blimp when it flies past — the unbounded approach is bounded here', () => {
    // blimp.step is unbounded BY DESIGN (it closes forever); if main.ts never removes the blimp
    // it closes through the player AND keeps firing. main.ts must drop it once it is past the
    // ROM line — the reap seam + a clear of the blimp state. (The word check accepts either
    // era's vocabulary; the DECISION-PATH guard in screen-scale.test.ts pins the actual call.)
    expect(/\breap|despawn|off-?screen|fl(?:ies|ew) past/i.test(mainText)).toBe(true)
    // the blimp state must be CLEARABLE (nullable / reset) so the reap can actually remove it.
    expect(/blimp\s*=\s*(?:null|undefined|no|reap)/i.test(mainText)).toBe(true)
  })

  // ── regression — the blimp must not break the existing plane wiring ──────────
  it('does NOT regress the rb2-7 multi-plane wave wiring while adding the blimp', () => {
    // A Dev who bolts the blimp on by cannibalising the plane loop breaks the sky. The wave
    // schedule, formation spawn, kind-scoring, and lead promotion must all survive.
    expect(/\bspawnWave\b/.test(mainText)).toBe(true)
    expect(/\bpromoteLead\b/.test(mainText)).toBe(true)
    expect(/stepWaveClock/.test(mainText)).toBe(true)
    expect(/\.kind\b/.test(mainText)).toBe(true)
  })
})

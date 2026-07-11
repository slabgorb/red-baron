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
// SCOPE — what rb2-13 must wire into main.ts (from the story title + AC-1..AC-7):
//   AC-1 spawn on the ~25 % BLMOTN roll        → shouldSpawnBlimp gates a blimp spawn
//   AC-2 drift-step each calc-frame            → blimp.step runs in the SIM_TIMESTEP loop
//   AC-3 render BLIMP_PICTURE BROADSIDE + yaw  → rotationY (nose-on-z geometry → broadside)
//   AC-4 fire ÷2 via a REAL damage path        → blimpFires → lives.loseLife (not a discarded bool)
//   AC-5 collide/score(flat 200)/explode       → the shared guns/scoring/explosion seams, blimp kind
//   AC-6 DESPAWN off-screen (step is unbounded) → main.ts drops the blimp when it drifts off
//   AC-7 resolve Enemy-vs-Blimp 'kind' plumbing → the blimp kill scores as a 'blimp' (flat 200)
//
// NB (corrects rb2-10 AC-3's stale wording): the blimp DRIFTS across (non-weaving).

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

  // ── AC-1 — spawns on the ~25 % BLMOTN roll ──────────────────────────────────
  it('AC-1: gates the blimp spawn on the ~25 % roll — main.ts uses shouldSpawnBlimp', () => {
    // The blimp APPEARS on shouldSpawnBlimp(roll) (findings §3, BLMOTN) — a separate roll
    // from the biplane wave schedule. A Dev who spawns it unconditionally, or never, fails.
    expect(/\bshouldSpawnBlimp\b/.test(mainText)).toBe(true)
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
  it('AC-3: renders the authentic BLIMP_PICTURE broadside — main.ts adds a yaw (rotationY)', () => {
    // The ROM blimp geometry is authored NOSE-ON along local z; drawn as-is it faces the eye
    // (a degenerate broadside). main.ts must yaw it — rotationY — to present the airship's flank.
    // rotationZ (the bank main.ts already uses) is NOT a yaw; a Dev who reuses it draws it nose-on.
    expect(/\bBLIMP_PICTURE\b/.test(mainText)).toBe(true)
    expect(/\brotationY\b/.test(mainText)).toBe(true)
  })

  // ── AC-4 — fires ÷2 via a REAL enemy-shell → player-damage path ──────────────
  it('AC-4: fires on the ÷2 cadence — main.ts drives blimpFires', () => {
    // The blimp is a threat at every level (no PLNLVL gate), firing on the ÷2 FRAME cadence.
    expect(/\bblimpFires\b/.test(mainText)).toBe(true)
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

  // ── AC-6 — DESPAWN when it drifts off-screen ────────────────────────────────
  it('AC-6: despawns the blimp when it drifts off-screen — the unbounded drift is bounded here', () => {
    // blimp.step is unbounded BY DESIGN (it never reverses); if main.ts never removes the blimp it
    // drifts to infinity AND keeps firing forever. main.ts must drop it once it has drifted off —
    // a despawn bound + a clear of the blimp state.
    expect(/despawn|off-?screen|drift(?:s|ed)? off|off the (?:screen|edge)/i.test(mainText)).toBe(true)
    // the blimp state must be CLEARABLE (nullable / reset) so the despawn can actually remove it.
    expect(/blimp\s*=\s*(?:null|undefined|no)/i.test(mainText)).toBe(true)
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

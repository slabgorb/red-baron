// tests/lod-orientation-wiring.test.ts
//
// Story rb4-13 — RED phase (Furiosa / TEA). The "keep the sneaky dev honest" guard
// for the orientation switch: retiring LOD_DISTANCE from biplane.ts is worthless if
// a CALL SITE re-derives it — `biplaneLOD(enemy.depth >= 1732)` is the same invented
// rule wearing the new signature. The rule the ROM ships (DRNPIC, RBARON.MAC:4961-
// 4970, `.RADIX 16` set at :74: `LDA PLSTAT+6 / AND I,10`) keys on the ORIENTATION
// BIT carried in the plane's own status — so the model-choice call sites must feed
// the bit, and NONE may feed a depth.
//
// (The bit itself cannot be depth-derived either: tests/core/enemy.test.ts pins its
// lifecycle DEPTH-ANTICORRELATED — a plane spawns toward-facing at the DEEP end and
// stays away-facing at the shallow floor — so `facingAway = deep` dies there. This
// file only has to stop the syntactic relocation.)
//
// REWORK (rb4-13 review, HIGH): the guards below match COMMENT-STRIPPED text. The
// first cut matched raw file text, and a doc comment in main.ts happened to contain
// the literal `biplaneLOD(enemy.facingAway)` — so an aliased depth-threshold call
// passed the guard on the strength of PROSE (mutation-proven by the review's
// test-analyzer). A guard that a comment can satisfy is scenery; strip the comments
// and make the CODE answer.
//
// vitest runs under environment:'node' (no DOM) — main.ts is read as TEXT and the
// wiring asserted structurally, the multiplane-wiring.test.ts house pattern.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// tests/lod-orientation-wiring.test.ts → repo root is one level up from tests/.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string): string => {
  try {
    return readFileSync(join(root, rel), 'utf8')
  } catch {
    return ''
  }
}

/**
 * Drop `/*…*​/` spans and `//…` line tails so ONLY CODE can satisfy (or trip) a
 * guard. Good enough for this repo's sources: no template literals or string
 * constants here legitimately contain `//` followed by the guarded tokens.
 */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const mainText = stripComments(read('src/main.ts'))
const wreckText = stripComments(read('src/core/wreck-render.ts'))

describe('rb4-13 wiring — the model choice is fed the D4 bit, never a depth', () => {
  it('main.ts and wreck-render.ts exist and are non-empty', () => {
    expect(mainText.length).toBeGreaterThan(0)
    expect(wreckText.length).toBeGreaterThan(0)
  })

  it('main.ts picks the enemy model by the orientation bit — in CODE, not in a comment', () => {
    expect(
      /biplaneLOD\(\s*enemy\.facingAway\s*\)/.test(mainText),
      'the cockpit must draw each enemy through biplaneLOD(enemy.facingAway) — the PLSTAT+6 ' +
        'D4 mirror the sim maintains — exactly as DRNPIC reads PLSTAT+6. (Comments are ' +
        'stripped before this match: prose cannot satisfy the guard.)',
    ).toBe(true)
  })

  it('wreck-render.ts picks the falling-wreck model by the bit it died wearing — in CODE', () => {
    expect(
      /biplaneLOD\(\s*wreck\.facingAway\s*\)/.test(wreckText),
      'the falling wreck must draw through biplaneLOD(wreck.facingAway) — the bit explode() ' +
        'captured at the kill. (Comment-stripped; the symmetric guard to main.ts\'s.)',
    ).toBe(true)
  })

  it('NO call site feeds a depth into the model choice — the depth rule must die, not relocate', () => {
    // Catches both the old call (`biplaneLOD(enemy.depth)`) and the relocated rule
    // (`biplaneLOD(wreck.depth >= …)`): any biplaneLOD argument that mentions a depth
    // is the retired invention coming back through a side door.
    expect(
      /biplaneLOD\s*\([^)]*depth/i.test(mainText),
      'main.ts feeds a depth into biplaneLOD — the ROM has no such test anywhere in its picture path.',
    ).toBe(false)
    expect(
      /biplaneLOD\s*\([^)]*depth/i.test(wreckText),
      'wreck-render.ts feeds a depth into biplaneLOD — a wreck keeps an orientation, not a threshold.',
    ).toBe(false)
  })
})

// tests/core/events-have-producers.test.ts
//
// Story rb4-4 — RED phase (TEA). AC-6: NO EVENT MAY BE DECLARED-AND-CONSUMED BUT
// NEVER EMITTED. Red Baron shipped `score-tick` and `bonus-life` declared in
// core/events.ts and wired to POKEY tones in shell/audio-dispatch.ts — with NO
// producer anywhere in src/. Three of the five reward tones (TK, TP, BN) could
// never play. The `never`-guard on the dispatch switch catches a MISSING consumer;
// nothing catches a missing PRODUCER. This suite is that other half.
//
// HOW IT SCANS: a variant's declaration is `readonly type: '<name>'` in
// core/events.ts; a PRODUCER is an object literal `type: '<name>'` anywhere else
// in src/ (the house event idiom — events are pushed as literals, e.g.
// `events.push({ type: 'player-hit' })`). The consumer switch uses `case '<name>':`
// so it can never satisfy the scan. If a future producer builds events some other
// way, this file is WHERE the convention is written down — extend the scan, don't
// delete the guard.
//
// THE GUARD MUST HAVE TEETH (the sweep lesson in core-audio-free.test.ts, and the
// epic's own "a guard must be mutation-tested or it is scenery"): the meta-tests
// below prove the scanner sees the declarations AND the producers that exist
// today, so an empty directory listing or a broken regex fails loudly instead of
// passing vacuously.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..', '..', 'src')
const EVENTS_FILE = join(SRC, 'core', 'events.ts')

/** Every .ts file under src/, recursively. */
function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...tsFiles(path))
    else if (name.endsWith('.ts')) out.push(path)
  }
  return out
}

/** The declared GameEvent discriminants: `readonly type: '<name>'` in events.ts. */
function declaredVariants(): string[] {
  const source = readFileSync(EVENTS_FILE, 'utf8')
  return [...source.matchAll(/readonly type: '([a-z-]+)'/g)].map((m) => m[1])
}

/** Files that PRODUCE the variant: `type: '<name>'` outside the declaration file. */
function producersOf(variant: string): string[] {
  return tsFiles(SRC)
    .filter((f) => f !== EVENTS_FILE)
    .filter((f) => new RegExp(`type: '${variant}'`).test(readFileSync(f, 'utf8')))
}

describe('the scanner has teeth (meta — a vacuous sweep is scenery)', () => {
  it('finds the declarations: events.ts declares at least the five shipped variants', () => {
    const variants = declaredVariants()
    expect(variants.length).toBeGreaterThanOrEqual(5)
    expect(variants).toContain('enemy-destroyed')
    expect(variants).toContain('player-hit')
    expect(variants).toContain('wave-incoming')
    expect(variants).toContain('score-tick')
    expect(variants).toContain('bonus-life')
  })

  it('finds real producers: the wired variants scan to at least one producing file today', () => {
    expect(producersOf('enemy-destroyed').length).toBeGreaterThan(0)
    expect(producersOf('player-hit').length).toBeGreaterThan(0)
    expect(producersOf('wave-incoming').length).toBeGreaterThan(0)
  })

  it('rejects a variant nobody produces (the guard bites on a fabricated name)', () => {
    expect(producersOf('no-such-event-variant')).toHaveLength(0)
  })
})

describe('AC-6: every declared GameEvent variant has at least one producer in src/', () => {
  // RED today on exactly the two dead wires: 'score-tick' (TK/TP) and 'bonus-life'
  // (BN) are declared (events.ts:44-52), consumed (audio-dispatch.ts:58-62), and
  // emitted by NOTHING. Dev's producers (the SCOREM count-up and the BONUSL award)
  // turn this green — see tests/core/score-countup.test.ts for their contract.
  it.each(declaredVariants())("'%s' is emitted somewhere in src/", (variant) => {
    const producers = producersOf(variant)
    expect(
      producers.length,
      `GameEvent '${variant}' is declared in core/events.ts and consumed by the audio ` +
        `dispatch, but NO file in src/ ever emits it — the sound it maps to can never play. ` +
        `Emit it from the sim (an object literal \`{ type: '${variant}', ... }\`).`,
    ).toBeGreaterThan(0)
  })
})

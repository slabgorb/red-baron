// tests/hud-font-source.test.ts
//
// Story rb4-19 — RED phase (Furiosa / TEA). "Wrong font": red-baron's on-screen
// HUD readout (GUNS HOT / SCORE / PLANE / GAME OVER) is drawn with the BROWSER
// system font — `ctx.font = 'bold NNpx monospace'` + `ctx.fillText(...)` — instead
// of the shared ROM vector glyph font at @arcade/shared/font (v0.15.0, already
// pinned). main.ts:298 even left the note: "…until the ROM HUD glyph font arrives
// in a later story." This is that story.
//
// These are STATIC source invariants. They exist because two of the four HUD
// strings are UNREACHABLE by a passive boot-and-drive harness:
//   • GUNS HOT — drawn only while `overheated` (needs the pilot to hold fire long
//     enough to lock the guns out).
//   • GAME OVER — drawn only while `gameOver` (needs the pilot to die).
// The companion runtime suite (hud-font-adoption.test.ts) proves the REACHABLE
// SCORE + PLANE lines route through the shared font on the live draw path; these
// source checks catch the two the loop can't reach, and pin AC-1's literal wording
// ("No `ctx.font = '...monospace'` assignment remains for HUD text").
//
// The checks are scoped to the GAME source (src/, excluding src/tools/ — the
// contactSheet dev tool legitimately uses a monospace label font and never ships).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const srcDir = fileURLToPath(new URL('../src', import.meta.url))
const mainPath = fileURLToPath(new URL('../src/main.ts', import.meta.url))

/** Every game .ts file under src/ — EXCLUDING src/tools/ (dev tooling, never shipped). */
function gameSrcFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = `${dir}/${entry}`
    if (statSync(p).isDirectory()) {
      if (entry === 'tools') continue // contactSheet.ts uses a monospace LABEL_FONT — out of scope
      out.push(...gameSrcFiles(p))
    } else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

function importsSubpath(subpath: string): string[] {
  const re = new RegExp(`['"]${subpath.replace(/\//g, '\\/')}['"]`)
  return gameSrcFiles(srcDir)
    .filter((f) => re.test(readFileSync(f, 'utf8')))
    .map((f) => f.slice(srcDir.length + 1))
}

// A canvas-font text draw of one of the two loop-unreachable HUD strings.
const HARD_HUD_VIA_CANVAS_FONT = /(?:fillText|strokeText)\s*\(\s*[`'"](?:GUNS HOT|GAME OVER)/
// Any canvas-font text draw at all (main.ts's ONLY text is the HUD readout).
const ANY_CANVAS_TEXT = /\b(?:fillText|strokeText)\s*\(/

describe('rb4-19 AC-1 — main.ts stops drawing HUD text with the browser system font', () => {
  it('sets no `monospace` canvas font in main.ts', () => {
    const main = readFileSync(mainPath, 'utf8')
    expect(
      main.includes('monospace'),
      'main.ts still sets a `monospace` ctx.font for the HUD — it must route through @arcade/shared/font',
    ).toBe(false)
  })

  it('makes no `ctx.fillText`/`ctx.strokeText` call in main.ts (the HUD was its only text)', () => {
    const main = readFileSync(mainPath, 'utf8')
    const hits = main.match(new RegExp(ANY_CANVAS_TEXT, 'g')) ?? []
    expect(
      hits,
      `main.ts still draws text through the canvas font (${hits.length} fillText/strokeText call(s)) — ` +
        'the HUD readout must be stroked as @arcade/shared/font vector glyphs instead',
    ).toHaveLength(0)
  })
})

describe('rb4-19 AC-1 — the loop-unreachable HUD strings migrate too (GUNS HOT / GAME OVER)', () => {
  it('no game src file draws GUNS HOT or GAME OVER via the canvas font', () => {
    const offenders = gameSrcFiles(srcDir)
      .filter((f) => HARD_HUD_VIA_CANVAS_FONT.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(srcDir.length + 1))
    expect(
      offenders,
      `these src files still draw GUNS HOT / GAME OVER with ctx.fillText/strokeText: ${offenders.join(', ')}`,
    ).toHaveLength(0)
  })

  it('no game src file (outside tools/) sets a monospace canvas font', () => {
    const offenders = gameSrcFiles(srcDir)
      .filter((f) => readFileSync(f, 'utf8').includes('monospace'))
      .map((f) => f.slice(srcDir.length + 1))
    expect(
      offenders,
      `these src files still set a monospace ctx.font: ${offenders.join(', ')}`,
    ).toHaveLength(0)
  })
})

describe('rb4-19 AC-1 / AC-2 — the shared-font wiring is adopted, the overlay is left intact', () => {
  it('a game src module imports @arcade/shared/font (the HUD glyph subpath is wired)', () => {
    expect(
      importsSubpath('@arcade/shared/font'),
      'no src file imports @arcade/shared/font — the HUD is not routed through the shared glyph font',
    ).not.toHaveLength(0)
  })

  it('a game src module STILL imports @arcade/shared/esc-overlay (AC-2: overlay unchanged)', () => {
    // Regression guard: the HUD migration must NOT rip out the already-correct
    // pause/ESC overlay path (which strokes the shared font transitively).
    expect(
      importsSubpath('@arcade/shared/esc-overlay'),
      'the pause/ESC overlay import vanished — AC-2 says this story leaves the overlay path untouched',
    ).not.toHaveLength(0)
  })
})

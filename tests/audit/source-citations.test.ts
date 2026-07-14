// tests/audit/source-citations.test.ts
//
// Story rb4-2 — RETRACT THE POISONED DOC.
//
// `docs/red-baron-1980-source-findings.md` is the authority chain for every Red Baron
// story. It was written against the WRONG COPY of the Atari source and it sourced its
// enemy facts to a build that never shipped. This suite is the gate that stops both,
// permanently.
//
// ─── THE TWO DEFECTS, AND WHY THEY LOOK LIKE ONE ─────────────────────────────────────
//
// 1. THE WRONG COPY. Two checkouts of the quarry exist and they DISAGREE ABOUT LINE
//    NUMBERS. The citable one (`red-baron-source-text`) is LF-only. Its CRLF sibling
//    glues each form-feed page break (`\x0c`) onto the following `.SBTTL` line, so it
//    is EIGHT LINES SHORT — and the shortfall accrues in a STAIRCASE:
//
//        citable line = sibling line + 0   for sibling lines    1- 263
//                                    + 1                      265- 724
//                                    + 2                      726-1654   … rising to
//                                    + 8                     5963-6285
//
//    So a citation copied from the sibling is off by ONE near the top of the file and
//    by EIGHT near the bottom. There is NO constant offset that repairs them, and a
//    citation that is "only" off by one still points at the wrong line.
//    This is why `CALCNT` reads as :620 (sibling) when it is really :621 (citable).
//
// 2. THE DECOY BUILD. `R2BRON.MAC` is byte-identical to `RBARON.MAC` except for SEVEN
//    lines — and every one of them is a ROM self-test CHECKSUM byte. That is exactly
//    what makes it lethal: cite `R2BRON.MAC:NNNN` and you get the right text at the
//    right line, so the citation "verifies". The poison is not in R2BRON at all — it is
//    in `R2GRND.MAC`, the ground module R2BRON's load map LINKS, which differs from the
//    shipped `RBGRND.MAC` in exactly TWO lines:
//
//        RBGRND:61   FRMECNT=4     R2GRND:61   FRMECNT=5     (62.5 Hz vs 50 Hz)
//        RBGRND:197  CMP I,3       R2GRND:197  CMP I,40      (watchdog: 3 vs 0x40 = 64)
//
//    The doc's own header declares the two builds differ in "one substantive value" —
//    and then imports the OTHER one, claiming the watchdog trips at `CALFLG >= 0x40`.
//    It is off by 21x, and it came from the build that never shipped.
//
// ─── HOW THIS SUITE IS BUILT (and why it is built that way) ──────────────────────────
//
// Every ROM fact lives ONCE, in the `ROM` object below. Two gates hold it down:
//
//   1. `the byte-of-record` re-derives all of it from the real Atari source. So no number
//      here is a number a human typed — it is one the ROM agreed to. The source is
//      copyrighted and stays out of this repo, so this group SKIPS in CI.
//
//   2. Everything else asserts the DOC and `src/` against `ROM`, needs no quarry, and
//      therefore runs on EVERY PUSH.
//
// The first draft of this file collapsed those two jobs into one and paid for it twice
// (both caught by the Reviewer, by MUTATION rather than by reading):
//
//   * `expect(header).toContain(String(diff.length))` — i.e. `toContain('7')` — was
//     satisfied by `037007.XXX` sitting in the header. A doc claiming the builds differ
//     in NINE lines passed 25/25. The guard on the story's headline number was scenery.
//     Numbers are now matched to their CLAIM (`\b7\s+lines\b`), never merely "present".
//
//   * 20 of 25 tests sat inside `skipIf(!sourceAvailable)` — including pure greps that
//     never needed the source at all. In CI the doc could revert the watchdog to 0x40,
//     restore every stale line number, and re-assert the distance LOD, all on green.
//     A recurrence guard that only runs on one laptop does not guard the recurrence.
//
// Two rules follow, and they are the ones to keep:
//   — Assert a claim WHERE IT IS MADE. Scope to the trap header / the retraction blockquote;
//     a stray `D4` in the sound section must not be able to vouch for the LOD section.
//   — Ban the CLAIM, not the PHRASE. `/distance LOD/i` blocks two words; "level of detail
//     by depth" says the same false thing and walks straight through.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SOURCE_DIR = process.env.RED_BARON_SOURCE_DIR ?? '/Users/slabgorb/Projects/red-baron-source-text'
const sourceAvailable = existsSync(SOURCE_DIR)

const DOC_PATH = join(repoRoot, 'docs', 'red-baron-1980-source-findings.md')
const doc = () => readFileSync(DOC_PATH, 'utf8')

/**
 * Read a quarry file into lines under UNIVERSAL newlines. The two checkouts differ in
 * their line terminators, so the split must treat CRLF, CR and LF alike — otherwise the
 * line numbers this suite derives would themselves depend on which copy is present, and
 * the gate would be measuring with the ruler it is trying to check.
 */
function sourceLines(file: string): string[] {
  return readFileSync(join(SOURCE_DIR, file), 'latin1').split(/\r\n|\r|\n/)
}

/** 1-based, the way a citation reads. */
const at = (lines: readonly string[], n: number) => lines[n - 1]

/** Every `.ts` under src/, as [repo-relative path, contents]. */
function srcFiles(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry)
      if (statSync(p).isDirectory()) walk(p)
      else if (entry.endsWith('.ts')) out.push([relative(repoRoot, p), readFileSync(p, 'utf8')])
    }
  }
  walk(join(repoRoot, 'src'))
  return out
}

/**
 * A citation: a quarry module and the line(s) it points at.
 *
 * CASE-INSENSITIVE on purpose (Reviewer, rb4-2). Uppercase-only, a decoy citation written
 * `r2bron.mac:100` walks straight through the only two gates that run in CI.
 */
const CITATION = /\b([A-Z0-9]{3,8}\.(?:MAC|MAP|XXX|COM))\s*:\s*(\d+)(?:\s*-\s*(\d+))?/gi

/** The build that actually shipped — RBARON.COM's link list, plus the picture/char ROMs. */
const SHIPPED = [
  'RBARON.MAC', 'RBGRND.MAC', 'RBSOUN.MAC', 'RBCOIN.MAC', 'RBINT.MAC', 'RBROM.MAC',
  'VGUT.MAC', 'TCN65.MAC', 'VGMC.MAC', 'VGAN.MAC', 'STATE2.MAC',
  '037007.XXX', '037006.XXX', 'RBARON.MAP', 'RBARON.COM',
]
const isShipped = (m: string) => SHIPPED.includes(m.toUpperCase())
const isDecoyModule = (m: string) => /^R2(BRON|GRND)\./i.test(m)

/**
 * The decoy, by name.
 *
 * TWO regexes on purpose, and they must stay two (Reviewer, rb4-2 round 2). A `/g` regex
 * carries a mutable `lastIndex`, and `.test()` RESUMES FROM IT — so calling `.test()` over a
 * list of files returns true, false, true for three files that all name the decoy. The gate
 * that stops the decoy creeping back into src/ was therefore correct only by accident of
 * directory order: two adjacent offending files and one walks straight through.
 *
 * `matchAll` REQUIRES `/g` (and clones internally, so it is safe). `.test()` must NOT have it.
 */
const DECOY_NAME_G = /R2BRON|R2GRND/gi
const namesDecoy = (text: string) => /R2BRON|R2GRND/i.test(text)

/**
 * ─── THE ROM, AS FACTS ───────────────────────────────────────────────────────────────
 *
 * Every number the doc is allowed to state about the ROM lives here ONCE.
 *
 * Two gates hold it in place, and you need BOTH, because each covers the other's blind spot:
 *
 *   1. `the byte-of-record` group below re-derives every one of these from the actual Atari
 *      source and fails if a single one is wrong. So these are not numbers somebody typed —
 *      they are numbers the ROM agreed to. That group needs the quarry, so it runs on a
 *      developer's machine and SKIPS in CI (the source is copyrighted; it is not in this repo).
 *
 *   2. Every doc-side and src-side group asserts the DOC against these constants, and needs no
 *      quarry at all. So it runs on EVERY PUSH.
 *
 * That split is deliberate and it is the point (Reviewer, rb4-2). Before it, the doc-side checks
 * sat inside the source-gated blocks purely because they had a source-derived sibling — so 20 of
 * 25 tests skipped in CI, and the doc could have reverted the watchdog to 0x40, restored every
 * stale line number, and re-asserted the distance LOD on a green build. The recurrence guard is
 * the entire justification for this story; it has to run where the regressions actually land.
 */
const ROM = {
  /** RBARON.MAC, counted with universal newlines, in the LF byte-of-record. */
  rbaronLines: 6294,
  /** The only three `.RADIX` directives in the file. */
  radixSwitches: [74, 6217, 6281],
  /** The lone decimal island: the vertex/POINTP tables. */
  island: { from: 6217, to: 6280 },
  /** Symbol definition lines (RBARON.MAC) — and the stale line the CRLF sibling reports. */
  defs: {
    CALCNT: { line: 621, stale: 620, text: 'CALCNT\t=18' },
    BNRCNT: { line: 622, stale: 621 },
    MAIN: { line: 763, stale: 761 },
    SHLAUN: { line: 4027, stale: 4022 },
  },
  /** `INC FRAME`, the game-logic frame tick. */
  incFrame: { line: 870, stale: 868 },
  /** RBARON vs R2BRON: this many lines differ, and every one is a checksum byte. */
  decoyDiffCount: 7,
  /** RBGRND vs R2GRND: exactly these lines — the frame divider, and the watchdog. */
  groundDiffLines: [61, 197],
  /** RBGRND.MAC:197 — `CMP I,3`. The decoy says `CMP I,40` (= 0x40 = 64). Off by 21x. */
  watchdog: 3,
  /** DRNPIC: the plane model is selected on PLSTAT+6 bit 0x10 — orientation, NOT distance. */
  drnpic: { line: 4961, bit: '0x10' },
} as const

/** Lines (1-based) at which two same-length files disagree. */
function differingLines(a: readonly string[], b: readonly string[]): number[] {
  const n = Math.max(a.length, b.length)
  const out: number[] = []
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) out.push(i + 1)
  return out
}


/** The doc's delimited decoy warning. Scoped, so a stray mention elsewhere cannot satisfy it. */
function trapHeader(): string {
  const text = doc()
  const start = text.indexOf('<!-- decoy-trap:start -->')
  const end = text.indexOf('<!-- decoy-trap:end -->')
  return start >= 0 && end > start ? text.slice(start, end) : ''
}

/**
 * The §7 retraction blockquote, and nothing else.
 *
 * Scoped for the same reason `trapHeader()` is (Reviewer, rb4-2): asserting "the doc mentions D4"
 * against the WHOLE doc passed even with the retraction gutted, because §6's unrelated
 * "**D4-D7** explosion level" satisfied it. A claim must be proven where it is made.
 */
function lodRetraction(): string {
  const lines = doc().split('\n')
  const i = lines.findIndex((l) => l.includes('RETRACTED (rb4-2)'))
  if (i < 0) return ''
  const out: string[] = []
  for (let j = i; j < lines.length && lines[j].startsWith('>'); j++) out.push(lines[j])
  return out.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────────────
// GATE 1 — the ROM constants above are the ROM's, not a human's.
//
// Needs the quarry, so it SKIPS in CI. Everything below this group is enforced against
// `ROM` unconditionally, so the doc is guarded on every push regardless.
// ─────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!sourceAvailable)('the byte-of-record — every ROM constant re-derived from source', () => {
  it('the quarry is the CITABLE copy, not the CRLF sibling', () => {
    const rbaron = sourceLines('RBARON.MAC')
    expect(rbaron.length, 'RBARON.MAC line count').toBe(ROM.rbaronLines)
    expect(at(rbaron, 74)).toBe('\t.RADIX 16')
    expect(at(rbaron, ROM.defs.CALCNT.line)).toBe(ROM.defs.CALCNT.text)
    // The stale line the CRLF sibling reports for CALCNT is NOT the CALCNT equate.
    expect(at(rbaron, ROM.defs.CALCNT.stale)).not.toMatch(/CALCNT/)
  })

  it('the fingerprint REJECTS a form-feed-glued copy (the sibling that poisoned the doc)', () => {
    // Reproduce the sibling's defect in memory: glue each page break back onto the heading that
    // follows it — the transform that loses the 8 lines. If a glued copy still fingerprints as
    // the byte-of-record, this whole group is decoration.
    const real = sourceLines('RBARON.MAC')
    const glued: string[] = []
    for (let i = 0; i < real.length; i++) {
      if (real[i] === '' && /^\x0c?\t\.(SBTTL|TITLE)/.test(real[i + 1] ?? '')) continue
      glued.push(real[i])
    }
    expect(glued.length).toBeLessThan(real.length)
    expect(glued.length).not.toBe(ROM.rbaronLines)
    expect(at(glued, ROM.defs.CALCNT.line)).not.toBe(ROM.defs.CALCNT.text)
  })

  it('the radix switches are exactly where ROM says, and the decimal island is lone', () => {
    const rbaron = sourceLines('RBARON.MAC')
    const switches = rbaron
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => /^\s*\.RADIX/.test(l))
      .map(([n]) => n)
    expect(switches).toEqual([...ROM.radixSwitches])
    expect(at(rbaron, ROM.island.from)).toBe('\t.RADIX 10')
    expect(at(rbaron, ROM.island.to + 1)).toBe('\t.RADIX 16')
  })

  it('every symbol sits at the line ROM claims for it', () => {
    const rbaron = sourceLines('RBARON.MAC')
    for (const [sym, { line }] of Object.entries(ROM.defs)) {
      expect(at(rbaron, line), `${sym} must be defined at RBARON.MAC:${line}`).toMatch(
        new RegExp(`^${sym}[:\\t =]`),
      )
    }
    expect(at(rbaron, ROM.incFrame.line)).toBe('\tINC FRAME')
  })

  it('RBARON vs R2BRON differ in ROM.decoyDiffCount lines, and every one is a checksum byte', () => {
    const rbaron = sourceLines('RBARON.MAC')
    const r2bron = sourceLines('R2BRON.MAC')
    const diff = differingLines(rbaron, r2bron)
    for (const n of diff) {
      expect(
        `${at(rbaron, n)}${at(r2bron, n)}`,
        `RBARON.MAC:${n} differs from the decoy and is NOT a checksum byte — the decoy is not benign`,
      ).toMatch(/CHKSM/)
    }
    expect(diff.length).toBe(ROM.decoyDiffCount)
  })

  it('RBGRND vs R2GRND differ in exactly the frame divider and the watchdog', () => {
    const rbgrnd = sourceLines('RBGRND.MAC')
    const r2grnd = sourceLines('R2GRND.MAC')
    expect(differingLines(rbgrnd, r2grnd)).toEqual([...ROM.groundDiffLines])
    expect(at(rbgrnd, 61)).toBe('\tFRMECNT=4')
    expect(at(r2grnd, 61)).toBe('\tFRMECNT=5')
    expect(at(rbgrnd, 197)).toBe(`\tCMP I,${ROM.watchdog}`)
    expect(at(r2grnd, 197)).toBe('\tCMP I,40')
    expect(at(rbgrnd, 196)).toMatch(/LDA CALFLG/)
    expect(at(rbgrnd, 198)).toMatch(/3\*CALCULATION LOOP TIME/)
  })

  it("the decoy's own load map identifies its object module as RBARON", () => {
    expect(sourceLines('R2BRON.MAP').find((l) => /^OBJ:R2BRON\s+RBARON\b/.test(l))).toBeTruthy()
  })

  it('DRNPIC selects the model on the orientation bit — there is no distance test', () => {
    const rbaron = sourceLines('RBARON.MAC')
    expect(at(rbaron, ROM.drnpic.line)).toBe('DRNPIC:\tLDA PLSTAT+6\t\t;PLANE ROTATED')
    // `AND I,10` in a .RADIX 16 region is 0x10 — bit D4. The radix trap of this story, in one
    // instruction: read as decimal it is nonsense.
    expect(at(rbaron, ROM.drnpic.line + 1)).toBe('\tAND I,10')
    expect(parseInt('10', 16)).toBe(Number(ROM.drnpic.bit))
    expect(rbaron.slice(ROM.drnpic.line, ROM.drnpic.line + 18).join('\n')).toMatch(/\.DRPNT/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────
// AC1/AC2 — the decoy is cited nowhere, and named only inside its own warning.
// Runs in CI.
// ─────────────────────────────────────────────────────────────────────────────────────
describe('AC1/AC2 — the decoy build is cited nowhere', () => {
  it('no citation anywhere in the doc or src names the decoy build', () => {
    const offenders: string[] = []
    for (const [path, text] of [['docs/red-baron-1980-source-findings.md', doc()] as [string, string], ...srcFiles()]) {
      for (const m of text.matchAll(CITATION)) {
        if (isDecoyModule(m[1])) offenders.push(`${path}: ${m[0]}`)
      }
    }
    expect(offenders, `citations to a build that never shipped:\n${offenders.join('\n')}`).toEqual([])
  })

  it('src/ does not mention the decoy build at all — not even in prose, not in any case', () => {
    const offenders = srcFiles()
      .filter(([, text]) => namesDecoy(text))
      .map(([path]) => path)
    expect(offenders, `src/ must cite the ROM, never the decoy:\n${offenders.join('\n')}`).toEqual([])
  })

  it('the doc names the decoy ONLY inside its delimited trap header', () => {
    const text = doc()
    const start = text.indexOf('<!-- decoy-trap:start -->')
    const end = text.indexOf('<!-- decoy-trap:end -->')
    expect(start, 'the doc must carry a <!-- decoy-trap:start --> marker').toBeGreaterThan(-1)
    expect(end, 'the doc must carry a <!-- decoy-trap:end --> marker').toBeGreaterThan(start)

    const outside = text.slice(0, start) + text.slice(end)
    expect([...outside.matchAll(DECOY_NAME_G)].map((m) => m[0]), 'decoy named outside the trap header').toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────
// AC2 — the trap header states the ROM's facts. Every number is checked AGAINST ITS CLAIM,
// not merely "appears somewhere": `toContain('7')` was satisfied by `037007.XXX`, and a header
// claiming NINE differing lines passed 25/25 (Reviewer, rb4-2). Runs in CI.
// ─────────────────────────────────────────────────────────────────────────────────────
describe('AC2 — the trap header tells the truth about the decoy', () => {
  it('states how many lines differ — attached to the claim, not loose in the prose', () => {
    const header = trapHeader()
    expect(header, 'the trap header must exist').not.toBe('')
    expect(
      header,
      `the header must say the builds differ in ${ROM.decoyDiffCount} LINES (a bare "${ROM.decoyDiffCount}" ` +
        'anywhere is not a claim — 037007.XXX contains one)',
    ).toMatch(new RegExp(`\\b${ROM.decoyDiffCount}\\s+lines\\b`, 'i'))
    expect(header, 'and that those differences are checksum bytes').toMatch(/checksum/i)
    expect(header, 'the "14 lines" double-count must not return').not.toMatch(/\b14\s+lines\b/i)
  })

  it('names BOTH ground-module differences — the divider and the watchdog', () => {
    const header = trapHeader()
    expect(header, 'the frame divider').toMatch(/FRMECNT/)
    expect(header, 'the SECOND difference — the watchdog').toMatch(/CALFLG|watchdog/i)
    expect(header, 'the shipped cadence').toMatch(/62\.5\s*Hz/i)
    expect(header, 'the decoy cadence').toMatch(/\b50\s*Hz/i)
    // The sentence that let the watchdog lie in. Assert the positive fact too, so a reword of
    // the negative cannot resurrect the claim.
    expect(doc(), 'the "one substantive value" claim is refuted by RBGRND:197').not.toMatch(
      /one substantive value|a single (substantive|meaningful) (value|way|difference)/i,
    )
    // Tied to the CLAIM, not to the digit's presence. `/\bTWO\b|\b2\b/i` was satisfied by the
    // standalone "2" in the story ids `(rb1-2)` / `(rb4-2)`, so the header could drop the claim
    // entirely and stay green (Reviewer, rb4-2 round 2) — the same defect as `toContain('7')`
    // being satisfied by `037007.XXX`, one line below the fix for it.
    // The count must sit ADJACENT to what it counts. Two earlier drafts of this assertion leaked:
    //   /\bTWO\b|\b2\b/            — satisfied by the "2" in the story ids `(rb1-2)` / `(rb4-2)`
    //   /\b(two|2)\b.{0,40}lines/  — satisfied by "those TWO differ in exactly SOME lines", where
    //                                the leading "two" means the two MODULES, not the line count
    // A number is only a claim when it is attached to the noun it quantifies.
    const n = ROM.groundDiffLines.length
    expect(
      header,
      `the header must say the ground modules differ in ${n} LINES (the count adjacent to "lines")`,
    ).toMatch(new RegExp(`\\b(two|${n})\\b\\**\\s+lines\\b`, 'i'))
  })

  it("warns that the decoy's load map signs the ship build's name", () => {
    // Assert the EVIDENCE, not a word near it. `/load map|\.MAP|object module/i` was matched by the
    // token `.MAP` in "R2BRON.MAP" — so the entire warning, evidence block and all, could be deleted
    // (or falsified to name a different module) and this stayed green (Reviewer, rb4-2 round 3).
    // Third time this suite matched a token where it claimed to check a claim: `toContain('7')` was
    // satisfied by `037007.XXX`, `\b2\b` by `(rb4-2)`, and `\.MAP` by `R2BRON.MAP`.
    //
    // This is the line the source-side group re-derives from R2BRON.MAP. It IS the trap: the decoy's
    // own load map calls its object module RBARON.
    expect(trapHeader(), "the header must SHOW the decoy's map identing itself as RBARON").toMatch(
      /OBJ:R2BRON\s+RBARON/,
    )
    expect(trapHeader(), 'and say what that means').toMatch(/load map|object module/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────
// The watchdog — the one fact the doc actually imported from the decoy. Runs in CI.
// ─────────────────────────────────────────────────────────────────────────────────────
describe('the watchdog claim is re-sourced to the shipped build', () => {
  /** 0x40, $40, 40h, 64, "sixty-four" — the threshold that never shipped, however it is spelled. */
  const DECOY_THRESHOLD = /CALFLG\s*[≥>]=?\s*(\$|0x|#)?\s*(40|64)\b|sixty[- ]?four missed|64 missed frames/i

  it('the doc states CALFLG >= 3 and never the decoy threshold', () => {
    const text = doc()
    expect(text, 'the 0x40 threshold came from R2GRND — it never ran').not.toMatch(DECOY_THRESHOLD)
    expect(text, `the doc must state the shipped threshold: CALFLG >= ${ROM.watchdog}`).toMatch(
      new RegExp(`CALFLG\\s*(&gt;=|>=|≥)\\s*${ROM.watchdog}\\b`),
    )
  })

  it('no src comment carries the decoy threshold, however it is spelled', () => {
    const offenders = srcFiles()
      .filter(([, text]) => DECOY_THRESHOLD.test(text))
      .map(([path]) => path)
    expect(offenders, `src/ repeats the retracted watchdog:\n${offenders.join('\n')}`).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────
// AC3 — the radix rule, stated once, correctly, with the region table. Runs in CI.
// ─────────────────────────────────────────────────────────────────────────────────────
describe('AC3 — the radix rule is stated once, and it is right', () => {
  it('names the hex region, the lone decimal island, and the trailing-dot escape', () => {
    const text = doc()
    expect(text, 'where the hex region begins').toMatch(new RegExp(`RBARON\\.MAC:${ROM.radixSwitches[0]}`))
    expect(text, 'the decimal island start').toMatch(new RegExp(`\\b${ROM.island.from}\\b`))
    expect(text, 'the decimal island end').toMatch(new RegExp(`\\b${ROM.island.to}\\b`))
    expect(text, 'the trailing-dot decimal escape').toMatch(/trailing (dot|period)/i)
  })

  it('states the radix rule ONCE — not once correctly and again wrongly', () => {
    expect((doc().match(/trailing (dot|period)/gi) ?? []).length).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────
// AC4 — the line citations. Enforced against ROM, so it runs in CI. Runs in CI.
// ─────────────────────────────────────────────────────────────────────────────────────
describe('AC4 — every cited line is the line the source really uses', () => {
  const cases = Object.entries(ROM.defs).map(([symbol, d]) => ({ symbol, ...d }))

  it.each(cases)('$symbol is cited at its real line, not the stale one', ({ symbol, line, stale }) => {
    // Only the doc lines that actually discuss this symbol may speak for it.
    const rows = doc()
      .split('\n')
      .filter((l) => l.includes(symbol) && /RBARON\.MAC\s*:\s*\d/.test(l))
    expect(rows.length, `the doc must cite ${symbol} against RBARON.MAC somewhere`).toBeGreaterThan(0)

    const cited = rows.flatMap((l) => [...l.matchAll(/RBARON\.MAC\s*:\s*(\d+)/g)].map((m) => Number(m[1])))
    expect(cited, `${symbol} must be cited at RBARON.MAC:${line}`).toContain(line)
    expect(cited, `${symbol} must no longer be cited at the stale RBARON.MAC:${stale}`).not.toContain(stale)
  })

  it('the `INC FRAME` use-site is cited where it actually is', () => {
    const rows = doc().split('\n').filter((l) => /INC FRAME|`FRAME`/.test(l) && /RBARON\.MAC\s*:\s*\d/.test(l))
    const cited = rows.flatMap((l) => [...l.matchAll(/RBARON\.MAC\s*:\s*(\d+)/g)].map((m) => Number(m[1])))
    expect(cited, `INC FRAME lives at RBARON.MAC:${ROM.incFrame.line}`).toContain(ROM.incFrame.line)
    expect(cited, 'the stale citation came from the CRLF sibling').not.toContain(ROM.incFrame.stale)
  })

  it('src/core/timing.ts cites CALCNT at its real line', () => {
    const timing = readFileSync(join(repoRoot, 'src', 'core', 'timing.ts'), 'utf8')
    expect(timing, 'timing.ts must cite the real CALCNT line').toMatch(
      new RegExp(`RBARON\\.MAC:${ROM.defs.CALCNT.line}`),
    )
    expect(timing, 'the stale line was copied verbatim out of the poisoned doc').not.toMatch(
      new RegExp(`RBARON\\.MAC:${ROM.defs.CALCNT.stale}`),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────
// AC5 — the "distance LOD" is retracted. Runs in CI.
// ─────────────────────────────────────────────────────────────────────────────────────
describe('AC5 — the model is chosen on an orientation bit, not on distance', () => {
  /**
   * The claim, not the phrase. `/distance LOD/i` blocked two words; "level of detail by depth"
   * restates the same falsehood and walks through (Reviewer, rb4-2).
   */
  const DEPTH_CLAIM =
    /distance[- ]?(based\s+)?LOD|LOD[^.\n]{0,30}(distance|depth)|(distance|depth)[- ][a-z]*\s*(LOD|level of detail)|level of detail[^.\n]{0,30}(distance|depth)/i

  it('the doc no longer claims the model is chosen by distance', () => {
    // Scoped OUT of the retraction blockquote, which necessarily describes the claim it kills.
    const text = doc().split('\n').filter((l) => !l.startsWith('>')).join('\n')
    expect(text, 'the ROM has no distance test in the picture path').not.toMatch(DEPTH_CLAIM)
  })

  it('the retraction names the real selector, IN THE PASSAGE THAT MAKES THE CLAIM', () => {
    const passage = lodRetraction()
    expect(passage, 'the doc must carry a §7 retraction').not.toBe('')
    expect(passage, 'the state byte').toMatch(/PLSTAT\+6/)
    expect(passage, 'the bit — 0x10 / D4').toMatch(/0x10|\bD4\b|bit 4/i)
    expect(passage, 'the routine').toMatch(/DRNPIC/)
    expect(passage, 'the real line').toMatch(new RegExp(`RBARON\\.MAC:${ROM.drnpic.line}`))
  })

  it('no src comment restates the retracted claim', () => {
    const offenders = srcFiles()
      .filter(([, text]) => {
        // biplane.ts documents the divergence on purpose; what it must NOT do is cite it as the ROM's.
        const asRomFact = /ROM[^.\n]{0,40}(distance|depth)[^.\n]{0,30}(LOD|model)/i
        return asRomFact.test(text)
      })
      .map(([path]) => path)
    expect(offenders, `src/ presents a depth LOD as the ROM's rule:\n${offenders.join('\n')}`).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────
// AC6 — code comments cite the shipped build. Runs in CI.
// ─────────────────────────────────────────────────────────────────────────────────────
describe('AC6 — src/ comments cite the ROM, and only the build that shipped', () => {
  it('every ROM citation in src/ names a module that actually shipped', () => {
    const offenders: string[] = []
    for (const [path, text] of srcFiles()) {
      for (const m of text.matchAll(CITATION)) {
        if (!isShipped(m[1])) offenders.push(`${path}: ${m[0]}`)
      }
    }
    expect(offenders, `src/ cites modules outside the shipped build:\n${offenders.join('\n')}`).toEqual([])
  })
})

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
// ─── WHAT THIS SUITE ASSERTS ─────────────────────────────────────────────────────────
//
// The source-side groups re-open the quarry and DERIVE the truth (symbol definition
// lines, diff counts, verbatim bytes) rather than trusting a number typed by a human.
// A fact the doc states must equal a fact the SOURCE yields. That is the whole point:
// this story exists because someone typed a number they had not re-read.
//
// The Atari source is copyrighted and stays out of this repo, so the source-side groups
// skip when the quarry is absent (CI), exactly as tests/audit/citations.test.ts does.
// The doc-side and src-side greps need no quarry and always run.

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
const at = (lines: string[], n: number) => lines[n - 1]

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

/** A citation: a quarry module and the line(s) it points at. */
const CITATION = /\b([A-Z0-9]{3,8}\.(?:MAC|MAP|XXX|COM))\s*:\s*(\d+)(?:\s*-\s*(\d+))?/g

/** The build that actually shipped — RBARON.COM's link list, plus the picture/char ROMs. */
const SHIPPED = [
  'RBARON.MAC', 'RBGRND.MAC', 'RBSOUN.MAC', 'RBCOIN.MAC', 'RBINT.MAC', 'RBROM.MAC',
  'VGUT.MAC', 'TCN65.MAC', 'VGMC.MAC', 'VGAN.MAC', 'STATE2.MAC',
  '037007.XXX', '037006.XXX', 'RBARON.MAP', 'RBARON.COM',
]
const isDecoyModule = (m: string) => /^R2(BRON|GRND)\./.test(m)

/** Lines (1-based) at which two same-length files disagree. */
function differingLines(a: string[], b: string[]): number[] {
  const n = Math.max(a.length, b.length)
  const out: number[] = []
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) out.push(i + 1)
  return out
}

// ─────────────────────────────────────────────────────────────────────────────────────
// AC-adjacent, and the root cause: the quarry we resolve against must be the CITABLE
// copy. Every other source-side assertion below is worthless if this one does not hold —
// pointed at the CRLF sibling, they would all "confirm" the very line numbers this story
// exists to correct.
// ─────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!sourceAvailable)('the quarry is the CITABLE copy, not the CRLF sibling', () => {
  /**
   * The byte-of-record fingerprint. Five anchors spread across RBARON.MAC: the line
   * count, the radix switch at the top, the CALCNT equate that timing.ts cites, and both
   * edges of the lone decimal island. The CRLF sibling fails every one of them below :74.
   */
  function fingerprintErrors(lines: string[]): string[] {
    const errors: string[] = []
    const want: Array<[number, string]> = [
      [74, '\t.RADIX 16'],
      [621, 'CALCNT\t=18'],
      [6217, '\t.RADIX 10'],
      [6281, '\t.RADIX 16'],
    ]
    if (lines.length !== 6294) errors.push(`RBARON.MAC has ${lines.length} lines, expected 6294`)
    for (const [n, text] of want) {
      if (at(lines, n) !== text) {
        errors.push(`RBARON.MAC:${n} is ${JSON.stringify(at(lines, n))}, expected ${JSON.stringify(text)}`)
      }
    }
    return errors
  }

  it('RBARON.MAC fingerprints as the LF byte-of-record', () => {
    expect(fingerprintErrors(sourceLines('RBARON.MAC'))).toEqual([])
  })

  it('the fingerprint REJECTS a form-feed-glued copy (the sibling that poisoned the doc)', () => {
    // Reproduce the sibling's defect in memory: glue each page break back onto the line
    // that follows it, which is precisely the transform that loses the 8 lines. If this
    // passes the fingerprint, the fingerprint is decoration and the gate above is a lie.
    const glued = readFileSync(join(SOURCE_DIR, 'RBARON.MAC'), 'latin1')
      .split(/\r\n|\r|\n/)
    const collapsed: string[] = []
    for (let i = 0; i < glued.length; i++) {
      // The LF copy renders a page break as an empty line preceding the .SBTTL/.TITLE.
      // The sibling carries \x0c as a prefix on that heading instead — one line, not two.
      if (glued[i] === '' && /^\x0c?\t\.(SBTTL|TITLE)/.test(glued[i + 1] ?? '')) continue
      collapsed.push(glued[i])
    }
    expect(collapsed.length).toBeLessThan(glued.length)
    expect(fingerprintErrors(collapsed)).not.toEqual([])
  })

  it('CALCNT sits at :621 in the citable copy and :620 in the glued one — the off-by-one, explained', () => {
    const lines = sourceLines('RBARON.MAC')
    expect(at(lines, 621)).toBe('CALCNT\t=18')
    // The stale citation the doc (and timing.ts) carry. It is NOT the CALCNT equate.
    expect(at(lines, 620)).not.toMatch(/CALCNT/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────
// AC1 — every fact re-sourced to the shipped build; zero references to R2BRON/R2GRND.
// AC2 — except inside one loud, delimited header that names the trap.
// ─────────────────────────────────────────────────────────────────────────────────────
describe('AC1/AC2 — the decoy build is cited nowhere', () => {
  it('no citation anywhere in the doc or src names the decoy build', () => {
    const offenders: string[] = []
    for (const [path, text] of [['docs/red-baron-1980-source-findings.md', doc()] as [string, string], ...srcFiles()]) {
      for (const m of text.matchAll(CITATION)) {
        if (isDecoyModule(m[1])) {
          offenders.push(`${path}: ${m[0]} (line ${text.slice(0, m.index).split('\n').length})`)
        }
      }
    }
    expect(offenders, `citations to a build that never shipped:\n${offenders.join('\n')}`).toEqual([])
  })

  it('src/ does not mention the decoy build at all — not even in prose', () => {
    const offenders = srcFiles()
      .filter(([, text]) => /R2BRON|R2GRND/.test(text))
      .map(([path, text]) => `${path} (${text.match(/R2BRON|R2GRND/g)?.length} mentions)`)
    expect(offenders, `src/ must cite the ROM, never the decoy:\n${offenders.join('\n')}`).toEqual([])
  })

  it('the doc names the decoy ONLY inside its delimited trap header', () => {
    const text = doc()
    // A single, machine-checkable region. Anything naming the decoy outside it is a
    // fact still sourced to the build that never shipped.
    const start = text.indexOf('<!-- decoy-trap:start -->')
    const end = text.indexOf('<!-- decoy-trap:end -->')
    expect(start, 'the doc must carry a <!-- decoy-trap:start --> marker').toBeGreaterThan(-1)
    expect(end, 'the doc must carry a <!-- decoy-trap:end --> marker').toBeGreaterThan(start)

    const outside = text.slice(0, start) + text.slice(end)
    const strays = [...outside.matchAll(/R2BRON|R2GRND/g)].map(
      (m) => `line ${outside.slice(0, m.index).split('\n').length}: ${m[0]}`,
    )
    expect(strays, `decoy named outside the trap header:\n${strays.join('\n')}`).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────
// AC2 — and the header must be TRUE. Every number below is DERIVED from the quarry, so
// the doc cannot state a figure nobody re-read. (The story briefs "14 lines"; the source
// says 7. The suite believes the source.)
// ─────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!sourceAvailable)('AC2 — the trap header tells the truth about the decoy', () => {
  const trapHeader = () => {
    const text = doc()
    const start = text.indexOf('<!-- decoy-trap:start -->')
    const end = text.indexOf('<!-- decoy-trap:end -->')
    return start >= 0 && end > start ? text.slice(start, end) : ''
  }

  it('RBARON vs R2BRON differ ONLY in checksum bytes — and the header says how many', () => {
    const rbaron = sourceLines('RBARON.MAC')
    const r2bron = sourceLines('R2BRON.MAC')
    const diff = differingLines(rbaron, r2bron)

    // Derived, not asserted: every differing line is a ROM self-test checksum byte.
    // That is what makes the decoy so convincing — its CODE is the shipped code.
    for (const n of diff) {
      expect(
        `${at(rbaron, n)}${at(r2bron, n)}`,
        `RBARON.MAC:${n} differs from R2BRON and is NOT a checksum byte — the decoy is not benign after all`,
      ).toMatch(/CHKSM/)
    }
    expect(diff.length).toBe(7)

    const header = trapHeader()
    expect(header, 'the header must state how many lines differ').toContain(String(diff.length))
    expect(header, 'the header must say the differences are checksum bytes').toMatch(/checksum/i)
    // The brief's "14" is a double-count of a unified diff (7 removed + 7 added).
    expect(header, 'the header must not repeat the "14 lines" double-count').not.toMatch(/\b14\b/)
  })

  it('RBGRND vs R2GRND differ in exactly TWO lines — FRMECNT *and* the watchdog', () => {
    const rbgrnd = sourceLines('RBGRND.MAC')
    const r2grnd = sourceLines('R2GRND.MAC')
    const diff = differingLines(rbgrnd, r2grnd)

    expect(diff).toEqual([61, 197])
    expect(at(rbgrnd, 61)).toBe('\tFRMECNT=4')
    expect(at(r2grnd, 61)).toBe('\tFRMECNT=5')
    expect(at(rbgrnd, 197)).toBe('\tCMP I,3')
    expect(at(r2grnd, 197)).toBe('\tCMP I,40')

    const header = trapHeader()
    expect(header, 'the header must name the frame divider').toMatch(/FRMECNT/)
    expect(header, 'the header must name the SECOND difference — the watchdog').toMatch(/CALFLG|watchdog/i)
    expect(header, 'the header must give the shipped cadence').toMatch(/62\.5/)
    expect(header, 'the header must give the decoy cadence').toMatch(/\b50\b/)

    // The doc's standing claim — that the builds differ in ONE substantive value — is
    // the sentence that let the watchdog lie in. It must not survive.
    expect(doc(), 'the "one substantive value" claim is refuted by RBGRND:197').not.toMatch(
      /one substantive value/i,
    )
  })

  it("the decoy's own load map calls its object module RBARON — and the header warns of it", () => {
    const map = sourceLines('R2BRON.MAP')
    const identLine = map.find((l) => /^OBJ:R2BRON\s+RBARON\b/.test(l))
    expect(identLine, 'R2BRON.MAP must identify its object module as RBARON').toBeTruthy()

    expect(trapHeader(), 'the header must warn that the decoy IDENTIFIES ITSELF as RBARON').toMatch(
      /load map|\.MAP|object module/i,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────
// The watchdog — the one fact the doc actually imported from the decoy. 0x40 = 64;
// the shipped build says 3. Off by 21x.
// ─────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!sourceAvailable)('the watchdog claim is re-sourced to the shipped build', () => {
  it('the shipped watchdog trips at CALFLG >= 3 (RBGRND.MAC:197), not 0x40', () => {
    const rbgrnd = sourceLines('RBGRND.MAC')
    expect(at(rbgrnd, 196)).toMatch(/LDA CALFLG/)
    expect(at(rbgrnd, 197)).toBe('\tCMP I,3')
    expect(at(rbgrnd, 198)).toMatch(/3\*CALCULATION LOOP TIME/)
  })

  it('the doc no longer claims the 0x40 / 64-missed-frame threshold', () => {
    const text = doc()
    expect(text, 'the 0x40 watchdog threshold came from R2GRND — it never shipped').not.toMatch(
      /CALFLG\s*[≥>]=?\s*(0x40|40|64)/i,
    )
    expect(text, 'the doc must not still claim ~64 missed frames').not.toMatch(/64 missed frames/i)
    expect(text, 'the doc must state the shipped threshold: CALFLG >= 3').toMatch(
      /CALFLG\s*(&gt;=|>=|≥)\s*3\b/,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────
// AC3 — the radix rule, stated ONCE, correctly, with the per-region table.
// ─────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!sourceAvailable)('AC3 — the radix rule is stated once, and it is right', () => {
  it('the region boundaries are exactly where the doc will claim they are', () => {
    const rbaron = sourceLines('RBARON.MAC')
    expect(at(rbaron, 74)).toBe('\t.RADIX 16')
    expect(at(rbaron, 6217)).toBe('\t.RADIX 10')
    expect(at(rbaron, 6281)).toBe('\t.RADIX 16')
    // The decimal island is the vertex table and NOTHING else: :6217-6280 inclusive.
    const switches = rbaron
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => /^\s*\.RADIX/.test(l))
      .map(([n]) => n)
    expect(switches, 'exactly three radix switches — any more and the island is not lone').toEqual([
      74, 6217, 6281,
    ])
  })

  it('the doc names the lone decimal island :6217-6280 and the trailing-dot escape', () => {
    const text = doc()
    expect(text, 'the doc must state where the hex region begins').toMatch(/RBARON\.MAC:74/)
    expect(text, 'the doc must name the decimal island start').toMatch(/6217/)
    expect(text, 'the doc must name the decimal island end').toMatch(/6280/)
    expect(text, 'the doc must state the trailing-dot decimal escape').toMatch(/trailing (dot|period)/i)
  })

  it('states the radix rule ONCE — not once correctly and again wrongly', () => {
    const statements = doc().match(/trailing (dot|period)/gi) ?? []
    expect(statements.length, 'the radix rule must be stated exactly once').toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────
// AC4 — the line citations. Each expected line is DERIVED by finding where the source
// actually defines the symbol; nothing here is a number I typed and hoped about.
// ─────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!sourceAvailable)('AC4 — every cited line is the line the source really uses', () => {
  /** Where the quarry DEFINES a symbol (label or equate), 1-based. */
  function definitionLine(file: string, symbol: string): number {
    const lines = sourceLines(file)
    const n = lines.findIndex((l) => new RegExp(`^\\s*${symbol}[:\\t =]`).test(l))
    expect(n, `${symbol} must be defined in ${file}`).toBeGreaterThan(-1)
    return n + 1
  }

  // The §1 symbols the doc cites AT THEIR DEFINITION. The stale column is what the doc
  // carries today — copied from the CRLF sibling, and wrong by the staircase.
  const CASES: Array<{ symbol: string; file: string; stale: number }> = [
    { symbol: 'CALCNT', file: 'RBARON.MAC', stale: 620 },
    { symbol: 'BNRCNT', file: 'RBARON.MAC', stale: 621 },
    { symbol: 'MAIN', file: 'RBARON.MAC', stale: 761 },
    { symbol: 'SHLAUN', file: 'RBARON.MAC', stale: 4022 },
  ]

  it.each(CASES)('$symbol is cited at its real definition line, not the stale one', ({ symbol, file, stale }) => {
    const truth = definitionLine(file, symbol)
    expect(truth, `${symbol} moved — the staircase says the stale citation cannot be right`).not.toBe(stale)

    // Only the doc lines that actually discuss this symbol may speak for it.
    const rows = doc()
      .split('\n')
      .filter((l) => l.includes(symbol) && new RegExp(`${file}\\s*:\\s*\\d`).test(l))
    expect(rows.length, `the doc must cite ${symbol} against ${file} somewhere`).toBeGreaterThan(0)

    const citedNumbers = rows.flatMap((l) =>
      [...l.matchAll(new RegExp(`${file}\\s*:\\s*(\\d+)`, 'g'))].map((m) => Number(m[1])),
    )
    expect(citedNumbers, `${symbol} must be cited at ${file}:${truth}`).toContain(truth)
    expect(citedNumbers, `${symbol} must no longer be cited at the stale ${file}:${stale}`).not.toContain(stale)
  })

  it('the `INC FRAME` use-site is cited where it actually is', () => {
    const rbaron = sourceLines('RBARON.MAC')
    const truth = rbaron.findIndex((l) => /^\s*INC FRAME\b/.test(l)) + 1
    expect(at(rbaron, truth)).toBe('\tINC FRAME')

    const rows = doc().split('\n').filter((l) => /INC FRAME|`FRAME`/.test(l) && /RBARON\.MAC\s*:\s*\d/.test(l))
    const cited = rows.flatMap((l) => [...l.matchAll(/RBARON\.MAC\s*:\s*(\d+)/g)].map((m) => Number(m[1])))
    expect(cited, `INC FRAME lives at RBARON.MAC:${truth}`).toContain(truth)
    expect(cited, 'the stale :868 came from the CRLF sibling').not.toContain(868)
  })

  it('src/core/timing.ts cites CALCNT at RBARON.MAC:621 — byte-verified', () => {
    const rbaron = sourceLines('RBARON.MAC')
    expect(at(rbaron, 621)).toBe('CALCNT\t=18')

    const timing = readFileSync(join(repoRoot, 'src', 'core', 'timing.ts'), 'utf8')
    expect(timing, 'timing.ts must cite the real CALCNT line').toMatch(/RBARON\.MAC:621/)
    expect(timing, 'the stale :620 was copied verbatim out of the poisoned doc').not.toMatch(
      /RBARON\.MAC:620/,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────
// AC5 — the "distance LOD" is retracted. The ROM picks the plane model on an ORIENTATION
// BIT. No distance test exists in the picture path.
// ─────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!sourceAvailable)('AC5 — the model is chosen on PLSTAT+6 bit 0x10, not on distance', () => {
  it('DRNPIC branches on the "PLANE ROTATED" bit — and the bit is 0x10, because the region is hex', () => {
    const rbaron = sourceLines('RBARON.MAC')
    expect(at(rbaron, 4961)).toBe('DRNPIC:\tLDA PLSTAT+6\t\t;PLANE ROTATED')
    // `AND I,10` inside a .RADIX 16 region is 0x10 — bit D4. Read as decimal it is
    // nonsense, which is the radix trap of this very story, in one instruction.
    expect(at(rbaron, 4962)).toBe('\tAND I,10')
    // The far/drone point-list is selected on that branch — not on any depth compare.
    const picturePath = rbaron.slice(4960, 4979).join('\n')
    expect(picturePath, 'the drone point-list is the far model').toMatch(/\.DRPNT/)
  })

  it('the doc no longer claims a built-in DISTANCE LOD', () => {
    const text = doc()
    expect(text, 'the ROM has no distance test in the picture path').not.toMatch(/distance LOD/i)
    expect(text, 'the "distant plane" reading was inferred, and it was wrong').not.toMatch(
      /Built-in\s+\n?distance/i,
    )
  })

  it('the doc states the real selector, and cites it', () => {
    const text = doc()
    expect(text, 'the doc must name the state byte').toMatch(/PLSTAT\+6/)
    expect(text, 'the doc must name the bit (0x10 / D4)').toMatch(/0x10|D4|bit 4/i)
    expect(text, 'the doc must cite DRNPIC, where the branch lives').toMatch(/DRNPIC/)
    expect(text, 'the doc must cite the real line').toMatch(/RBARON\.MAC:496[12]/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────
// AC6 — code comments no longer carry the poison forward.
// ─────────────────────────────────────────────────────────────────────────────────────
describe('AC6 — src/ comments cite the ROM, not the decoy and not a retracted claim', () => {
  it('every ROM citation in src/ names a module that actually shipped', () => {
    const offenders: string[] = []
    for (const [path, text] of srcFiles()) {
      for (const m of text.matchAll(CITATION)) {
        if (!SHIPPED.includes(m[1])) offenders.push(`${path}: ${m[0]}`)
      }
    }
    expect(offenders, `src/ cites modules outside the shipped build:\n${offenders.join('\n')}`).toEqual([])
  })

  it('no src comment repeats a claim this story retracts', () => {
    const offenders: string[] = []
    for (const [path, text] of srcFiles()) {
      if (/distance LOD/i.test(text)) offenders.push(`${path}: repeats the retracted "distance LOD" claim`)
      if (/CALFLG\s*[≥>]=?\s*(0x40|64)/i.test(text)) offenders.push(`${path}: repeats the 0x40 watchdog`)
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})

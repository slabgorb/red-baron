// tests/audit/citations.test.ts
//
// The gate that makes the fidelity audit trustworthy. Every finding must cite BOTH
// sides — the Atari source line and our line — with the verbatim text of each. This
// checker re-opens each cited line and compares byte-for-byte. A finding that fails
// is DELETED, not repaired: a miscited finding is one the auditor never actually
// verified, and repairing it would launder a guess into evidence.
//
// The Atari source is a separate public checkout (`historicalsource/red-baron`) and is not
// part of this repo, so the source-side checks degrade gracefully when it is absent (CI),
// while the schema and our-side checks still run.
//
// ─── THIS FILE IS A SINGLE POINT OF FAILURE (rb4-1 REWORK 3, Reviewer finding 5) ─────
//
// EVERY test below routes through one function: checkFindings(). That makes it a choke
// point, and choke points get choked. One line inside it —
//
//     if (f.verdict === 'exempt') continue
//
// — using `verdict`, a key the finding schema ALREADY PERMITS, silently neutralises every
// assertion in this file at once: the synthetic fixtures here carry no verdict, so they go
// on passing while the real findings sail through unchecked. It would read as housekeeping
// in a diff.
//
// Two things stop that, and neither of them lives here:
//
//   1. tests/audit/citation-evidence.test.ts re-implements the our-side byte comparison
//      FROM SCRATCH, over the real findings, sharing no code with checkFindings(). That
//      duplication is DELIBERATE. It MUST NOT be refactored to call checkFindings() — the
//      moment it does, one line subverts both files and the audit is unguarded.
//   2. The same file exercises checkFindings() against a synthetic laundered finding that
//      CARRIES `verdict: 'exempt'`, so the neutralisation above turns the suite red.
//
// If you are here to make this file green, that is the file you must convince.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error — plain .mjs helper, no types needed
import { checkFindings } from '../../tools/audit/check-citations.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const findingsDir = join(repoRoot, 'docs', 'audit', 'findings')
const sourceDir = process.env.RED_BARON_SOURCE_DIR ?? '/Users/slabgorb/Projects/red-baron-source-text'
const sourceAvailable = existsSync(sourceDir)

/** A real line from our tree, read fresh, so the fixture cannot drift out of date. */
function ourLine(file: string, line: number): string {
  return readFileSync(join(repoRoot, file), 'utf8').split('\n')[line - 1]
}

const OURS_OK = { file: 'src/core/timing.ts', line: 16, verbatim: ourLine('src/core/timing.ts', 16) }

describe('checkFindings — the shipped-module gate', () => {
  it('rejects a citation to R2GRND.MAC, the decoy that never shipped', () => {
    // R2GRND differs from the shipped RBGRND by exactly one constant that matters:
    // FRMECNT=5 (50 Hz) instead of FRMECNT=4 (62.5 Hz). A finding built on it looks
    // perfectly plausible and is perfectly wrong. This is the trap the gate exists for.
    const errors = checkFindings(
      [{
        id: 'X-001', class: 'DIVERGENCE', title: 't',
        source: { file: 'R2GRND.MAC', line: 61, verbatim: '\tFRMECNT=5' },
        ours: OURS_OK,
        claim: 'c', reasoning: 'r', recommendation: 'fix', size: 's',
      }],
      { repoRoot, sourceDir: null },
    )
    expect(errors.join('\n')).toMatch(/R2GRND\.MAC.*never shipped/)
  })

  it('rejects a citation to R2BRON.MAC, the decoy main module', () => {
    const errors = checkFindings(
      [{
        id: 'X-002', class: 'DIVERGENCE', title: 't',
        source: { file: 'R2BRON.MAC', line: 621, verbatim: 'CALCNT\t=18' },
        ours: OURS_OK,
        claim: 'c', reasoning: 'r', recommendation: 'fix', size: 's',
      }],
      { repoRoot, sourceDir: null },
    )
    expect(errors.join('\n')).toMatch(/R2BRON\.MAC.*never shipped/)
  })

  it('accepts a module that shipped only via .INCLUDE (TCN65, pulled in by RBCOIN)', () => {
    const errors = checkFindings(
      [{
        id: 'X-003', class: 'NO_COUNTERPART', title: 't', ours: null,
        source: { file: 'TCN65.MAC', line: 1, verbatim: 'anything' },
        claim: 'c', reasoning: 'r', recommendation: 'accept',
      }],
      { repoRoot, sourceDir: null },
    )
    expect(errors).toEqual([])
  })

  it('accepts the picture ROM (037007.XXX = RBPICS), which topology.ts is transcribed from', () => {
    const errors = checkFindings(
      [{
        id: 'X-004', class: 'CONFIRMED', title: 't',
        source: { file: '037007.XXX', line: 93, verbatim: 'anything' },
        ours: OURS_OK,
        claim: 'c', reasoning: 'r',
      }],
      { repoRoot, sourceDir: null },
    )
    expect(errors).toEqual([])
  })
})

describe('checkFindings — the byte-for-byte citation gate', () => {
  it('rejects a finding whose `ours` verbatim does not match the real line', () => {
    const errors = checkFindings(
      [{
        id: 'X-005', class: 'DIVERGENCE', title: 't',
        source: { file: 'RBARON.MAC', line: 1, verbatim: 'anything' },
        ours: { file: 'src/core/timing.ts', line: 16, verbatim: 'export const MASTER_NMI_HZ = 999' },
        claim: 'c', reasoning: 'r', recommendation: 'fix', size: 's',
      }],
      { repoRoot, sourceDir: null },
    )
    expect(errors.join('\n')).toMatch(/X-005.*does not match/)
  })

  it('accepts a finding whose `ours` verbatim matches the real line', () => {
    const errors = checkFindings(
      [{
        id: 'X-006', class: 'DIVERGENCE', title: 't',
        source: { file: 'RBARON.MAC', line: 1, verbatim: 'anything' },
        ours: OURS_OK,
        claim: 'c', reasoning: 'r', recommendation: 'fix', size: 's',
      }],
      { repoRoot, sourceDir: null },
    )
    expect(errors).toEqual([])
  })

  it('rejects a citation to a line that does not exist in our tree', () => {
    const errors = checkFindings(
      [{
        id: 'X-007', class: 'DIVERGENCE', title: 't',
        source: { file: 'RBARON.MAC', line: 1, verbatim: 'anything' },
        ours: { file: 'src/core/timing.ts', line: 99999, verbatim: 'x' },
        claim: 'c', reasoning: 'r', recommendation: 'fix', size: 's',
      }],
      { repoRoot, sourceDir: null },
    )
    expect(errors.join('\n')).toMatch(/X-007.*does not exist/)
  })
})

describe('checkFindings — schema', () => {
  it('requires `ours` to be null for NO_COUNTERPART and present otherwise', () => {
    const base = {
      class: 'NO_COUNTERPART', title: 't',
      source: { file: 'RBARON.MAC', line: 1, verbatim: 'anything' },
      claim: 'c', reasoning: 'r', recommendation: 'fix', size: 'm',
    }
    expect(checkFindings([{ ...base, id: 'X-008', ours: null }], { repoRoot, sourceDir: null })).toEqual([])
    expect(
      checkFindings([{ ...base, id: 'X-009', class: 'DIVERGENCE', ours: null }], { repoRoot, sourceDir: null })
        .join('\n'),
    ).toMatch(/X-009.*requires `ours`/)
  })

  it('requires a size when the recommendation is `fix`', () => {
    const errors = checkFindings(
      [{
        id: 'X-010', class: 'DIVERGENCE', title: 't',
        source: { file: 'RBARON.MAC', line: 1, verbatim: 'anything' },
        ours: OURS_OK,
        claim: 'c', reasoning: 'r', recommendation: 'fix',
      }],
      { repoRoot, sourceDir: null },
    )
    expect(errors.join('\n')).toMatch(/X-010.*requires size/)
  })

  it('rejects an unknown class', () => {
    const errors = checkFindings(
      [{
        id: 'X-011', class: 'PROBABLY_FINE', title: 't',
        source: { file: 'RBARON.MAC', line: 1, verbatim: 'anything' },
        ours: OURS_OK, claim: 'c', reasoning: 'r',
      }],
      { repoRoot, sourceDir: null },
    )
    expect(errors.join('\n')).toMatch(/X-011.*class must be one of/)
  })

  it('rejects duplicate ids', () => {
    const f = {
      id: 'X-012', class: 'NO_COUNTERPART', title: 't', ours: null,
      source: { file: 'RBARON.MAC', line: 1, verbatim: 'anything' },
      claim: 'c', reasoning: 'r', recommendation: 'accept',
    }
    expect(checkFindings([f, { ...f }], { repoRoot, sourceDir: null }).join('\n')).toMatch(/duplicate id.*X-012/i)
  })
})

/**
 * The commit the audit was taken against (the squash of PR #20 on develop). The `ours`
 * citations describe the code as it stood HERE.
 *
 * rb4-1 corrected ~30 of the very lines the audit indicts, and added a radix citation
 * above each — which shifts every line below it. Checking `ours` against the WORKING TREE
 * would therefore redden this gate for doing exactly what the audit asked, and the only
 * way to green it would be to rewrite the findings to match the new code: laundering a
 * guess into evidence, which is the one thing this checker exists to prevent.
 *
 * So the our-side check is pinned to the audit commit. Nothing is weakened — every line
 * is still re-opened and compared byte-for-byte against real content at a real commit —
 * and tests/audit/citation-evidence.test.ts independently guards that the findings
 * themselves have not been edited.
 */
const AUDIT_COMMIT = '6038a07b9044f1add37fd12c217cd39ec1629439'

describe('the committed findings', () => {
  it('every findings file passes the schema + our-side citation checks, AS AUDITED', () => {
    if (!existsSync(findingsDir)) return
    const files = readdirSync(findingsDir).filter((f) => f.endsWith('.json'))
    const all = files.flatMap((f) => JSON.parse(readFileSync(join(findingsDir, f), 'utf8')))
    expect(checkFindings(all, { repoRoot, sourceDir: null, oursRef: AUDIT_COMMIT })).toEqual([])
  })
})

describe.skipIf(!sourceAvailable)('the committed findings — source side', () => {
  it('every findings file cites real Atari source lines, byte-for-byte', () => {
    if (!existsSync(findingsDir)) return
    const files = readdirSync(findingsDir).filter((f) => f.endsWith('.json'))
    const all = files.flatMap((f) => JSON.parse(readFileSync(join(findingsDir, f), 'utf8')))
    expect(checkFindings(all, { repoRoot, sourceDir, oursRef: AUDIT_COMMIT })).toEqual([])
  })
})

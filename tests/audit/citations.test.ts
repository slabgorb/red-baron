// tests/audit/citations.test.ts
//
// The gate that makes the fidelity audit trustworthy. Every finding must cite BOTH
// sides — the Atari source line and our line — with the verbatim text of each. This
// checker re-opens each cited line and compares byte-for-byte. A finding that fails
// is DELETED, not repaired: a miscited finding is one the auditor never actually
// verified, and repairing it would launder a guess into evidence.
//
// The Atari source is copyrighted and never enters this repo. The source-side checks
// therefore degrade gracefully when it is absent (CI), while the schema and our-side
// checks still run.

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

describe('the committed findings', () => {
  it('every findings file passes the schema + our-side citation checks', () => {
    if (!existsSync(findingsDir)) return
    const files = readdirSync(findingsDir).filter((f) => f.endsWith('.json'))
    const all = files.flatMap((f) => JSON.parse(readFileSync(join(findingsDir, f), 'utf8')))
    expect(checkFindings(all, { repoRoot, sourceDir: null })).toEqual([])
  })
})

describe.skipIf(!sourceAvailable)('the committed findings — source side', () => {
  it('every findings file cites real Atari source lines, byte-for-byte', () => {
    if (!existsSync(findingsDir)) return
    const files = readdirSync(findingsDir).filter((f) => f.endsWith('.json'))
    const all = files.flatMap((f) => JSON.parse(readFileSync(join(findingsDir, f), 'utf8')))
    expect(checkFindings(all, { repoRoot, sourceDir })).toEqual([])
  })
})

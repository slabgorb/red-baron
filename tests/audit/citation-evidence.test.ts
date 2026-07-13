// tests/audit/citation-evidence.test.ts
//
// Story rb4-1 — THE RADIX SWEEP — RED phase (Furiosa / TEA).
//
// ─── THE TRAP THIS FILE EXISTS TO CLOSE ──────────────────────────────────────────
//
// AC-6 says `npm test -- citations` must stay green. But the citation gate re-opens
// every finding's `ours` line IN THE WORKING TREE and compares it byte-for-byte
// (tools/audit/check-citations.mjs, the `--- ours side` block, which runs
// unconditionally — there is no sourceDir guard on it).
//
// This story rewrites ~30 of exactly those lines. Measured, not guessed: applying the
// story to ONE constant in ONE file — S_MAXZ 19 -> 25 in guns.ts, plus the AC-2 radix
// comment above it — produced TEN citation errors. One from the changed value; NINE
// from the single inserted comment line shifting every finding below it in that file.
// 65 of the audit's 154 our-side citations live in the eight files this story edits.
//
// So AC-1 + AC-2 and AC-6 cannot both hold under the checker as written. Something must
// change, and there is exactly one thing that must NOT: the evidence.
//
// The `ours` citations are a SNAPSHOT — proof the auditor actually opened our code and
// read the line, rather than inventing a finding. Their whole value is that they are
// immutable. The tempting fix — rewriting each `ours.verbatim`/`ours.line` to match the
// corrected code — destroys precisely that, and the checker's own doc comment forbids
// it in as many words: "a miscited finding is one the auditor never actually verified,
// and repairing it launders a guess into evidence."
//
// THIS FILE IS THE LOCK. It pins every `ours` citation to the code AS IT WAS AUDITED
// (the audit commit), so the JSON cannot be quietly edited to keep the gate green.
//
// ─── WHAT DEV MUST DO (the mechanism is Dev's call; the property is not) ─────────
//
// Make the our-side check read from the AUDIT COMMIT instead of the working tree — e.g.
// give `checkFindings` an `oursRef` option that resolves lines via `git show <ref>:<file>`.
// The anti-fabrication guarantee is untouched (the line is still checked against real
// content at a real commit), the evidence stays frozen, and the code is free to be fixed.
//
// Do NOT: edit the findings JSON; delete the our-side check; or add findings to an
// ignore-list. All three keep the gate green by making it stop meaning anything.

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const findingsDir = join(repoRoot, 'docs', 'audit', 'findings')

/**
 * The commit the audit was taken against: the squash of PR #20 on develop, and the base
 * of this story's branch. Every `ours` citation in docs/audit/findings/ describes the
 * code as it stood HERE. This is the evidence's frame of reference; it does not move.
 */
const AUDIT_COMMIT = '6038a07b9044f1add37fd12c217cd39ec1629439'

interface Finding {
  readonly id: string
  readonly class: string
  readonly ours: { readonly file: string; readonly line: number; readonly verbatim: string } | null
}

/** Narrow one parsed JSON object to a Finding, rather than casting and hoping. */
function toFinding(raw: unknown, where: string): Finding {
  if (typeof raw !== 'object' || raw === null) throw new Error(`${where}: finding is not an object`)
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string') throw new Error(`${where}: finding has no string id`)
  if (typeof o.class !== 'string') throw new Error(`${where}: ${o.id} has no string class`)
  const ours = o.ours
  if (ours === null || ours === undefined) return { id: o.id, class: o.class, ours: null }
  if (typeof ours !== 'object') throw new Error(`${where}: ${o.id} has a non-object \`ours\``)
  const u = ours as Record<string, unknown>
  if (typeof u.file !== 'string' || typeof u.line !== 'number' || typeof u.verbatim !== 'string') {
    throw new Error(`${where}: ${o.id} \`ours\` needs {file: string, line: number, verbatim: string}`)
  }
  return { id: o.id, class: o.class, ours: { file: u.file, line: u.line, verbatim: u.verbatim } }
}

function allFindings(): readonly Finding[] {
  if (!existsSync(findingsDir)) return []
  return readdirSync(findingsDir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      const parsed: unknown = JSON.parse(readFileSync(join(findingsDir, f), 'utf8'))
      if (!Array.isArray(parsed)) throw new Error(`${f}: expected an array of findings`)
      return parsed.map((raw) => toFinding(raw, f))
    })
}

/** A file's contents at the audit commit. `null` when the commit is not in this clone. */
const blobCache = new Map<string, readonly string[] | null>()
function linesAtAuditCommit(file: string): readonly string[] | null {
  if (!blobCache.has(file)) {
    try {
      const blob = execFileSync('git', ['show', `${AUDIT_COMMIT}:${file}`], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      blobCache.set(file, blob.split('\n'))
    } catch {
      blobCache.set(file, null)
    }
  }
  return blobCache.get(file) ?? null
}

function auditCommitPresent(): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${AUDIT_COMMIT}^{commit}`], {
      cwd: repoRoot,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

/**
 * rb4-1 REWORK — this used to be `describe.skipIf(!haveAuditCommit)`, and that was worse
 * than having no lock at all.
 *
 * Under `actions/checkout`'s default `fetch-depth: 1` the audit commit is not in the clone,
 * so in CI — the ONE place this runs unattended, and the one place someone could quietly
 * push edited evidence — the whole anti-tamper block SILENTLY SKIPPED. A skipped describe
 * is neither pass nor fail: "I could not check" and "I checked, and it is clean" looked
 * identical in the log. That is a guard that only pretends to guard.
 *
 * It now FAILS LOUDLY when the commit is unreachable, and the CI checkout fetches full
 * history (`fetch-depth: 0`, arcade/.github/workflows/deploy-r2.yml) so the lock genuinely
 * runs. A developer on a shallow clone gets a red suite that tells them to unshallow —
 * which is correct: the check cannot run, and pretending otherwise is the bug.
 */
describe('the audit evidence is frozen at the commit it was taken against', () => {
  it('the audit commit is reachable — the evidence lock must RUN, never silently skip', () => {
    expect(
      auditCommitPresent(),
      `the audit commit ${AUDIT_COMMIT.slice(0, 7)} is not in this clone, so the evidence ` +
        `lock cannot run. This is a SHALLOW CLONE, not a clean bill of health — run ` +
        `\`git fetch --unshallow\` (CI uses fetch-depth: 0).`,
    ).toBe(true)
    expect(linesAtAuditCommit('src/core/guns.ts')).not.toBeNull()
  })

  it('EVERY `ours` citation still matches the code AS AUDITED — the evidence is not laundered', () => {
    const findings = allFindings().filter((f) => f.ours !== null)
    expect(findings.length, 'the audit should have findings to check').toBeGreaterThan(100)

    const laundered: string[] = []
    for (const f of findings) {
      const ours = f.ours
      if (ours === null) continue
      const lines = linesAtAuditCommit(ours.file)
      if (lines === null) {
        laundered.push(`${f.id}: ${ours.file} did not exist at the audit commit`)
        continue
      }
      const actual = lines[ours.line - 1]
      if (actual === undefined) {
        laundered.push(`${f.id}: ${ours.file}:${ours.line} did not exist at the audit commit`)
      } else if (actual.trimEnd() !== String(ours.verbatim).trimEnd()) {
        laundered.push(
          `${f.id}: ${ours.file}:${ours.line} no longer matches the AUDITED line.\n` +
            `  finding says:   ${JSON.stringify(ours.verbatim)}\n` +
            `  audit commit:   ${JSON.stringify(actual)}\n` +
            `  -> the finding was edited to fit the NEW code. That is laundering the evidence.\n` +
            `     Fix the CHECKER (read our-side lines from ${AUDIT_COMMIT.slice(0, 7)}), not the finding.`,
        )
      }
    }

    expect(laundered).toEqual([])
  })
})

describe('the citation gate still means something after the sweep', () => {
  it('the our-side check is still enforced — it was not deleted to keep the gate green', () => {
    // The cheapest way to make `citations` green after this story is to stop checking
    // our side at all. Assert the check is still there, and still unconditional.
    const checker = readFileSync(join(repoRoot, 'tools', 'audit', 'check-citations.mjs'), 'utf8')
    expect(checker, 'the our-side citation check must survive rb4-1').toMatch(/does not match verbatim/)
    expect(checker, 'NO_COUNTERPART must still be the only class allowed to omit `ours`').toMatch(
      /NO_COUNTERPART/,
    )
  })

  it('no finding has been given an opt-out flag to dodge the gate', () => {
    // The other cheap escape: add `"skip": true` / `"stale": true` to the findings that
    // break. The gate is worth nothing if a finding can excuse itself from it.
    for (const f of allFindings()) {
      const keys = Object.keys(f)
      for (const escape of ['skip', 'skipOurs', 'stale', 'ignore', 'fixed', 'obsolete']) {
        expect(keys, `${f.id} must not carry an \`${escape}\` opt-out`).not.toContain(escape)
      }
    }
  })
})

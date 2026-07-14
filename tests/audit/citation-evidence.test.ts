// tests/audit/citation-evidence.test.ts
//
// Story rb4-1 — THE RADIX SWEEP. THE LOCK ON THE AUDIT EVIDENCE.
//
// ─── WHAT THE EVIDENCE IS, AND WHY IT IS LOCKED ──────────────────────────────────────
//
// docs/audit/findings/*.json is EVIDENCE. Each finding cites a line of the Atari source
// and a line of ours, with the verbatim text of each — proof the auditor actually opened
// the code and read the line, rather than inventing a finding. Its whole value is that it
// is IMMUTABLE. Edit it to fit the code and you have laundered a guess into evidence,
// which is the one thing the audit exists to prevent.
//
// But the code the audit indicts must CHANGE — that is the point of an audit. rb4-1
// corrected ~30 constants and added a radix citation above each, which shifts every line
// below it. So the our-side check is pinned to the AUDIT COMMIT (see check-citations.mjs
// `oursRef`): every cited line is still re-opened and compared byte-for-byte against real
// content at a real commit, while the working tree is free to be fixed.
//
// That leaves exactly one way to cheat: edit the JSON. This file is the lock on that.
//
// ─── WHAT THIS FILE ACTUALLY GUARANTEES (and what it does not) ───────────────────────
//
// Read this list literally. It has been wrong twice, and a guard that reports more safety
// than it delivers is worse than no guard: it is a guard plus a false belief.
//
//   PINNED to the audit commit, per finding, for every finding that existed then:
//     · the finding still EXISTS            — you cannot delete an inconvenient finding
//     · `class`                             — you cannot RECLASSIFY one (see below)
//     · `ours`   (whole object, or null)    — you cannot re-point it at a friendlier line
//     · `source` (whole object)             — ditto on the Atari side, which CI cannot
//                                             byte-check (the source is a separate checkout
//                                             and is not in this repo), so the pin is its
//                                             ONLY protection
//
//   CHECKED, for every finding on disk (old or newly added):
//     · `ours.verbatim` still matches the code AS AUDITED, byte-for-byte
//     · no key outside the schema, AT ANY DEPTH (see optOutKeys)
//
//   NOT pinned, deliberately: `title`, `claim`, `reasoning`, `recommendation`, `size`,
//   `verdict`, `coverage_review`. These are the auditor's JUDGEMENT and its follow-up
//   workflow, not the evidence; a later story may legitimately amend them. They gate
//   nothing. If one of them ever starts gating something, it must move into PINNED_KEYS
//   the same day.
//
// ─── THE HOLE THIS REWORK CLOSES (Reviewer finding 3, rb4-1 REWORK 3) ────────────────
//
// Rework 2 asked "does this finding carry a key it shouldn't?" The real question is
// "does this finding still have to be CHECKED AT ALL?" It did not ask that, and so:
//
//   check-citations.mjs   `if (f.class === 'NO_COUNTERPART')` → skips the verbatim check
//                          entirely and merely requires `ours === null`.
//   this file (rework 2)  `allFindings().filter((f) => f.ours !== null)` → a null-`ours`
//                          finding was skipped here too.
//
// So: flip any inconvenient finding to {class: 'NO_COUNTERPART', ours: null} and BOTH
// gates wave it through — functionally identical to deleting its evidence, using only
// keys the schema permits, so the opt-out detector never fires either. This was not a
// theory; it was measured on the real EN-001, and the suite reported 18/18 green.
//
// Nothing compared a finding to WHAT IT WAS AT THE AUDIT. That is now the first thing
// this file does, and it is why the pin above exists.

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error — plain .mjs helper, no types needed
import { checkFindings } from '../../tools/audit/check-citations.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const findingsDir = join(repoRoot, 'docs', 'audit', 'findings')
const FINDINGS_PATH = 'docs/audit/findings'

/**
 * The commit the audit was taken against: the squash of PR #20 on develop, and the base
 * of this story's branch. Every `ours` citation in docs/audit/findings/ describes the
 * code as it stood HERE, and every finding is pinned to what it SAID here. This is the
 * evidence's frame of reference; it does not move.
 */
const AUDIT_COMMIT = '6038a07b9044f1add37fd12c217cd39ec1629439'

// ─────────────────────────────────────────────────────────────────────────────────────
// git, with its failures TOLD APART (Reviewer finding 6)
//
// Every git call here used to sit behind a bare `catch {}`, which answers four different
// questions with one shrug:
//
//   git is not installed        (ENOENT)                — I could not check
//   git cannot be executed      (EACCES)                — I could not check
//   this is not a git repo      (wrong cwd)             — I could not check
//   git ran and said "no"       (the object isn't here) — I CHECKED
//
// Only the last is a fact about the evidence. Collapsing the other three into it is how a
// broken PATH turns into ~154 confident "the audited file does not exist" citation
// failures — a truth-claim about evidence, manufactured out of an environment fault. This
// gate's entire job is to never confuse "I could not check" with "I checked."
// ─────────────────────────────────────────────────────────────────────────────────────

interface ExecError {
  readonly code?: string
  readonly status?: number
  readonly stderr?: Buffer | string
}
type GitFailKind = 'git-missing' | 'no-permission' | 'not-a-repo' | 'git-said-no'
type GitResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly kind: GitFailKind; readonly detail: string; readonly stderr: string }

function runGit(args: readonly string[]): GitResult {
  try {
    const stdout = execFileSync('git', [...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      // stderr is PIPED, not ignored: it is the only thing that distinguishes the cases.
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, stdout }
  } catch (err: unknown) {
    const e = err as ExecError
    const stderr = String(e.stderr ?? '')
    const fail = (kind: GitFailKind, detail: string): GitResult => ({ ok: false, kind, detail, stderr })

    if (e.code === 'ENOENT') return fail('git-missing', '`git` is not installed, or not on PATH')
    if (e.code === 'EACCES' || e.code === 'EPERM') {
      return fail('no-permission', '`git` is present but cannot be executed (permission denied)')
    }
    if (/not a git repository|dubious ownership/i.test(stderr)) {
      return fail('not-a-repo', `git will not operate on ${repoRoot}: ${stderr.trim()}`)
    }
    if (/permission denied|cannot open|unable to read/i.test(stderr)) {
      return fail('no-permission', `git could not read the repository: ${stderr.trim()}`)
    }
    return fail('git-said-no', stderr.trim() || `git exited ${e.status ?? '?'}`)
  }
}

/** Run git, or die telling the truth about why we could not. */
function gitOrThrow(args: readonly string[]): string {
  const r = runGit(args)
  if (r.ok) return r.stdout
  throw new Error(
    `cannot read the audit evidence from git (\`git ${args.join(' ')}\`) — so the evidence ` +
      `lock CANNOT RUN.\n  Cause (${r.kind}): ${r.detail}\n` +
      `  This is an ENVIRONMENT fault, not a verdict on the findings. Do not "fix" the findings.`,
  )
}

/** git said "no such path at that commit" — as opposed to any other reason for exiting non-zero. */
const PATH_ABSENT = /does not exist in|exists on disk, but not in|no such path/i

interface CommitStatus {
  readonly reachable: boolean
  readonly kind: 'reachable' | 'absent' | GitFailKind
  readonly detail: string
}

/**
 * Why the audit commit is or is not usable here.
 *
 * rb4-1 REWORK — this used to be `describe.skipIf(!haveAuditCommit)`, and that was worse
 * than having no lock at all. Under `actions/checkout`'s default `fetch-depth: 1` the audit
 * commit is not in the clone, so in CI — the ONE place this runs unattended, and the one
 * place someone could quietly push edited evidence — the whole anti-tamper block SILENTLY
 * SKIPPED. "I could not check" and "I checked, and it is clean" looked identical in the log.
 *
 * It now FAILS LOUDLY, and says WHICH of the four failures it hit, because "run
 * `git fetch --unshallow`" is useless advice to someone who has no git binary.
 */
function auditCommitStatus(): CommitStatus {
  const r = runGit(['cat-file', '-e', `${AUDIT_COMMIT}^{commit}`])
  if (r.ok) return { reachable: true, kind: 'reachable', detail: '' }
  if (r.kind === 'git-said-no') {
    return {
      reachable: false,
      kind: 'absent',
      detail:
        `git ran, and this clone's object database has no commit ${AUDIT_COMMIT.slice(0, 7)}. ` +
        `This is a SHALLOW CLONE, not a clean bill of health — run \`git fetch --unshallow\` ` +
        `(CI uses fetch-depth: 0).`,
    }
  }
  return { reachable: false, kind: r.kind, detail: r.detail }
}

/** A file's contents at the audit commit. `null` ONLY when git says the path was absent there. */
const blobCache = new Map<string, readonly string[] | null>()
function linesAtAuditCommit(file: string): readonly string[] | null {
  if (!blobCache.has(file)) {
    const r = runGit(['show', `${AUDIT_COMMIT}:${file}`])
    if (r.ok) {
      blobCache.set(file, r.stdout.split('\n'))
    } else if (r.kind === 'git-said-no' && PATH_ABSENT.test(r.stderr)) {
      blobCache.set(file, null) // a real fact about the evidence: the file did not exist then
    } else {
      throw new Error(
        `cannot read ${file} at the audit commit — the evidence lock CANNOT RUN.\n` +
          `  Cause (${r.kind}): ${r.detail}\n` +
          `  Reporting this as "the audited file does not exist" would invent a citation ` +
          `failure out of a broken environment.`,
      )
    }
  }
  return blobCache.get(file) ?? null
}

// ─────────────────────────────────────────────────────────────────────────────────────
// The findings — raw, on both sides of the pin
// ─────────────────────────────────────────────────────────────────────────────────────

type RawFinding = Record<string, unknown>

/**
 * The findings EXACTLY as they sit on disk — every key, nothing dropped.
 *
 * rb4-1 REWORK 2. Validation and tamper-detection are different jobs and must not share a
 * projection: a validator's job is to throw away what it does not understand, and a
 * tamper-detector's job is to NOTICE it. Routing the opt-out canary through a validator is
 * what made the canary vacuous. Anything hunting for keys that should not be there, or
 * comparing a finding to its audited self, must read from HERE.
 */
function allRawFindings(): readonly RawFinding[] {
  if (!existsSync(findingsDir)) return []
  return readdirSync(findingsDir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      const parsed: unknown = JSON.parse(readFileSync(join(findingsDir, f), 'utf8'))
      if (!Array.isArray(parsed)) throw new Error(`${f}: expected an array of findings`)
      return parsed as RawFinding[]
    })
}

/**
 * The findings AS COMMITTED AT THE AUDIT — read from git, never from disk.
 *
 * The file list comes from `git ls-tree` at that commit, not from readdir: a tamperer who
 * can edit a findings file can also delete or rename one, and a lock that only looks at the
 * files still present cannot notice the one that isn't.
 */
function rawFindingsAtAuditCommit(): readonly RawFinding[] {
  return gitOrThrow(['ls-tree', '--name-only', AUDIT_COMMIT, `${FINDINGS_PATH}/`])
    .split('\n')
    .map((s) => s.trim())
    .filter((f) => f.endsWith('.json'))
    .flatMap((file) => {
      const parsed: unknown = JSON.parse(gitOrThrow(['show', `${AUDIT_COMMIT}:${file}`]))
      if (!Array.isArray(parsed)) throw new Error(`${file}@audit: expected an array of findings`)
      return parsed as RawFinding[]
    })
}

// ─────────────────────────────────────────────────────────────────────────────────────
// Detector 1 — keys that should not exist, AT ANY DEPTH
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The audit finding SCHEMA — every key a finding is permitted to carry, at every level.
 *
 * This is an ALLOWLIST, and that is deliberate. The check it replaced was a denylist of six
 * words (`skip`, `skipOurs`, `stale`, `ignore`, `fixed`, `obsolete`), which asks the auditor
 * to have guessed the vocabulary of whoever eventually wants to dodge the gate. They will
 * pick a seventh word. An allowlist does not care what the word is: a finding may say the
 * eleven things a finding says, and anything else is a finding trying to tell the gate what
 * to do, which is not a finding's job.
 *
 * It is now RECURSIVE (Reviewer finding 3b). Rework 2 walked `Object.keys(raw)` and stopped
 * — TOP LEVEL ONLY — so `"ours": {..., "skip": true}` was invisible to it, while this
 * file's own header claimed such a key was caught. Nothing branched on a nested flag, so the
 * hole was inert; the FALSE CLAIM was the bug. `ours` and `source` are closed sets of exactly
 * {file, line, verbatim}, and any key under a scalar field (e.g. `title.skip`) is likewise
 * caught, because its schema shape is closed and admits nothing.
 *
 * Adding a key here is a deliberate schema change. That friction is the feature.
 */
const SCHEMA_KEYS: ReadonlySet<string> = new Set([
  'id',
  'class',
  'title',
  'claim',
  'reasoning',
  'source',
  'ours',
  'coverage_review',
  'recommendation',
  'size',
  'verdict',
])

interface Shape {
  readonly keys: ReadonlySet<string>
  readonly children: Readonly<Record<string, Shape>>
}
/** A citation — `ours` and `source` — is EXACTLY these three keys and nothing else. */
const CITATION_SHAPE: Shape = { keys: new Set(['file', 'line', 'verbatim']), children: {} }
/** Nothing may live here. Any object reached under a scalar field is wholly illegal. */
const CLOSED_SHAPE: Shape = { keys: new Set<string>(), children: {} }
const FINDING_SHAPE: Shape = {
  keys: SCHEMA_KEYS,
  children: { ours: CITATION_SHAPE, source: CITATION_SHAPE },
}

function walkKeys(node: unknown, shape: Shape, path: string, out: string[]): void {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((el, i) => walkKeys(el, shape, `${path}[${i}]`, out))
    return
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const here = path ? `${path}.${k}` : k
    if (!shape.keys.has(k)) {
      out.push(here) // report the intruder once; do not rain its children down as well
      continue
    }
    walkKeys(v, shape.children[k] ?? CLOSED_SHAPE, here, out)
  }
}

/**
 * The escape-hatch detector: keys present on a RAW finding that the schema does not permit,
 * at any depth. Paths are dotted (`ours.skip`); top-level keys are bare (`skip`).
 *
 * Takes raw parsed JSON — NEVER a validated/narrowed projection: you cannot notice a key you
 * have already thrown away. Keeping this a pure function of its input is what lets the tests
 * below prove it works, on findings that exist only in memory, without laying a finger on the
 * evidence.
 */
function optOutKeys(raws: readonly RawFinding[]): readonly string[] {
  const out: string[] = []
  for (const raw of raws) walkKeys(raw, FINDING_SHAPE, '', out)
  return out
}

// ─────────────────────────────────────────────────────────────────────────────────────
// Detector 2 — a finding that is no longer the finding it was (Reviewer finding 3a)
// ─────────────────────────────────────────────────────────────────────────────────────

/** Order-insensitive canonical form, so a re-keyed object is not mistaken for a changed one. */
function canonical(v: unknown): string {
  if (v === undefined) return 'undefined'
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`
}

/**
 * The keys that ARE the evidence, and therefore cannot move.
 *
 * `class` decides WHETHER a finding is checked at all (NO_COUNTERPART is exempt from the
 * verbatim check by design — it has no line of ours to cite). `ours` and `source` are the
 * citations themselves. Everything else in a finding is judgement, and judgement may be
 * revised; these three are what the auditor SAW, and what they saw does not change.
 */
const PINNED_KEYS = ['class', 'ours', 'source'] as const

/**
 * Diff the findings on disk against the findings AS COMMITTED AT THE AUDIT.
 *
 * Pure, and total over its two inputs, so it can be tamper-tested in memory against
 * findings that never touch the disk.
 */
function evidenceDrift(
  audited: readonly RawFinding[],
  current: readonly RawFinding[],
): readonly string[] {
  const drift: string[] = []

  // Uniqueness is checked HERE, not borrowed from checkFindings — this detector must not
  // depend on the checker it exists to back up (Reviewer finding 5). Without this, a
  // tamperer who has already neutralised checkFindings could append a SECOND copy of a
  // finding, laundered, and the lookup below would happily compare the pristine first copy
  // to the audit and report no drift while the shadow sat next to it on disk.
  const now = new Map<string, RawFinding>()
  for (const f of current) {
    const id = String(f.id)
    if (now.has(id)) {
      drift.push(
        `${id}: appears MORE THAN ONCE on disk. A finding has exactly one entry; a second ` +
          `copy shadows the first for anything that reads by id.`,
      )
      continue
    }
    now.set(id, f)
  }

  for (const was of audited) {
    const id = String(was.id)
    const is = now.get(id)
    if (is === undefined) {
      drift.push(
        `${id}: the finding has been DELETED since the audit. Findings are evidence; an ` +
          `inconvenient one is not retracted, it is answered.`,
      )
      continue
    }
    for (const key of PINNED_KEYS) {
      if (canonical(was[key]) === canonical(is[key])) continue
      drift.push(
        `${id}: \`${key}\` has been CHANGED since the audit.\n` +
          `  at the audit: ${canonical(was[key])}\n` +
          `  on disk now:  ${canonical(is[key])}\n` +
          (key === 'class'
            ? `  -> Reclassifying a finding is how you make the gate stop checking it: a\n` +
              `     NO_COUNTERPART with \`ours: null\` is exempt from the verbatim check BY\n` +
              `     DESIGN (check-citations.mjs, the \`--- ours side\` block), so relabelling one\n` +
              `     is functionally identical to deleting its evidence — using only keys the\n` +
              `     schema permits. If the audit's classification is genuinely wrong, that is a\n` +
              `     finding about the audit: say so out loud, do not edit the record.`
            : `  -> That is the citation itself — the proof the auditor opened our code and read\n` +
              `     the line. Re-pointing it at a friendlier line launders a guess into evidence.\n` +
              `     Fix the CODE, not the finding.`),
      )
    }
  }
  return drift
}

// ─────────────────────────────────────────────────────────────────────────────────────

describe('the audit evidence is frozen at the commit it was taken against', () => {
  it('the audit commit is reachable — the evidence lock must RUN, never silently skip', () => {
    const st = auditCommitStatus()
    expect(
      st.reachable,
      `the evidence lock cannot run (${st.kind}): ${st.detail}`,
    ).toBe(true)
    expect(linesAtAuditCommit('src/core/guns.ts')).not.toBeNull()
  })

  it('no finding has been DELETED or RECLASSIFIED since the audit — `class`, `ours`, `source` are pinned', () => {
    // ─── THE HOLE THIS TEST EXISTS TO CLOSE (Reviewer finding 3a) ────────────────────
    //
    // Every other check in this repo interrogates a finding IN ISOLATION: does its cited
    // line say what it claims? None of them ever asked the prior question — is this still
    // the finding the auditor wrote? So the cheapest laundering was never touching a
    // citation at all: relabel the finding {class: 'NO_COUNTERPART', ours: null} and every
    // gate stops looking at it. Measured on the real EN-001: checkFindings returned ZERO
    // errors and the suite went 18/18 green.
    //
    // This is the only check in the suite with a MEMORY. Everything else compares a finding
    // to the code; this compares a finding to ITSELF, as it was at 6038a07.
    const st = auditCommitStatus()
    if (!st.reachable) throw new Error(`the evidence lock cannot run (${st.kind}): ${st.detail}`)

    const audited = rawFindingsAtAuditCommit()
    expect(audited.length, 'the audit commit must carry the findings').toBeGreaterThan(100)

    expect(evidenceDrift(audited, allRawFindings())).toEqual([])
  })

  it('EVERY `ours` citation still matches the code AS AUDITED — the evidence is not laundered', () => {
    // ─── THIS BYTE COMPARISON IS DELIBERATELY INDEPENDENT (Reviewer finding 5) ───────
    //
    // It re-implements, from scratch, the comparison that check-citations.mjs also makes.
    // That duplication is NOT an oversight and MUST NOT be refactored to call
    // checkFindings(): checkFindings is a single point of failure for tests/audit/
    // citations.test.ts — one line of `if (f.verdict === 'exempt') continue`, using a key
    // the schema already permits, silently neutralises every citation test in that file at
    // once. The only reason the suite survives that edit is that the comparison ALSO happens
    // here, over the real findings, through code that shares nothing with the checker.
    //
    // Two independent implementations must both be subverted to launder a finding. Collapse
    // them into one and the cost of cheating drops back to a single line.
    //
    // (The teeth of checkFindings itself are re-proved below, behaviourally — not by
    // grepping its source, which is what rework 2 did and which stays green over dead code.)
    const st = auditCommitStatus()
    if (!st.reachable) throw new Error(`the evidence lock cannot run (${st.kind}): ${st.detail}`)

    const findings = allRawFindings()
    expect(findings.length, 'the audit should have findings to check').toBeGreaterThan(100)

    const laundered: string[] = []
    for (const f of findings) {
      const id = String(f.id)
      const ours = f.ours
      // A null `ours` is only legitimate for a finding that was ALREADY null at the audit —
      // and the pin above is what proves that. This loop deliberately does not re-litigate it.
      if (ours === null || ours === undefined) continue
      if (typeof ours !== 'object') {
        laundered.push(`${id}: \`ours\` is not an object`)
        continue
      }
      const o = ours as Record<string, unknown>
      if (typeof o.file !== 'string' || typeof o.line !== 'number' || typeof o.verbatim !== 'string') {
        laundered.push(`${id}: \`ours\` needs {file: string, line: number, verbatim: string}`)
        continue
      }
      const lines = linesAtAuditCommit(o.file)
      if (lines === null) {
        laundered.push(`${id}: ${o.file} did not exist at the audit commit`)
        continue
      }
      const actual = lines[o.line - 1]
      if (actual === undefined) {
        laundered.push(`${id}: ${o.file}:${o.line} did not exist at the audit commit`)
      } else if (actual.trimEnd() !== o.verbatim.trimEnd()) {
        laundered.push(
          `${id}: ${o.file}:${o.line} no longer matches the AUDITED line.\n` +
            `  finding says:   ${JSON.stringify(o.verbatim)}\n` +
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
  it('no finding has been given an opt-out flag to dodge the gate', () => {
    // The cheap escape: add `"skip": true` / `"stale": true` to the findings that break. The
    // gate is worth nothing if a finding can excuse itself from it.
    //
    // Read RAW (see `allRawFindings`). This test used to run over a VALIDATED projection whose
    // every element had been rebuilt as a fresh {id, class, ours} literal — so `Object.keys`
    // could only ever return those three, and the assertion was STRUCTURALLY INCAPABLE OF
    // FAILING while reporting green. The proof it has teeth now is the test below, and that is
    // not decoration: it is the only reason you may believe this line.
    const escapes = optOutKeys(allRawFindings())
    expect(
      escapes,
      'a finding is carrying a key that is not part of the audit schema. The cheap way to make ' +
        'this gate green is to excuse a finding from it; that is what this catches.',
    ).toEqual([])
  })

  it('…and the opt-out check CAN ACTUALLY FAIL, at any depth — the canary is alive', () => {
    // ─── WHY THIS TEST EXISTS ────────────────────────────────────────────────────────
    //
    // The guard above was vacuous for an entire review cycle and the suite stayed green over
    // it, because nothing ever asked the only question that matters about a guard:
    //
    //     "if the thing you are guarding against HAPPENED, would you notice?"
    //
    // A guard is a claim about a case that must not occur. If the case never occurs in the
    // fixture, the guard's passing tells you NOTHING — it is indistinguishable from a guard
    // that has quietly stopped working. So we manufacture the case, on a SYNTHETIC finding
    // that never touches docs/audit/findings/.
    const real = allRawFindings()[0]
    expect(real, 'there must be real findings to model the tamper on').toBeDefined()

    // Every escape the old denylist named…
    for (const escape of ['skip', 'skipOurs', 'stale', 'ignore', 'fixed', 'obsolete']) {
      expect(
        optOutKeys([{ ...real, [escape]: true }]),
        `a finding carrying \`"${escape}": true\` MUST be caught. If this passes, the gate can ` +
          `be dodged by writing one word into a JSON file.`,
      ).toContain(escape)
    }

    // …and — because an allowlist is strictly stronger than a denylist — escapes nobody
    // thought to name. The old check enumerated six words; a tamperer picks a seventh.
    for (const unnamed of ['waived', 'exempt', 'wontfix', 'accepted', 'suppress']) {
      expect(
        optOutKeys([{ ...real, [unnamed]: true }]),
        `an opt-out named \`${unnamed}\` must be caught too — the gate must not depend on the ` +
          `auditor having guessed the tamperer's vocabulary.`,
      ).toContain(unnamed)
    }

    // NESTED (Reviewer finding 3b). Rework 2 walked the top level only, so every one of these
    // was invisible — while this file's header claimed they were caught. Nothing branched on a
    // nested flag, so the hole was inert; the false claim was the bug. Both are now fixed.
    const ours = real.ours as Record<string, unknown>
    const source = real.source as Record<string, unknown>
    expect(optOutKeys([{ ...real, ours: { ...ours, skip: true } }]), 'nested `ours.skip`').toContain(
      'ours.skip',
    )
    expect(optOutKeys([{ ...real, ours: { ...ours, stale: true } }]), 'nested `ours.stale`').toContain(
      'ours.stale',
    )
    expect(
      optOutKeys([{ ...real, source: { ...source, ignore: true } }]),
      'nested `source.ignore`',
    ).toContain('source.ignore')

    // …at ANY depth, including a whole object smuggled under a field the schema says is a
    // string. Its shape is closed, so everything inside it is illegal.
    expect(optOutKeys([{ ...real, title: { skip: true } }]), 'an object under a scalar field').toContain(
      'title.skip',
    )

    // And the negative: a clean finding must NOT be flagged, or the guard is a smoke alarm
    // that screams at toast and gets unplugged.
    expect(optOutKeys([real])).toEqual([])
  })

  it('…and the RECLASSIFICATION check CAN ACTUALLY FAIL — proved on the exact bypass that shipped', () => {
    // The measured attack, re-run in memory. EN-001 is a BOOK_WAS_WRONG with a real `ours`
    // citation. Relabel it NO_COUNTERPART / ours: null and it is excused from every
    // verbatim check in the repo, using only keys the schema permits.
    //
    // This test asserts BOTH halves of that fact, because the second half is the whole
    // argument for the first: the tamper sails past the OTHER two gates, and is stopped only
    // by the pin. If someone later deletes `evidenceDrift` believing the allowlist or the
    // checker covers it, these assertions are the proof that it does not.
    const audited = rawFindingsAtAuditCommit()
    const real = audited.find((f) => f.id === 'EN-001')
    expect(real, 'EN-001 must exist at the audit commit — it is the modelled tamper').toBeDefined()
    expect(real?.class, 'EN-001 must have a class worth laundering').not.toBe('NO_COUNTERPART')
    expect(real?.ours, 'EN-001 must have an `ours` citation worth laundering').not.toBeNull()

    const tampered: RawFinding = { ...(real as RawFinding), class: 'NO_COUNTERPART', ours: null }
    const laundered = audited.map((f) => (f.id === 'EN-001' ? tampered : f))

    // 1. The opt-out allowlist does NOT catch it — `class` and `ours` are legal keys.
    expect(
      optOutKeys([tampered]),
      'the allowlist cannot see this: the tamperer used only permitted keys',
    ).toEqual([])

    // 2. The citation checker does NOT catch it — NO_COUNTERPART is exempt from the verbatim
    //    check by design, and `ours: null` satisfies the one rule it does apply.
    expect(
      checkFindings(laundered, { repoRoot, sourceDir: null, oursRef: AUDIT_COMMIT }),
      'if this is ever non-empty the checker has grown a memory of the audit, and the comment ' +
        'above should be rewritten — but it has not, and that is why the pin below must exist',
    ).toEqual([])

    // 3. The pin DOES catch it. This is the assertion that reddens if evidenceDrift loses its
    //    teeth (drop `class` from PINNED_KEYS and this line fails).
    const drift = evidenceDrift(audited, laundered)
    expect(drift.join('\n'), 'a reclassified finding MUST be caught').toMatch(
      /EN-001: `class` has been CHANGED/,
    )

    // 4. And the vector that ONLY the `class` pin can see. The tamper above changes `ours`
    //    too (NO_COUNTERPART must have `ours: null`), so the `ours` pin would also have
    //    caught it. This one does not: DOWNGRADE the finding to CONFIRMED — "we already
    //    match the ROM" — leaving every citation byte-for-byte intact. Both citations still
    //    verify, the allowlist sees nothing, checkFindings is satisfied (CONFIRMED is the one
    //    class that needs no recommendation), and a DIVERGENCE the auditor raised against us
    //    has been silently retracted. Only a memory of what the finding SAID catches this.
    const downgraded = audited.map((f) => (f.id === 'EN-001' ? { ...f, class: 'CONFIRMED' } : f))
    expect(
      checkFindings(downgraded, { repoRoot, sourceDir: null, oursRef: AUDIT_COMMIT }),
      'the checker cannot see a downgrade — every citation still verifies',
    ).toEqual([])
    expect(
      evidenceDrift(audited, downgraded).join('\n'),
      'a finding DOWNGRADED to CONFIRMED with its citations left intact must be caught — this ' +
        'is the vector that the `ours` pin cannot see, and it is why `class` is pinned separately',
    ).toMatch(/EN-001: `class` has been CHANGED/)

    // The other two vectors the pin exists for.
    expect(
      evidenceDrift(audited, audited.filter((f) => f.id !== 'EN-001')).join('\n'),
      'a DELETED finding must be caught',
    ).toMatch(/EN-001: the finding has been DELETED/)

    const repointed = audited.map((f) =>
      f.id === 'EN-001'
        ? { ...f, ours: { file: 'src/core/guns.ts', line: 1, verbatim: 'anything' } }
        : f,
    )
    expect(
      evidenceDrift(audited, repointed).join('\n'),
      'an `ours` citation re-pointed at a friendlier line must be caught',
    ).toMatch(/EN-001: `ours` has been CHANGED/)

    const resourced = audited.map((f) =>
      f.id === 'EN-001' ? { ...f, source: { file: 'RBARON.MAC', line: 1, verbatim: 'x' } } : f,
    )
    expect(
      evidenceDrift(audited, resourced).join('\n'),
      'a re-pointed `source` citation must be caught — CI cannot byte-check the Atari source ' +
        '(it is a separate checkout, not in this repo), so this pin is its ONLY protection',
    ).toMatch(/EN-001: `source` has been CHANGED/)

    // A SHADOW COPY: append a second, laundered EN-001 and leave the pristine one in place.
    // A drift check that merely looked up each audited id would find the clean copy first and
    // report nothing. This detector must not lean on checkFindings' duplicate-id rule, because
    // the whole point of it is to survive checkFindings being neutralised.
    expect(
      evidenceDrift(audited, [...audited, tampered]).join('\n'),
      'a second, shadowing copy of a finding must be caught HERE, without help from the checker',
    ).toMatch(/EN-001: appears MORE THAN ONCE/)

    // And the negative: the real, untampered evidence drifts not at all.
    expect(evidenceDrift(audited, allRawFindings())).toEqual([])
  })

  it('checkFindings still has TEETH — proved by running it, not by grepping it', () => {
    // ─── Reviewer finding 5 ──────────────────────────────────────────────────────────
    //
    // This used to read check-citations.mjs as TEXT and assert it still contained the strings
    // "does not match verbatim" and "NO_COUNTERPART". A substring match over source code is
    // not a test: the words survive perfectly happily above dead code. One line —
    // `if (f.verdict === 'exempt') continue` — neutralises every citation check in
    // tests/audit/citations.test.ts at a stroke, using a key the schema ALREADY PERMITS, and
    // the old self-check would have gone right on passing.
    //
    // So: exercise the checker instead. Synthetic findings, in memory, never on disk.
    const laundered = {
      id: 'SYNTH-001',
      class: 'DIVERGENCE',
      title: 't',
      claim: 'c',
      reasoning: 'r',
      source: { file: 'RBARON.MAC', line: 1, verbatim: 'anything' },
      ours: { file: 'src/core/guns.ts', line: 1, verbatim: 'THIS IS NOT WHAT THE LINE SAID' },
      recommendation: 'fix',
      size: 's',
    }
    expect(
      checkFindings([laundered], { repoRoot, sourceDir: null, oursRef: AUDIT_COMMIT }).join('\n'),
      'the our-side byte comparison must still be enforced — it was not deleted to keep the ' +
        'gate green after the sweep',
    ).toMatch(/SYNTH-001: ours src\/core\/guns\.ts:1 does not match verbatim/)

    // THE NEUTRALISATION VECTOR, named and killed. `verdict` is a legal schema key, so a
    // one-line `continue` on it costs nothing and looks innocuous in a diff. If anyone adds
    // it — for `verdict`, or for any value this finding carries — this assertion goes red.
    expect(
      checkFindings([{ ...laundered, id: 'SYNTH-002', verdict: 'exempt' }], {
        repoRoot,
        sourceDir: null,
        oursRef: AUDIT_COMMIT,
      }).join('\n'),
      'a finding must NOT be able to excuse itself from the checker by carrying a verdict. If ' +
        'this is empty, someone has taught checkFindings to skip findings, and every citation ' +
        'test in citations.test.ts is now vacuous.',
    ).toMatch(/SYNTH-002: ours src\/core\/guns\.ts:1 does not match verbatim/)

    // NO_COUNTERPART is the exempt class — but it must EARN the exemption by having no `ours`.
    expect(
      checkFindings(
        [{ ...laundered, id: 'SYNTH-003', class: 'NO_COUNTERPART', recommendation: 'accept' }],
        { repoRoot, sourceDir: null, oursRef: AUDIT_COMMIT },
      ).join('\n'),
      'NO_COUNTERPART must still be the only class allowed to omit `ours`, and must actually omit it',
    ).toMatch(/SYNTH-003: NO_COUNTERPART requires `ours` to be null/)

    // A citation to a line that never existed at the audit commit is a fabrication.
    expect(
      checkFindings(
        [{ ...laundered, id: 'SYNTH-004', ours: { file: 'src/core/guns.ts', line: 999999, verbatim: 'x' } }],
        { repoRoot, sourceDir: null, oursRef: AUDIT_COMMIT },
      ).join('\n'),
    ).toMatch(/SYNTH-004: ours src\/core\/guns\.ts:999999 does not exist/)

    // And the negative: a finding that cites the audited line CORRECTLY must pass, or the
    // checker is a smoke alarm that screams at toast.
    const audited = linesAtAuditCommit('src/core/guns.ts')
    expect(audited).not.toBeNull()
    expect(
      checkFindings(
        [
          {
            ...laundered,
            id: 'SYNTH-005',
            ours: { file: 'src/core/guns.ts', line: 1, verbatim: (audited as readonly string[])[0] },
          },
        ],
        { repoRoot, sourceDir: null, oursRef: AUDIT_COMMIT },
      ),
    ).toEqual([])
  })
})

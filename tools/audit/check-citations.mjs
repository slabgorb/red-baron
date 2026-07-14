import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { LINKED_MODULES } from './linked-modules.mjs'

const CLASSES = ['DIVERGENCE', 'CONFIRMED', 'BOOK_WAS_WRONG', 'STRUCTURAL', 'NO_COUNTERPART']
const RECOMMENDATIONS = ['fix', 'accept', 'wont_fix']
const SIZES = ['s', 'm', 'l']

const lineCache = new Map()
function lineAt(path, n) {
  if (!lineCache.has(path)) {
    if (!existsSync(path)) return undefined
    lineCache.set(path, readFileSync(path, 'utf8').split('\n'))
  }
  return lineCache.get(path)[n - 1]
}

/**
 * Run git and CLASSIFY how it failed.
 *
 * rb4-1 REWORK 3 (Reviewer finding 6). Every git call in this file used to sit behind a
 * bare `catch {}`, which collapses four different worlds into one answer:
 *
 *   - git is not installed          (ENOENT)                — an environment fault
 *   - git cannot be executed        (EACCES)                — an environment fault
 *   - cwd is not a git repository   (wrong wiring)          — a programming fault
 *   - git ran fine and said "no"    (the object isn't here) — the only one that is a fact
 *                                                             about the evidence
 *
 * Only the last may be reported as a finding about the citations. The first three mean
 * "I COULD NOT CHECK", and the entire reason this gate exists is that it must never
 * launder "I could not check" into "I checked." The bare catch laundered it in BOTH
 * directions: a missing git binary produced ~150 bogus "does not exist at the audit
 * commit" citation failures (a truth-claim about evidence, manufactured out of a broken
 * PATH), and a wrong cwd would have done the same.
 *
 * @returns {{ok: true, stdout: string}
 *         | {ok: false, kind: 'git-missing'|'no-permission'|'not-a-repo'|'git-said-no',
 *            status: number|null, stderr: string, detail: string}}
 */
function runGit(args, cwd) {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      // stderr is PIPED, not ignored: it is the only thing that tells us WHICH failure
      // this is. Throwing it away is what made the four cases indistinguishable.
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, stdout }
  } catch (err) {
    const stderr = String(err.stderr ?? '')
    const status = typeof err.status === 'number' ? err.status : null
    const fail = (kind, detail) => ({ ok: false, kind, status, stderr, detail })

    // The spawn itself failed — git never ran, so it never said anything about our repo.
    if (err.code === 'ENOENT') return fail('git-missing', '`git` is not installed, or not on PATH')
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      return fail('no-permission', '`git` is present but cannot be executed (permission denied)')
    }

    // git ran, and refused. Its own words are the classifier.
    if (/not a git repository|dubious ownership/i.test(stderr)) {
      return fail('not-a-repo', `git will not operate on \`${cwd}\`: ${stderr.trim()}`)
    }
    if (/permission denied|cannot open|unable to read/i.test(stderr)) {
      return fail('no-permission', `git could not read the repository: ${stderr.trim()}`)
    }
    return fail('git-said-no', stderr.trim() || `git exited ${status}`)
  }
}

/** git said "no such path at that commit" — as opposed to any other reason for exiting non-zero. */
const PATH_ABSENT = /does not exist in|exists on disk, but not in|no such path/i

/**
 * A file's lines as they stood at a git ref — the audit's frame of reference.
 *
 * The `ours` citations are a SNAPSHOT: proof the auditor actually opened our code and
 * read the line, rather than inventing a finding. Their value is that they are immutable.
 * But the whole point of an audit is that the code it indicts then CHANGES — rb4-1
 * corrected ~30 constants and added a citation comment above each, which shifts every
 * line below it. Checking `ours` against the working tree therefore turns the gate red
 * for doing exactly what the audit asked.
 *
 * Repairing the findings to match the new code is not an option: it would launder a guess
 * into evidence, which is the one thing this checker exists to prevent. So we pin the
 * our-side check to the commit the audit was TAKEN against. The anti-fabrication
 * guarantee is untouched — the line is still checked, byte-for-byte, against real content
 * at a real commit — while the code is free to be fixed.
 *
 * Returns `undefined` ONLY when git ran and told us the path is absent at that commit.
 * Any other failure THROWS: "I could not read the evidence" is not "the evidence is bad."
 */
const refCache = new Map()
function lineAtRef(ref, file, n, cwd) {
  const key = `${ref}:${file}`
  if (!refCache.has(key)) {
    // `cwd` is mandatory: without it git resolves against process.cwd(), which in another
    // working directory is a DIFFERENT repository — and a coincidentally-matching path
    // there would FALSELY VERIFY a citation. That is the exact failure this gate exists
    // to prevent, so the gate must not be able to commit it.
    const r = runGit(['show', key], cwd)
    if (r.ok) {
      refCache.set(key, r.stdout.split('\n'))
    } else if (r.kind === 'git-said-no' && PATH_ABSENT.test(r.stderr)) {
      // The ref itself is known-reachable by here (checkFindings preflights it), and git
      // has now told us, in its own words, that this PATH did not exist at that commit.
      // That is a real fact about the evidence.
      refCache.set(key, null)
    } else {
      throw new Error(
        `cannot read \`${key}\` from the repository at ${cwd} — so the our-side citations ` +
          `CANNOT BE VERIFIED.\n` +
          `  Cause (${r.kind}): ${r.detail}\n` +
          `  This is NOT a citation failure. Reporting it as one would invent ~150 findings ` +
          `about the evidence out of a broken environment.`,
      )
    }
  }
  const lines = refCache.get(key)
  return lines === null ? undefined : lines[n - 1]
}

/**
 * Why `ref` is or is not usable in this clone.
 *
 * It very often is not: `actions/checkout` defaults to `fetch-depth: 1`, so CI gets a
 * single-commit clone in which the audit commit does not exist. Without this preflight,
 * every `git show` fails and the gate reports "does not exist" for all ~150 findings —
 * 150 errors that all point at the wrong thing and bury the one real cause.
 *
 * "I could not check" must never be reported as "I checked, and it is wrong."
 *
 * @returns {{reachable: boolean, kind: 'reachable'|'absent'|'git-missing'|'no-permission'|'not-a-repo', detail: string}}
 */
export function refStatus(ref, cwd) {
  const r = runGit(['cat-file', '-e', `${ref}^{commit}`], cwd)
  if (r.ok) return { reachable: true, kind: 'reachable', detail: '' }
  if (r.kind === 'git-said-no') {
    return {
      reachable: false,
      kind: 'absent',
      detail: `git ran, and this clone's object database has no commit ${ref}`,
    }
  }
  return { reachable: false, kind: r.kind, detail: r.detail }
}

/** Is `ref` actually in this clone's object database? (see refStatus for WHY it is not) */
export function refReachable(ref, cwd) {
  return refStatus(ref, cwd).reachable
}

/** One error line that names the TRUE cause, so nobody is sent to fix the wrong thing. */
function unusableRefError(ref, st) {
  const head =
    `the our-side citations CANNOT BE VERIFIED against ${ref} ` +
    `(this is NOT a citation failure — nothing is wrong with the findings).\n`
  switch (st.kind) {
    case 'git-missing':
      return (
        head +
        `  Cause:  ${st.detail}. The gate shells out to git to read the audited code.\n` +
        `  Fix:    install git / put it on PATH. Do NOT "fix" the findings.`
      )
    case 'no-permission':
      return (
        head +
        `  Cause:  ${st.detail}.\n` +
        `  Fix:    repair the permissions on the repo (or on the git binary). The clone is ` +
        `not shallow and the findings are not wrong — they are unreadable.`
      )
    case 'not-a-repo':
      return (
        head +
        `  Cause:  ${st.detail}.\n` +
        `  Fix:    pass the red-baron repo root as \`repoRoot\`. Resolving against the wrong ` +
        `repository could FALSELY VERIFY a citation, so the gate refuses to guess.`
      )
    default:
      return (
        head +
        `  Cause:  a shallow clone — ${st.detail}. \`actions/checkout\` defaults to fetch-depth: 1.\n` +
        `  Fix:    fetch the audit commit (CI: \`fetch-depth: 0\`), or run \`git fetch --unshallow\`.`
      )
  }
}

/**
 * Re-open every line a finding cites and compare it byte-for-byte against the
 * `verbatim` the auditor recorded. A finding that fails is DELETED, not repaired:
 * a miscited finding is one the auditor never actually verified, and repairing it
 * launders a guess into evidence.
 *
 * ─── WHAT THIS FUNCTION DOES NOT DO (rb4-1 REWORK 3, Reviewer finding 3) ─────────────
 *
 * It validates each finding IN ISOLATION, against the code. It has no memory of what the
 * finding SAID AT THE AUDIT. So it cannot, even in principle, notice a finding that has
 * been quietly reclassified — flip one to {class: 'NO_COUNTERPART', ours: null} and the
 * `--- ours side` block below skips the verbatim check by design, and reports nothing.
 * Measured, on the real EN-001: zero errors.
 *
 * That hole is closed OUTSIDE this file, by tests/audit/citation-evidence.test.ts, which
 * diffs the findings against the same findings AS COMMITTED AT THE AUDIT COMMIT. Do not
 * assume this checker is the gate; it is half of it.
 *
 * @param findings  array of finding objects
 * @param opts.repoRoot   absolute path to the red-baron repo
 * @param opts.sourceDir  absolute path to the LF Atari source, or null to skip
 *                        source-side byte checks (e.g. in CI, where it is absent
 *                        — the source is copyrighted and never enters the repo)
 * @param opts.oursRef    git ref the audit was taken against. When given, `ours` lines
 *                        are read from that commit instead of the working tree, so the
 *                        evidence stays verifiable after the code it indicts is fixed.
 *                        Omit to check against the working tree (the pre-rb4-1 behaviour).
 * @returns array of error strings; empty means every finding is valid
 * @throws  if the repository cannot be read at all — an unreadable repo is an environment
 *          fault, and must not be dressed up as a verdict on the evidence.
 */
export function checkFindings(findings, { repoRoot, sourceDir, oursRef = null }) {
  const errors = []
  const seen = new Set()

  // Preflight the ref ONCE. An unusable audit commit is an ENVIRONMENT problem, not ~150
  // bad citations, and it must say so in one line — naming WHICH environment problem.
  if (oursRef) {
    const st = refStatus(oursRef, repoRoot)
    if (!st.reachable) return [unusableRefError(oursRef, st)]
  }

  for (const f of findings) {
    const id = f.id ?? '(missing id)'

    if (!f.id) errors.push('a finding has no id')
    else if (seen.has(f.id)) errors.push(`duplicate id: ${f.id}`)
    else seen.add(f.id)

    if (!CLASSES.includes(f.class)) {
      errors.push(`${id}: class must be one of ${CLASSES.join('|')}, got ${JSON.stringify(f.class)}`)
      continue
    }
    if (!f.title) errors.push(`${id}: missing title`)
    if (!f.claim) errors.push(`${id}: missing claim`)

    if (f.class !== 'CONFIRMED' && !RECOMMENDATIONS.includes(f.recommendation)) {
      errors.push(`${id}: recommendation must be one of ${RECOMMENDATIONS.join('|')}`)
    }
    if (f.recommendation === 'fix' && !SIZES.includes(f.size)) {
      errors.push(`${id}: recommendation=fix requires size (${SIZES.join('|')})`)
    }

    // --- source side
    if (!f.source?.file) {
      errors.push(`${id}: missing source citation`)
    } else {
      const mod = f.source.file.replace(/\.(MAC|XXX)$/i, '').toUpperCase()
      if (!LINKED_MODULES.includes(mod)) {
        errors.push(
          `${id}: cites ${f.source.file}, which never shipped ` +
            `(not reachable from the RBARON.MAP link string). Re-cite against the linked module.`,
        )
      } else if (sourceDir) {
        const actual = lineAt(join(sourceDir, f.source.file), f.source.line)
        if (actual === undefined) {
          errors.push(`${id}: source ${f.source.file}:${f.source.line} does not exist`)
        } else if (actual.trimEnd() !== String(f.source.verbatim).trimEnd()) {
          errors.push(
            `${id}: source ${f.source.file}:${f.source.line} does not match verbatim\n` +
              `  cited:  ${JSON.stringify(f.source.verbatim)}\n` +
              `  actual: ${JSON.stringify(actual)}`,
          )
        }
      }
    }

    // --- ours side
    //
    // NOTE the shape of this branch, and what it costs: NO_COUNTERPART is exempt from the
    // verbatim check because a finding with no counterpart HAS no line of ours to cite.
    // That is correct, and it is also a door — anyone who can edit the JSON can walk a
    // finding through it by relabelling. Nothing here can stop that (see the header).
    // citation-evidence.test.ts pins `class` and `ours` to the audit commit; that is what
    // stops it. Do not delete that test believing this one covers you.
    if (f.class === 'NO_COUNTERPART') {
      if (f.ours !== null) errors.push(`${id}: NO_COUNTERPART requires \`ours\` to be null`)
    } else if (!f.ours?.file) {
      errors.push(`${id}: class ${f.class} requires \`ours\` (only NO_COUNTERPART may omit it)`)
    } else {
      const at = oursRef ? `at ${oursRef}` : 'in the working tree'
      const actual = oursRef
        ? lineAtRef(oursRef, f.ours.file, f.ours.line, repoRoot)
        : lineAt(join(repoRoot, f.ours.file), f.ours.line)
      if (actual === undefined) {
        errors.push(`${id}: ours ${f.ours.file}:${f.ours.line} does not exist ${at}`)
      } else if (actual.trimEnd() !== String(f.ours.verbatim).trimEnd()) {
        errors.push(
          `${id}: ours ${f.ours.file}:${f.ours.line} does not match verbatim ${at}\n` +
            `  cited:  ${JSON.stringify(f.ours.verbatim)}\n` +
            `  actual: ${JSON.stringify(actual)}`,
        )
      }
    }
  }

  return errors
}

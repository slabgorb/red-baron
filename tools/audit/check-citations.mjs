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
 */
const refCache = new Map()
function lineAtRef(ref, file, n, cwd) {
  const key = `${ref}:${file}`
  if (!refCache.has(key)) {
    try {
      // `cwd` is mandatory: without it git resolves against process.cwd(), which in another
      // working directory is a DIFFERENT repository — and a coincidentally-matching path
      // there would FALSELY VERIFY a citation. That is the exact failure this gate exists
      // to prevent, so the gate must not be able to commit it.
      const blob = execFileSync('git', ['show', key], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      refCache.set(key, blob.split('\n'))
    } catch {
      // The ref itself is known-reachable by the time we get here (checkFindings preflights
      // it), so a failure here means the FILE genuinely did not exist at that commit.
      refCache.set(key, null)
    }
  }
  const lines = refCache.get(key)
  return lines === null ? undefined : lines[n - 1]
}

/**
 * Is `ref` actually in this clone's object database?
 *
 * It very often is not: `actions/checkout` defaults to `fetch-depth: 1`, so CI gets a
 * single-commit clone in which the audit commit does not exist. Without this preflight,
 * every `git show` fails and the gate reports "does not exist" for all ~150 findings —
 * 150 errors that all point at the wrong thing and bury the one real cause.
 *
 * "I could not check" must never be reported as "I checked, and it is wrong."
 */
export function refReachable(ref, cwd) {
  try {
    execFileSync('git', ['cat-file', '-e', `${ref}^{commit}`], { cwd, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Re-open every line a finding cites and compare it byte-for-byte against the
 * `verbatim` the auditor recorded. A finding that fails is DELETED, not repaired:
 * a miscited finding is one the auditor never actually verified, and repairing it
 * launders a guess into evidence.
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
 */
export function checkFindings(findings, { repoRoot, sourceDir, oursRef = null }) {
  const errors = []
  const seen = new Set()

  // Preflight the ref ONCE. An unreachable audit commit is an ENVIRONMENT problem (a
  // shallow clone), not ~150 bad citations, and it must say so in one line.
  if (oursRef && !refReachable(oursRef, repoRoot)) {
    return [
      `the audit commit ${oursRef} is not in this clone, so the our-side citations ` +
        `CANNOT BE VERIFIED (this is not a citation failure — it is a missing commit).\n` +
        `  Cause:  a shallow clone. \`actions/checkout\` defaults to fetch-depth: 1.\n` +
        `  Fix:    fetch the audit commit (CI: \`fetch-depth: 0\`), or run \`git fetch --unshallow\`.`,
    ]
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

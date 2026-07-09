// tests/findings-doc.test.ts
//
// Story rb1-2 — source findings / fidelity spec.
//
// ATTESTATION guard (not a content audit). The committed whole-game findings doc
// `docs/red-baron-1980-source-findings.md` is the citation authority for every
// later Red Baron story (the flight camera in rb1-3, then rb2-rb5). Its per-fact
// CITATIONS are audited by the Reviewer against the quarry — that is prose review,
// not something a unit test can judge. What a test CAN cheaply guarantee, and what
// keeps a sneaky dev from silently skipping the doc, is: it exists, it is
// substantive (not a stub), it names its provenance, and it actually addresses the
// four axes the story demands (mechanics, timing/frame-cadence, sound, object data).
//
// This reads the committed doc from red-baron's OWN tree — it never reaches into
// the gitignored, checkout-local `reference/` quarry, so it passes in a fresh
// clone with no quarry present.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// tests/findings-doc.test.ts → repo root is one level up from tests/.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOC = join(root, 'docs', 'red-baron-1980-source-findings.md')
const read = () => (existsSync(DOC) ? readFileSync(DOC, 'utf8') : '')

describe('findings doc — red-baron-1980-source-findings.md (attestation)', () => {
  it('exists under red-baron/docs/', () => {
    expect(existsSync(DOC), 'docs/red-baron-1980-source-findings.md must exist').toBe(true)
  })

  it('is substantive — a whole-game distillation, not a stub', () => {
    // A doc covering flight model, enemy behavior, the frame-cadence divider,
    // the POKEY sound inventory, and the plane/picture/ground object tables is
    // many KB. 2000 chars is a deliberately low floor that still fails an
    // empty/placeholder stub.
    expect(read().length).toBeGreaterThan(2000)
  })

  it('cites its provenance — the historicalsource/red-baron disassembly', () => {
    expect(read()).toContain('historicalsource/red-baron')
  })

  it('addresses all four required axes (mechanics, timing, sound, object data)', () => {
    const text = read().toLowerCase()
    // The story demands distillation along four axes. Guard that each is named —
    // a doc that silently drops one (e.g. the frame-cadence trap) fails here.
    expect(text, 'must cover the flight/mechanics axis').toMatch(/flight|mechanic/)
    expect(text, 'must cover the timing / frame-cadence axis').toMatch(/cadence|frame|timing/)
    expect(text, 'must cover the sound (POKEY) axis').toMatch(/pokey|sound/)
    expect(text, 'must cover the object-data axis').toMatch(/object|vector|points/)
  })
})

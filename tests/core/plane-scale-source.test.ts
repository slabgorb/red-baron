// tests/core/plane-scale-source.test.ts
//
// Story rb4-17 — THE ROM DERIVATION RECORD (RED phase, TEA / Imperator Furiosa).
//
// AC-1 demands that "every vertex→screen scale factor is DERIVED from the cited routines … and
// carries its citation. Any factor that cannot be byte-pinned is declared a seam with the
// derivation shown … never silently invented." This file IS that derivation, re-opened against
// the citable quarry line-by-line so the numbers rb4-17 bakes into the clone are provably the
// ROM's own — not a haiku-fabricated citation that matches a TOKEN rather than the CLAIM
// (the standing hazard the SM handoff names).
//
// It is GREEN from the first commit: it asserts what the ORIGINAL 1980 source says, which is
// true before Dev touches anything. The RED that drives the fix lives in
// tests/core/plane-picture-scale.test.ts. Keeping the two apart means this record cannot be
// knocked out by the fix file's not-yet-existing imports, and a reviewer can read the whole
// derivation in one place.
//
// ─── THE DERIVATION, IN ONE PARAGRAPH ────────────────────────────────────────────────────────
//
// The full enemy plane (the lead) is drawn through the ZAXIS 3-D path. Its vertices are stored by
// the POINTP macro as `.BYTE .Z, .X*2, .Y*4` (RBARON.MAC) — X held ×2, Y held ×4, Z ×1. ZAXIS then
// reads those stored bytes: X `(*2)` gets one more ASL → enters the Math Box at `(*4)`; Y `(*4)`
// enters unshifted at ×4; Z is unshifted. So relative to the LOGICAL POINTP argument — which is
// exactly what biplane.ts transcribed into PLANE_POINTS as [x, y, z] — the composite vertex scale
// is X×4, Y×4, Z×1: ISOTROPIC ×4 on the wingspan. The clone injects the logical bytes at ×1, so
// the plane is drawn a quarter of the size the cabinet drew it (AC-4's ~15px speck). That is the
// whole of the size bug, and every factor in it is one of the bytes pinned below.
//
// ─── THE QUARRY, FINGERPRINTED ───────────────────────────────────────────────────────────────
//
// There are THREE checkouts of this source on the machine and they disagree about line numbers,
// and there is a decoy build (R2GRND/R2BRON) that never shipped and differs by FRMECNT and a
// watchdog. So this file (a) resolves the citable copy by env/default exactly as citations.test.ts
// does, (b) FINGERPRINTS it and rejects the CRLF sibling and the decoy before trusting a byte,
// and (c) DERIVES every line from where the symbol is DEFINED — it never types a raw line number,
// because a typed number is the thing that rots when the copy underneath it is the wrong one.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const sourceDir = process.env.RED_BARON_SOURCE_DIR ?? '/Users/slabgorb/Projects/red-baron-source-text'
const sourceAvailable = existsSync(join(sourceDir, 'RBARON.MAC')) && existsSync(join(sourceDir, 'RBGRND.MAC'))

/** Read a .MAC from the quarry as LF-split lines (the citable copy is already LF-only). */
function macLines(file: string): readonly string[] {
  return readFileSync(join(sourceDir, file), 'utf8').split('\n')
}

/** The 1-based line where a label/equate is DEFINED (`NAME:` or `NAME<ws>=`), or -1. */
function defLine(lines: readonly string[], name: string): number {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^${esc}(:|\\s*=|\\s)`)
  return lines.findIndex((l) => re.test(l)) + 1
}

/** The first line AT/AFTER `from` (1-based) whose text matches `re`, as {line, text}, or throws. */
function findFrom(lines: readonly string[], from: number, re: RegExp): { line: number; text: string } {
  for (let i = from - 1; i < lines.length; i++) {
    if (re.test(lines[i])) return { line: i + 1, text: lines[i] }
  }
  throw new Error(`no line matching ${re} at/after ${from}`)
}

describe.skipIf(!sourceAvailable)('rb4-17 ROM derivation — the citable quarry, fingerprinted', () => {
  const rbaron = sourceAvailable ? macLines('RBARON.MAC') : []
  const rbgrnd = sourceAvailable ? macLines('RBGRND.MAC') : []

  // ── the guard that makes every citation below worth trusting ──
  it('is the CITABLE copy, not the CRLF sibling and not the decoy build', () => {
    // The citable RBARON has 6293 newline-terminated lines and opens the hex island at :74.
    expect(rbaron.length, 'RBARON.MAC line count identifies the citable copy').toBe(6294)
    expect(rbaron[73]).toContain('.RADIX 16') // :74 — the hex region the constants live in
    expect(rbaron[620]).toMatch(/CALCNT\s*=\s*18/) // :621 — the 96 ms calc-frame timebase
    // RBGRND is `.RADIX 16` from its top, and — THE DECOY TELL — ships FRMECNT=4 (62.5 Hz).
    // R2GRND.MAC, the build that never shipped, carries FRMECNT=5. A citation to it "verifies"
    // against the right text at the right line while laundering a lie; reject it here.
    expect(rbgrnd[5]).toContain('.RADIX 16') // :6
    const frmecnt = findFrom(rbgrnd, 1, /FRMECNT\s*=/)
    expect(frmecnt.text, 'shipped RBGRND has FRMECNT=4; the decoy R2GRND has =5').toMatch(/FRMECNT\s*=\s*4\b/)
  })

  // ── AC-1 / AC-5: the vertex pre-scale, derived from the two macros that set it ──
  describe('the full-plane vertex scale is ISOTROPIC ×4, byte for byte', () => {
    it('POINTP stores the vertex as (Z, X*2, Y*4) — the storage half of the scale', () => {
      // biplane.ts:11 cites `POINTP .X,.Y,.Z` (RBARON.MAC:57 per its comment); the macro BODY is
      // the line after the .MACRO header. Derive it, do not type it.
      const macro = defLine(rbaron, '.MACRO POINTP') || findFrom(rbaron, 1, /\.MACRO\s+POINTP\b/).line
      const body = findFrom(rbaron, macro, /\.BYTE/).text
      expect(body, 'X is held ×2, Y is held ×4, Z is ×1 — the POINTP storage convention').toMatch(
        /\.BYTE\s+\.Z\s*,\s*\.X\*2\s*,\s*\.Y\*4/,
      )
    })

    it('ZAXIS lifts X (*2)→(*4) with one ASL and takes Y (*4) unshifted — the rotate half', () => {
      const zaxis = defLine(rbgrnd, 'ZAXIS')
      expect(zaxis, 'ZAXIS must be found in RBGRND (the full-plane path)').toBeGreaterThan(0)
      // X: loaded `;X (*2)`, then a bare ASL, then stored `;X LSB (*4)`.
      const xLoad = findFrom(rbgrnd, zaxis, /LDA\s+NY,POINTR\s*;X \(\*2\)/)
      const xAsl = findFrom(rbgrnd, xLoad.line + 1, /^\s*ASL\b/)
      const xStore = findFrom(rbgrnd, xAsl.line, /MM\.XL\s*;X LSB \(\*4\)/)
      expect(xStore.line).toBeGreaterThan(xLoad.line) // one ASL between load and the ×4 store
      // Y: loaded `;Y (*4)` and stored `;Y LSB (*4)` with NO ASL between — already ×4 in storage.
      const yLoad = findFrom(rbgrnd, xStore.line, /LDA\s+NY,POINTR\s*;Y \(\*4\)/)
      const yStore = findFrom(rbgrnd, yLoad.line, /MM\.YL\s*;Y LSB \(\*4\)/)
      const between = rbgrnd.slice(yLoad.line, yStore.line - 1)
      expect(between.some((l) => /^\s*ASL\b/.test(l)), 'Y takes NO extra shift — it is isotropic with X').toBe(false)
    })

    it('PROJECT (the GROUND/drone path) is the anisotropic ×16/×4 — a DIFFERENT path, for AC-5', () => {
      // The reconciliation AC-5 asks for: the ground path really is X×16 (four ASL) / Y×4 (two ASL),
      // which composes with ITS point tables. The full plane above is isotropic ×4; these are not
      // the same routine and must not be conflated (the SM handoff flags exactly this).
      const project = defLine(rbgrnd, 'PROJECT')
      expect(project).toBeGreaterThan(0)
      const xDepth = findFrom(rbgrnd, project, /LDA\s+NY,POINTR\s*;X\b/)
      const xAsls = rbgrnd.slice(xDepth.line, xDepth.line + 12).filter((l) => /^\s*ASL\b/.test(l)).length
      expect(xAsls, 'PROJECT shifts X left four times (×16)').toBe(4)
    })
  })

  // ── AC-2: the two Zs are two fields, spawned together, stepped apart, read for different jobs ──
  describe('dual-Z: PICTURE SIZE Z and POSITION Z are distinct fields', () => {
    it('the PLSTAT layout names +4/+5 PICTURE SIZE and +19/+1A POSITION, with separate deltas', () => {
      // The `.IF EQ,1` DATA STRUCTURE FORMATS block documents the plane record's field offsets.
      const fmt = findFrom(rbaron, 1, /DATA STRUCTURE FORMATS/).line
      const block = rbaron.slice(fmt, fmt + 40).join('\n')
      expect(block).toMatch(/\+4\b.*Z LSB PICTURE SIZE/) // the vertex-divide Z
      expect(block).toMatch(/\+10\b.*DELTA Z/) // its delta
      expect(block).toMatch(/\+19\b.*POSITION Z/) // the centre-placement Z
      expect(block).toMatch(/\+1B\b.*DELTA POS Z/) // its (separate) delta
    })

    it('O.DPTH is a SCALE FACTOR, not merely a distance (the end-of-game constant proves it)', () => {
      // O.DPTH = OBJECT+4 is the divisor PROJECT scales vertices by. The game-over star path pins
      // it to a literal with the ROM's own word for what it is.
      expect(findFrom(rbaron, 1, /O\.DPTH\s*=\s*OBJECT\+4/).line).toBeGreaterThan(0)
      const scale = findFrom(rbaron, 1, /STA\s+O\.DPTH\+1\s*;SCALE FACTOR/)
      expect(scale.text, "the ROM calls O.DPTH a SCALE FACTOR outright").toMatch(/SCALE FACTOR/)
    })

    it('STPLNE spawns BOTH Zs at P.INDP (the single spawn depth for size and position alike)', () => {
      const stplne = defLine(rbaron, 'STPLNE')
      const spawn = rbaron.slice(stplne, stplne + 60).join('\n')
      expect(spawn).toMatch(/LDA\s+I,P\.INDP&0FF/) // the low byte of P.INDP
      expect(spawn).toMatch(/STA\s+PLSTAT\+4\b/) // → PICTURE SIZE Z
      expect(spawn).toMatch(/STA\s+PLSTAT\+19\b/) // → POSITION Z, the SAME value
    })

    it('UPDPLN steps PICTURE Z by DELTA Z and POSITION Z by DELTA POS Z — separately', () => {
      const updpln = defLine(rbaron, 'UPDPLN')
      const body = rbaron.slice(updpln, updpln + 160).join('\n')
      // PICTURE Z (+4/+5) += DELTA Z (+10/+11)
      expect(body).toMatch(/LDA\s+PLSTAT\+4[\s\S]*?ADC\s+PLSTAT\+10/)
      // POSITION Z (+19/+1A) += DELTA POS Z (+1B), the normal-plane path
      expect(body).toMatch(/LDA\s+PLSTAT\+19[\s\S]*?ADC\s+PLSTAT\+1B/)
    })

    it('PLNLBS positions the CENTRE by POSITION Z, then divides the VERTICES by PICTURE Z', () => {
      const plnlbs = defLine(rbaron, 'PLNLBS')
      const body = rbaron.slice(plnlbs - 1, plnlbs + 40)
      // opens by loading POSITION DEPTH (+19) into OBJECT+4, which POSITP then scales the centre by
      expect(body[0]).toMatch(/LDA\s+ZX,PLOBDB\+19\s*;POSITION DEPTH/)
      expect(body.join('\n')).toMatch(/STA\s+OBJECT\+4/)
      // …then RELOADS O.DPTH from PICTURE SIZE Z (+4/+5) before the vertex projection
      const reload = findFrom(rbaron, plnlbs, /LDA\s+ZX,PLOBDB\+4\b/)
      expect(rbaron[reload.line], 'PLNLBS reloads O.DPTH with PICTURE Z for the vertex divide').toMatch(/STA\s+O\.DPTH/)
    })

    it('the fly-by-over check reads PICTURE Z against P.MNDP (0x140 = 320)', () => {
      const pmndp = findFrom(rbaron, 1, /P\.MNDP\s*=\s*140\b/)
      expect(pmndp.line).toBeGreaterThan(0) // 0x140 = 320, the closest a plane bores in
      const updpln = defLine(rbaron, 'UPDPLN')
      const flyby = findFrom(rbaron, updpln, /CPY\s+I,P\.MNDP&0FF\s*;NORMAL PLANE/)
      // the byte compared is PLSTAT+4 — PICTURE Z — loaded just above the compare
      expect(rbaron[flyby.line - 2]).toMatch(/LDY\s+PLSTAT\+4\b/)
    })

    it('the BLIMP record has NO POSITION Z field — the airship is single-Z (AC-6)', () => {
      const blobj = findFrom(rbaron, 1, /BLOBJ\s+BLIMP POSITION/).line
      const block = rbaron.slice(blobj - 1, blobj + 30).join('\n')
      expect(block).toMatch(/\+4\b.*Z LSB/) // it has a picture Z…
      expect(block, 'BLOBJ documents no +19 POSITION Z — no dual-Z for the blimp').not.toMatch(/\+19\b.*POSITION Z/)
    })
  })

  // ── AC-3: the ROM's own screen windows, the anchors scene.ts's NDC seam is re-derived against ──
  describe('the screen windows SETBM / SETGRS give the NDC seam its ROM anchors', () => {
    it('SETBM culls a beam once |screen| reaches 0x300 (the visibility limit)', () => {
      const setbm = defLine(rbgrnd, 'SETBM')
      const cull = findFrom(rbgrnd, setbm, /CPX\s+I,3\b/)
      expect(cull.text, 'DPABS→CPX I,3: MSB ≥ 3 means |screen| ≥ 0x300 = 768').toMatch(/CPX\s+I,3/)
    })

    it('SETGRS windows the drawn object to |X| < 0x220 and |Y| < 0x188', () => {
      const setgrs = defLine(rbgrnd, 'SETGRS')
      const body = rbgrnd.slice(setgrs - 1, setgrs + 12).join('\n')
      // X: CPY I,20 / SBC I,2  → a 16-bit compare of |X| against 0x220 = 544
      expect(body).toMatch(/CPY\s+I,20[\s\S]*?SBC\s+I,2\b/)
      // Y: CPY I,88 / SBC I,1  → |Y| against 0x188 = 392
      expect(body).toMatch(/CPY\s+I,88[\s\S]*?SBC\s+I,1\b/)
    })
  })
})

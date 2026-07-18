// tests/core/ground-target-source.test.ts
//
// Story rb4-11 — THE ROM DERIVATION RECORD (Imperator Furiosa / TEA).
//
// The transcription oracles that ground-target-data.test.ts pins as literals are re-opened
// here against the citable quarry, line by line, so the bytes rb4-11 bakes into topology.ts
// are provably the ROM's own. Like plane-scale-source.test.ts (rb4-17), this file is GREEN
// from the first commit — it asserts what the ORIGINAL 1980 source says, which is true
// before Dev touches anything. The RED that drives the work lives in the sibling suites.
//
// Quarry discipline (the staircase / decoy hazard): three checkouts of this source exist
// on this machine and DISAGREE about line numbers, and a decoy build (R2BRON/R2GRND) sits
// beside the shipped one. So this file (a) resolves the citable copy exactly as
// citations.test.ts does, (b) FINGERPRINTS it and rejects the CRLF sibling and the decoy,
// and (c) DERIVES every line from where each symbol is DEFINED — raw line numbers appear
// only in comments.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const sourceDir = process.env.RED_BARON_SOURCE_DIR ?? '/Users/slabgorb/Projects/red-baron-source-text'
const sourceAvailable =
  existsSync(join(sourceDir, 'RBARON.MAC')) &&
  existsSync(join(sourceDir, 'RBGRND.MAC')) &&
  existsSync(join(sourceDir, '037007.XXX'))

/** Read a quarry file as LF-split lines (the citable copy is already LF-only). */
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

/** Collect a BV/VV connect-list from its definition line down to its ENDDB. */
function opsFrom(lines: readonly string[], from: number): ReadonlyArray<readonly [string, number]> {
  const ops: Array<readonly [string, number]> = []
  for (let i = from - 1; i < lines.length; i++) {
    const m = /(?:^\w+:)?\s*(BV|VV)\s+(\d+)\s*$/.exec(lines[i])
    if (m) {
      ops.push([m[1], Number(m[2])])
      continue
    }
    if (/ENDDB/.test(lines[i])) return ops
    throw new Error(`connect-list at ${from} broken by line ${i + 1}: ${lines[i]}`)
  }
  throw new Error(`connect-list at ${from} never reached ENDDB`)
}

/** Collect consecutive PFPNTS rows (x, y, z as WRITTEN) from a definition line. */
function pfpntsFrom(lines: readonly string[], from: number): ReadonlyArray<readonly number[]> {
  const rows: Array<readonly number[]> = []
  for (let i = from - 1; i < lines.length; i++) {
    const m = /(?:^[.\w]+:)?\s*PFPNTS\s+(-?\d+),(-?\d+),(-?\d+)/.exec(lines[i])
    if (!m) break
    rows.push([Number(m[1]), Number(m[2]), Number(m[3])])
  }
  return rows
}

/** Collect PFCOL rows from a definition line, tolerating the bare `;` group separators. */
function pfcolsFrom(lines: readonly string[], from: number): ReadonlyArray<readonly number[]> {
  const rows: Array<readonly number[]> = []
  for (let i = from - 1; i < lines.length; i++) {
    const m = /(?:^\w+:)?\s*PFCOL\s+(-?\d+),(-?\d+)\s*$/.exec(lines[i])
    if (m) {
      rows.push([Number(m[1]), Number(m[2])])
      continue
    }
    if (/^\s*;\s*$/.test(lines[i])) continue // the group separator comment lines
    break // .END or anything else terminates the table
  }
  return rows
}

describe.skipIf(!sourceAvailable)('rb4-11 ROM derivation — the citable quarry, fingerprinted', () => {
  const rbaron = sourceAvailable ? macLines('RBARON.MAC') : []
  const rbgrnd = sourceAvailable ? macLines('RBGRND.MAC') : []
  const pics = sourceAvailable ? macLines('037007.XXX') : []

  // ── the guard that makes every citation below worth trusting ──
  it('is the CITABLE copy, not the CRLF sibling and not the decoy build', () => {
    expect(rbaron.length, 'RBARON.MAC line count identifies the citable copy').toBe(6294)
    expect(rbaron[73]).toContain('.RADIX 16') // :74 — the hex region the constants live in
    expect(rbaron[620]).toMatch(/CALCNT\s*=\s*18/) // :621 — the 96 ms calc-frame timebase
    // RBGRND is `.RADIX 16` from its top, and — THE DECOY TELL — ships FRMECNT=4 (62.5 Hz).
    // R2GRND.MAC, the build that never shipped, carries FRMECNT=5.
    expect(rbgrnd[5]).toContain('.RADIX 16') // :6
    const frmecnt = findFrom(rbgrnd, 1, /FRMECNT\s*=/)
    expect(frmecnt.text, 'shipped RBGRND has FRMECNT=4; the decoy R2GRND has =5').toMatch(/FRMECNT\s*=\s*4\b/)
    // and the picture ROM source names ITSELF: the part-numbered file is RBPICS.
    expect(pics[0]).toContain('RBPICS') // :1  .TITLE RBPICS - RED BARON PICTURES
  })

  // ── AC-1's radix clause, machine-checked ──
  describe('the ground-target window of 037007.XXX is governed by .RADIX 10', () => {
    it('the file changes radix exactly twice — hex at :43, DECIMAL at :80, then never again', () => {
      const radixLines = pics
        .map((text, i) => ({ line: i + 1, text }))
        .filter((l) => /\.RADIX/.test(l.text))
      expect(radixLines).toHaveLength(2)
      expect(radixLines[0].text).toContain('.RADIX 16')
      expect(radixLines[1].text).toContain('.RADIX 10')
      // every ground-target symbol is defined BELOW the decimal switch:
      for (const name of ['PFODEC', 'PFPYRM', 'PFHOME', 'PFTANK', 'PFPBOX', 'PFLOB', 'PFOFFS']) {
        expect(defLine(pics, name), `${name} sits in the decimal region`).toBeGreaterThan(
          radixLines[1].line,
        )
      }
    })

    it('the PFPNTS macro emits ONLY X/2 and Y*2 — the third argument is discarded', () => {
      // .MACRO PFPNTS .X,.Y,.Z / .BYTE .X/2,.Y*2 / .ENDM (037007.XXX:10-12). This is why the
      // port's Point2 keeps [x, y]: the assembled ROM holds no third byte to transcribe.
      const macro = findFrom(pics, 1, /\.MACRO\s+PFPNTS\b/)
      const body = findFrom(pics, macro.line, /\.BYTE/)
      expect(body.text).toMatch(/\.BYTE\s+\.X\/2\s*,\s*\.Y\*2\s*$/)
    })
  })

  // ── AC-1: the four point-sets, exactly as written (third args included — the macro drops them) ──
  describe('the point-sets (037007.XXX:1186-1225)', () => {
    it('PFPYRM — 4 rows', () => {
      expect(pfpntsFrom(pics, defLine(pics, 'PFPYRM'))).toEqual([
        [-8, -4, 32], [0, -4, 24], [8, -4, 32], [0, 4, 32],
      ])
    })

    it('PFHOME — 7 rows', () => {
      expect(pfpntsFrom(pics, defLine(pics, 'PFHOME'))).toEqual([
        [-4, -4, 32], [-4, 0, 32], [-8, 0, 32], [0, 8, 32], [8, 0, 32], [4, 0, 32], [4, -4, 32],
      ])
    })

    it('PFTANK — 10 rows, the last two differing ONLY in the discarded third argument', () => {
      const rows = pfpntsFrom(pics, defLine(pics, 'PFTANK'))
      expect(rows).toEqual([
        [-2, -4, 32], [-4, -1, 32], [4, -1, 32], [2, -4, 32], [-2, -1, 32],
        [-2, 1, 32], [2, 1, 32], [2, -1, 32], [0, 0, 32], [0, 0, 28],
      ])
      // the assembled bytes of rows 8 and 9 are IDENTICAL (0,0) — the tank's centre dot.
      expect(rows[8].slice(0, 2)).toEqual(rows[9].slice(0, 2))
    })

    it('PFPBOX — 16 rows', () => {
      expect(pfpntsFrom(pics, defLine(pics, 'PFPBOX'))).toEqual([
        [-4, -4, 32], [-4, 0, 34], [4, 0, 34], [4, -4, 32],
        [-4, -1, 32], [-6, -1, 32], [-6, -2, 32], [-4, -2, 32],
        [4, -1, 32], [6, -1, 32], [6, -2, 32], [4, -2, 32],
        [0, -1, 32], [2, -1, 32], [2, -2, 32], [0, -2, 32],
      ])
    })
  })

  // ── AC-1: the four decode-lists ──
  describe('the decode-lists (037007.XXX:1134-1184)', () => {
    it('DEPFPY', () => {
      expect(opsFrom(pics, defLine(pics, 'DEPFPY'))).toEqual([
        ['BV', 0], ['VV', 3], ['VV', 2], ['VV', 0], ['BV', 1], ['VV', 3],
      ])
    })

    it('DEPFHS', () => {
      expect(opsFrom(pics, defLine(pics, 'DEPFHS'))).toEqual([
        ['BV', 0], ['VV', 1], ['BV', 5], ['VV', 6], ['BV', 2], ['VV', 3], ['VV', 4], ['VV', 2],
      ])
    })

    it('DEPFTK — ends in the centre-dot stroke BV 8 / VV 9', () => {
      expect(opsFrom(pics, defLine(pics, 'DEPFTK'))).toEqual([
        ['BV', 0], ['VV', 1], ['VV', 2], ['VV', 3], ['VV', 0],
        ['BV', 4], ['VV', 5], ['VV', 6], ['VV', 7], ['BV', 8], ['VV', 9],
      ])
    })

    it('DEPFPB', () => {
      expect(opsFrom(pics, defLine(pics, 'DEPFPB'))).toEqual([
        ['BV', 0], ['VV', 1], ['VV', 2], ['VV', 3], ['VV', 0],
        ['BV', 4], ['VV', 5], ['VV', 6], ['VV', 7],
        ['BV', 8], ['VV', 9], ['VV', 10], ['VV', 11], ['VV', 8],
        ['BV', 15], ['VV', 14], ['VV', 13], ['VV', 12], ['VV', 15],
      ])
    })
  })

  // ── AC-2: the four tables ──
  describe('the tables (037007.XXX:1132, :1227-1246)', () => {
    it('PFODEC — .WORD DEPFPY,DEPFHS,DEPFTK,DEPFPB', () => {
      const def = defLine(pics, 'PFODEC')
      expect(pics[def - 1]).toMatch(/\.WORD\s+DEPFPY,DEPFHS,DEPFTK,DEPFPB/)
    })

    it('PFLOB — .WORD PFPYRM,PFHOME,PFTANK,PFPBOX', () => {
      const def = defLine(pics, 'PFLOB')
      expect(pics[def - 1]).toMatch(/\.WORD\s+PFPYRM,PFHOME,PFTANK,PFPBOX/)
    })

    it('.PFLOB — the symbolic last-point-offset bytes', () => {
      const def = defLine(pics, '.PFLOB')
      expect(pics[def - 1]).toMatch(/\.BYTE\s+PFHOME-PFPYRM-2,PFTANK-PFHOME-2/)
      expect(pics[def]).toMatch(/\.BYTE\s+PFPBOX-PFTANK-2,PFLOB-PFPBOX-2/)
    })

    it('PFOFFS — 12 PFCOL rows in 4 separator-delimited groups of 3, then .END', () => {
      const def = defLine(pics, 'PFOFFS')
      expect(pfcolsFrom(pics, def)).toEqual([
        [96, -28], [-56, -4], [-72, -4],
        [120, -4], [-24, -20], [-40, -20],
        [8, -4], [-8, -4], [-40, -20],
        [104, -20], [-72, -4], [-88, -4],
      ])
      expect(findFrom(pics, def, /\.END\b/).line).toBeGreaterThan(def)
    })

    it('RBARON.MAC mirrors the layout by address arithmetic — PFLOB = PFODEC + $82 (:430-433)', () => {
      // 8 (PFODEC words) + 48 (decode lists incl. ENDDBs) + 74 (37 points × 2) = $82: the
      // program ROM's own equations corroborate every entry count the port transcribes.
      expect(findFrom(rbaron, 1, /^PFODEC\s*=\s*DBLIMP\+4F/).line).toBeGreaterThan(0)
      expect(findFrom(rbaron, 1, /^PFLOB\s*=\s*PFODEC\+82/).line).toBeGreaterThan(0)
      expect(findFrom(rbaron, 1, /^\.PFLOB\s*=\s*PFLOB\+8/).line).toBeGreaterThan(0)
      expect(findFrom(rbaron, 1, /^PFOFFS\s*=\s*\.PFLOB\+4/).line).toBeGreaterThan(0)
    })
  })

  // ── AC-3: the deploy machine ──
  describe('the ground-wave deploy machine (RBARON.MAC)', () => {
    it('INITGR arms GRNDCT=2 and GTIMER=1 (:1403-1408)', () => {
      const initgr = defLine(rbaron, 'INITGR')
      expect(initgr).toBeGreaterThan(0)
      const two = findFrom(rbaron, initgr, /LDA\s+I,2/)
      expect(findFrom(rbaron, two.line, /STA\s+GRNDCT/).line).toBe(two.line + 1)
      const one = findFrom(rbaron, two.line, /LDA\s+I,1/)
      const gtimer = findFrom(rbaron, one.line, /STA\s+GTIMER\s*;MOUNTAIN OBJECT TIME-OUT/)
      expect(gtimer.line).toBe(one.line + 1)
    })

    it('the gate: DEC GTIMER / BMI (time-out) else CMP I,8 / BCS (not near centre) (:3426-3429)', () => {
      const dec = findFrom(rbaron, 1, /^\s*DEC\s+GTIMER\s*$/)
      expect(findFrom(rbaron, dec.line, /BMI\s+\d+\$\s*;PF OBJECT TIME-OUT/).line).toBe(dec.line + 1)
      expect(findFrom(rbaron, dec.line, /CMP\s+I,8/).line).toBe(dec.line + 2)
      expect(findFrom(rbaron, dec.line, /BCS\s+\d+\$/).line).toBe(dec.line + 3)
    })

    it('the deploy: GRNDCT spent-gate, DEC GRNDCT, GTIMER re-armed to 1, group = RANDOM AND 3 (:3430-3455)', () => {
      const dec = findFrom(rbaron, 1, /^\s*DEC\s+GTIMER\s*$/)
      const spent = findFrom(rbaron, dec.line, /LDA\s+GRNDCT/)
      expect(findFrom(rbaron, spent.line, /BEQ\s+\d+\$/).line).toBe(spent.line + 1)
      const spend = findFrom(rbaron, spent.line, /DEC\s+GRNDCT/)
      // the re-arm: LDA I,1 / STA GTIMER on the deploy path, BEFORE the group roll
      const rearm = findFrom(rbaron, spend.line, /STA\s+GTIMER\s*$/)
      expect(rbaron[rearm.line - 2]).toMatch(/LDA\s+I,1/)
      const roll = findFrom(rbaron, rearm.line, /JSR\s+RANDOM/)
      expect(findFrom(rbaron, roll.line, /AND\s+I,3/).line).toBe(roll.line + 1)
      expect(findFrom(rbaron, roll.line, /STA\s+AX,PFOBJ\+7\s*;RANDOM PF OBJECT GROUPS/).line).toBeGreaterThan(roll.line)
    })

    it('PFOBJN — the 4 groups of 3 pre-doubled object numbers (:3924-3927)', () => {
      const def = defLine(rbaron, 'PFOBJN')
      expect(rbaron[def - 1]).toMatch(/\.BYTE\s+0,2,6/)
      expect(rbaron[def]).toMatch(/\.BYTE\s+0,0,6/)
      expect(rbaron[def + 1]).toMatch(/\.BYTE\s+4,2,6/)
      expect(rbaron[def + 2]).toMatch(/\.BYTE\s+4,4,6/)
    })
  })

  // ── AC-4: BLCOLL ──
  describe('BLCOLL — the blimp collision box (RBARON.MAC:6270-6277)', () => {
    it('8 POINTP corners, ±16 × ±16 × ±40, exactly as written', () => {
      const def = defLine(rbaron, 'BLCOLL')
      const expected = [
        [16, 16, -40], [16, -16, -40], [-16, 16, -40], [-16, -16, -40],
        [16, 16, 40], [16, -16, 40], [-16, 16, 40], [-16, -16, 40],
      ]
      expected.forEach(([x, y, z], i) => {
        const re = new RegExp(`POINTP\\s+${x},${y},${z}\\b`)
        expect(rbaron[def - 1 + i], `BLCOLL row ${i}`).toMatch(re)
      })
    })

    it('sits INSIDE the program ROM’s .RADIX 10 window — decimal, like the plane vertex table', () => {
      const def = defLine(rbaron, 'BLCOLL')
      const radixBefore = rbaron
        .map((text, i) => ({ line: i + 1, text }))
        .filter((l) => /\.RADIX/.test(l.text) && l.line < def)
        .pop()
      expect(radixBefore?.text, 'the radix governing BLCOLL').toContain('.RADIX 10')
      const radixAfter = findFrom(rbaron, def, /\.RADIX/)
      expect(radixAfter.text).toContain('.RADIX 16')
      expect(radixAfter.line).toBeGreaterThan(def + 7) // all 8 rows are inside the window
    })

    it('is a member of the PLNDB master table (:6285-6287)', () => {
      const plndb = defLine(rbaron, 'PLNDB')
      const block = rbaron.slice(plndb - 1, plndb + 2).join('\n')
      expect(block).toContain('BLCOLL')
    })
  })
})

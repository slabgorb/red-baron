// tests/audit/radix-transcription.test.ts
//
// Story rb4-1 — THE RADIX SWEEP — RED phase (Furiosa / TEA).
//
// RBARON.MAC sets `.RADIX 16` at line 74. Every gameplay constant defined below that
// line is HEXADECIMAL. This clone transcribed ~30 of them AS IF DECIMAL: ACCEL =30 is
// 0x30 = 48, not 30; P.INDP =1080 is 0x1080 = 4224, not 1080; S.MAXZ =19 is 0x19 = 25,
// not 19. Nearly all are wrong in the same direction, which is why the game "seems way
// off". This suite is the gate on every other numeric story in epic rb4.
//
// ─── THE ONE RULE OF THIS FILE ───────────────────────────────────────────────────
// Every value it asserts about a HEX-region constant is DERIVED here from the ROM literal,
// under the radix that governs the exact line that literal sits on (resolved by backward-
// scanning `.RADIX` directives). That is what AC-4 means by "the transcription is auditable,
// not asserted": you cannot quietly regress a constant to decimal, because the ROM is the
// oracle, not this file.
//
// The ONE deliberate exception is the AC-5 block at the bottom. Those are golden-value
// guards over data that is already CORRECT (the picture ROM's decimal geometry), and their
// whole job is to fail if a future sweep "helpfully" re-reads it as hex — so they pin the
// literal decimal arrays on purpose. They are guards, not derivations, and they say so.
//
// The Atari source is a separate public checkout, not part of this repo, so the source-side
// checks degrade gracefully when it is absent (CI) — exactly as tests/audit/
// citations.test.ts does. The manifest itself is committed, so the code-side
// assertions still run everywhere.
//
// ─── CONTRACT FOR THE GREEN PHASE (The Word Burgers / Dev) ───────────────────────
// The sweep needs these constants OBSERVABLE. Several are currently module-private or
// absent; export them (a constant nobody can read is a constant nobody can audit):
//
//   src/core/enemy.ts          export { P_MNDP }             // P.MNDP  0x140 = 320
//                                                           // (NOT `MIN_DEPTH` — that name is
//                                                           //  already landscape's, for 0x01C0)
//   src/core/explosion.ts      export const SPIN_RATE        // 0x180/0x800 turn = 3π/8
//   src/core/landscape.ts      export const P_OBDZ           // 0x180 = 384 (on horizon)
//   src/core/landscape.ts      export const PF_FALLEN_DZ     // 0x20  = 32  (once fallen)
//   src/core/landscape.ts      export const PFOBIZ_DEPTHS    // the four authored depths
//   src/core/landscape.ts      export const PFOBIZ_X         // the four authored lanes
//
// WHAT THIS STORY MUST NOT TOUCH: topology.ts, the 42-vertex biplane and the picture
// ROM. `037007.XXX` really is `.RADIX 10` from its line 80, so our DECIMAL reading of
// the geometry is CORRECT. Sweeping it to hex would break the shapes. The
// "decimal islands" describe below pins that, and it must stay green.

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sourceDir = process.env.RED_BARON_SOURCE_DIR ?? '/Users/slabgorb/Projects/red-baron-source-text'
const sourceAvailable = existsSync(sourceDir)

// ─── the radix resolver — the whole point of the story, in twelve lines ──────────

const romCache = new Map<string, readonly string[]>()
function romLines(file: string): readonly string[] {
  const cached = romCache.get(file)
  if (cached !== undefined) return cached
  const lines: readonly string[] = readFileSync(join(sourceDir, file), 'latin1').split('\n')
  romCache.set(file, lines)
  return lines
}

/** The ROM line, 1-based, exactly as the assembler sees it. */
function romLine(file: string, line: number): string {
  return romLines(file)[line - 1] ?? ''
}

/**
 * The radix GOVERNING a line = the last `.RADIX n` directive at or before it. `.RADIX`
 * is not per-file, it is per-REGION: RBARON.MAC runs hex from :74, flips to decimal for
 * the vertex island at :6217, and back to hex at :6281. Reading the file's first
 * directive and stopping is precisely the mistake that produced this story.
 */
function radixAt(file: string, line: number): number {
  let radix = 8 // MACRO-65's default; every file we cite sets its own before any data
  for (const l of romLines(file).slice(0, line)) {
    const m = /^\s*\.RADIX\s+(\d+)/i.exec(l)
    if (m) radix = Number(m[1])
  }
  return radix
}

/** Value of a ROM integer literal under a radix. A TRAILING PERIOD forces decimal. */
function romValue(literal: string, radix: number): number {
  const sign = literal.startsWith('-') ? -1 : 1
  const body = literal.replace(/^[-+]/, '')
  const forcedDecimal = body.endsWith('.')
  return sign * parseInt(body.replace(/\.$/, ''), forcedDecimal ? 10 : radix)
}

// ─── the manifest — every scalar taken from a `.RADIX 16` region ─────────────────

interface Transcription {
  /** The exported symbol that must carry the value. */
  readonly ours: string
  /** Module under src/core/ that must export it. */
  readonly module: ModuleName
  /** The ROM symbol, for the failure message. */
  readonly symbol: string
  readonly romFile: string
  readonly romLine: number
  /** The literal EXACTLY as the ROM writes it — the test re-reads the line to prove it. */
  readonly literal: string
  /** What we shipped: the same digits read as decimal. The bug, named. */
  readonly decimalMisread: number
}

type ModuleName = 'enemy' | 'guns' | 'explosion' | 'landscape' | 'waves' | 'returning-ace' | 'topology' | 'biplane'

const MANIFEST: readonly Transcription[] = [
  // The enemy — the machine that felt wrong.
  // DEV EDITED THIS LINE (rb4-1 rework 2) — `module` only: 'enemy' → 'returning-ace'.
  // P.INDP now lives beside P.MNDP in returning-ace.ts, the one core module that imports
  // nothing, because enemy.ts imports biplane.ts and biplane.ts THEN needed to denominate
  // its depth-based model switch against the axis — a circular import whose top-level
  // `const` would throw on load (TDZ). (rb4-13 retired that switch for the ROM's D4
  // orientation bit; the leaf-module placement stands on its own.) enemy.ts re-exports it,
  // so its public surface is unchanged and every other test still reads `enemy.P_INDP`.
  // The AUDITED FACTS are untouched: same value, same ROM line, same radix region, same
  // decimal refutation. Only the home moved, so the manifest follows it — a manifest that
  // names the wrong module is an audit asserting something false.
  { ours: 'P_INDP', module: 'returning-ace', symbol: 'P.INDP', romFile: 'RBARON.MAC', romLine: 464, literal: '1080', decimalMisread: 1080 },
  { ours: 'ACCEL', module: 'enemy', symbol: 'ACCEL', romFile: 'RBARON.MAC', romLine: 465, literal: '30', decimalMisread: 30 },
  { ours: 'P_MNDP', module: 'returning-ace', symbol: 'P.MNDP', romFile: 'RBARON.MAC', romLine: 469, literal: '140', decimalMisread: 140 },

  // The guns and the wreck.
  { ours: 'S_MAXZ', module: 'guns', symbol: 'S.MAXZ', romFile: 'RBARON.MAC', romLine: 492, literal: '19', decimalMisread: 19 },
  { ours: 'EX_ACY', module: 'explosion', symbol: 'EX.ACY', romFile: 'RBARON.MAC', romLine: 481, literal: '-20', decimalMisread: -20 },

  // The mountains.
  { ours: 'SPAWN_DEPTH', module: 'landscape', symbol: 'P.OBZI', romFile: 'RBARON.MAC', romLine: 443, literal: '7F00', decimalMisread: 0x1000 },
  { ours: 'P_OBDZ', module: 'landscape', symbol: 'P.OBDZ', romFile: 'RBARON.MAC', romLine: 444, literal: '180', decimalMisread: 180 },

  // Already correct — REGRESSION GUARDS. topology.ts read these as hex and was right;
  // the sweep must not "helpfully" touch them.
  { ours: 'HORZ', module: 'topology', symbol: 'HORZ', romFile: 'RBARON.MAC', romLine: 451, literal: '1000', decimalMisread: 1000 },
  { ours: 'HORIZN', module: 'topology', symbol: 'HORIZN', romFile: 'RBARON.MAC', romLine: 456, literal: '40', decimalMisread: 40 },
]

// ─── module loading (statically analysable; tolerant of not-yet-added exports) ────

const LOADERS: Record<ModuleName, () => Promise<unknown>> = {
  enemy: () => import('../../src/core/enemy'),
  guns: () => import('../../src/core/guns'),
  explosion: () => import('../../src/core/explosion'),
  landscape: () => import('../../src/core/landscape'),
  waves: () => import('../../src/core/waves'),
  'returning-ace': () => import('../../src/core/returning-ace'),
  topology: () => import('../../src/core/topology'),
  biplane: () => import('../../src/core/biplane'),
}

const loaded: Partial<Record<ModuleName, Record<string, unknown>>> = {}

beforeAll(async () => {
  // No catch. A missing NAMED export does not throw on import — it is simply `undefined` on
  // the namespace object, and `exportedValue` reports that precisely. So the only thing a
  // catch here could swallow is a REAL module failure (a syntax error, a bad path, a
  // circular-import crash) — and burying that under a generic "must export X" would send
  // the next reader hunting for entirely the wrong bug. Let it throw.
  for (const name of Object.keys(LOADERS) as ModuleName[]) {
    loaded[name] = (await LOADERS[name]()) as Record<string, unknown>
  }
})

/** The exported value, or a failure that names the export Dev still owes us. */
function exportedValue(module: ModuleName, symbol: string): unknown {
  const v = loaded[module]?.[symbol]
  if (v === undefined) {
    throw new Error(`src/core/${module}.ts must export \`${symbol}\` — rb4-1 needs it observable to audit it`)
  }
  return v
}

function exportedNumber(module: ModuleName, symbol: string): number {
  const v = exportedValue(module, symbol)
  if (typeof v !== 'number') throw new Error(`src/core/${module}.ts \`${symbol}\` must be a number, got ${typeof v}`)
  return v
}

// ═════════════════════════════════════════════════════════════════════════════════
// AC-4 — the manifest is derived from the ROM, not asserted. If the source is absent
// (CI) these skip; the code-side checks below still run against the committed manifest.
// ═════════════════════════════════════════════════════════════════════════════════

describe.skipIf(!sourceAvailable)('the radix map — .RADIX is per-REGION, not per-file', () => {
  it('RBARON.MAC is hex from :74, with exactly one decimal island at :6217-6280', () => {
    expect(radixAt('RBARON.MAC', 74)).toBe(16) // the directive's own line
    expect(radixAt('RBARON.MAC', 464)).toBe(16) // P.INDP — a constant we misread
    expect(radixAt('RBARON.MAC', 6216)).toBe(16) // last line before the island
    expect(radixAt('RBARON.MAC', 6217)).toBe(10) // the vertex island opens
    expect(radixAt('RBARON.MAC', 6280)).toBe(10) // …and runs to here
    expect(radixAt('RBARON.MAC', 6281)).toBe(16) // hex resumes
  })

  it('the picture ROM 037007.XXX is DECIMAL from :80 — our geometry reading is correct', () => {
    expect(radixAt('037007.XXX', 43)).toBe(16)
    expect(radixAt('037007.XXX', 80)).toBe(10) // the whole picture/landscape database
    expect(radixAt('037007.XXX', 83)).toBe(10) // PFOPOS, which topology.ts transcribes
  })

  it('a TRAILING PERIOD forces decimal inside a hex region (CMP I,250. is 250, not 592)', () => {
    expect(radixAt('RBGRND.MAC', 189)).toBe(16) // the region is hex…
    expect(romLine('RBGRND.MAC', 189)).toContain('250.') // …but the literal is dotted
    expect(romValue('250.', 16)).toBe(250) // so it is DECIMAL 250
    expect(romValue('250', 16)).toBe(0x250) // undotted, the same digits mean 592
  })
})

describe.skipIf(!sourceAvailable)('the manifest is not fabricated — every entry re-read from the ROM', () => {
  it.each(MANIFEST)('$symbol is on $romFile:$romLine, in a .RADIX 16 region', (t) => {
    const line = romLine(t.romFile, t.romLine)
    expect(line, `${t.romFile}:${t.romLine} must still hold ${t.symbol}`).toContain(t.symbol)
    expect(line, `${t.romFile}:${t.romLine} must still hold the literal ${t.literal}`).toContain(t.literal)
    expect(radixAt(t.romFile, t.romLine), `${t.symbol} must sit in a hex region`).toBe(16)
  })

  it.each(MANIFEST)('$ours: the decimal misreading of $literal really is $decimalMisread', (t) => {
    // Proves the manifest's `decimalMisread` is the bug we actually shipped, not a
    // number someone made up — except for SPAWN_DEPTH, where the bug was aliasing to
    // HORZ rather than misreading these digits.
    if (t.ours === 'SPAWN_DEPTH') return
    expect(romValue(t.literal, 10)).toBe(t.decimalMisread)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════
// AC-1 — every constant from a hex region is read as HEX. The expected value is
// computed from the ROM literal; the decimal misreading is refuted explicitly so the
// next person cannot quietly regress it.
// ═════════════════════════════════════════════════════════════════════════════════

describe('AC-1 — the scalars are read as HEX', () => {
  it.each(MANIFEST)('$ours ($symbol) is hex — not the decimal $decimalMisread', (t) => {
    const expected = romValue(t.literal, 16)
    const actual = exportedNumber(t.module, t.ours)

    expect(actual, `${t.module}.ts \`${t.ours}\` must be ${t.symbol} read as HEX`).toBe(expected)

    // The refutation. Where hex and decimal coincide there is nothing to refute.
    if (expected !== t.decimalMisread) {
      expect(actual, `\`${t.ours}\` has regressed to the DECIMAL misreading`).not.toBe(t.decimalMisread)
    }
  })

  it('P.MNDP has exactly ONE home — enemy re-exports it rather than re-typing the value', () => {
    // The same ROM equate (RBARON.MAC:469) reached the code twice and drifted, because
    // nothing forced the two copies to agree. They must now be the same binding.
    expect(exportedNumber('enemy', 'P_MNDP')).toBe(exportedNumber('returning-ace', 'P_MNDP'))
  })

  it('P.MNDP and the mountain recycle threshold do NOT share a name', () => {
    // rb4-1 REWORK. enemy briefly exported P.MNDP (320) as `MIN_DEPTH`, colliding with
    // landscape's own `MIN_DEPTH` (0x01C0 = 448, the PF-object recycle threshold): one
    // identifier, two unrelated ROM equates. That is the bug class this whole story is
    // about. Two different ROM constants may never answer to one name.
    expect(exportedNumber('landscape', 'MIN_DEPTH')).not.toBe(exportedNumber('enemy', 'P_MNDP'))
    expect(loaded.enemy?.MIN_DEPTH, 'enemy must NOT export a `MIN_DEPTH`').toBeUndefined()
  })
})

// ═════════════════════════════════════════════════════════════════════════════════
// AC-1 (tables) — the ROM's DATA tables, not just its equates.
// ═════════════════════════════════════════════════════════════════════════════════

describe('AC-1 — the mountains: PFOBIZ is AUTHORED, and there are TWO closing rates', () => {
  // RBARON.MAC:1305  PFOBIZ:  .WORD 8200,6E0,3220,0D20      <- the four initial DEPTHS
  // RBARON.MAC:1306           .WORD -0C00,-400,400,0C00     <- the four initial LANES
  const DEPTHS = ['8200', '6E0', '3220', '0D20'].map((l) => romValue(l, 16))
  const LANES = ['-0C00', '-400', '400', '0C00'].map((l) => romValue(l, 16))

  it.skipIf(!sourceAvailable)('the PFOBIZ literals are still on RBARON.MAC:1305-1306', () => {
    expect(romLine('RBARON.MAC', 1305)).toContain('PFOBIZ')
    for (const l of ['8200', '6E0', '3220', '0D20']) expect(romLine('RBARON.MAC', 1305)).toContain(l)
    for (const l of ['-0C00', '-400', '400', '0C00']) expect(romLine('RBARON.MAC', 1306)).toContain(l)
    expect(radixAt('RBARON.MAC', 1305)).toBe(16)
  })

  it('the four mountain depths are the ROM\'s authored values, not an even stagger', () => {
    expect(exportedValue('landscape', 'PFOBIZ_DEPTHS')).toEqual(DEPTHS) // 33280, 1760, 12832, 3360
  })

  it('the four mountains sit in four different LANES — not all at x = 0', () => {
    const lanes = exportedValue('landscape', 'PFOBIZ_X')
    expect(lanes).toEqual(LANES) // -3072, -1024, +1024, +3072
    expect(new Set(LANES).size, 'four distinct lanes').toBe(4)
  })

  it('a mountain closes at P.OBDZ = 0x180 on the horizon and 0x20 once fallen — a 12:1 ratio', () => {
    const onHorizon = exportedNumber('landscape', 'P_OBDZ')
    const fallen = exportedNumber('landscape', 'PF_FALLEN_DZ')
    expect(onHorizon).toBe(romValue('180', 16)) // 384
    expect(fallen).toBe(romValue('20', 16)) // 32
    expect(onHorizon / fallen).toBe(12)
    // The single `DEPTH_STEP = 64` we shipped is neither of them.
    expect(onHorizon).not.toBe(64)
    expect(fallen).not.toBe(64)
  })

  it('the recycle threshold is the 16-bit 0x01C0 = 448 — not the CPY operand 0xC0 alone', () => {
    // RBARON.MAC:3349-3355 is the 6502 16-bit compare idiom: CPY against the LOW byte
    // (0C0), then SBC the HIGH byte (1). We took the CPY operand and dropped the high
    // byte, which is how 448 became 192.
    const expected = (romValue('1', 16) << 8) | romValue('0C0', 16)
    expect(expected).toBe(448) // arithmetic, spelled out
    expect(exportedNumber('landscape', 'MIN_DEPTH')).toBe(expected)
    expect(exportedNumber('landscape', 'MIN_DEPTH')).not.toBe(0xc0) // the shipped bug
  })

  it('a mountain spends real time on the horizon — it recycles to 0x7F00, not to HORZ', () => {
    // The consequence, in the units that matter: ours spawned AT the horizon depth and
    // fell below it on the very first step, so our mountains were NEVER on the horizon.
    const spawn = exportedNumber('landscape', 'SPAWN_DEPTH')
    const horz = exportedNumber('topology', 'HORZ')
    const onHorizonDelta = exportedNumber('landscape', 'P_OBDZ')
    expect(spawn).toBe(romValue('7F00', 16)) // 32512
    expect(spawn).toBeGreaterThan(horz) // it starts BEYOND the horizon…
    const framesOnHorizon = (spawn - horz) / onHorizonDelta
    expect(framesOnHorizon).toBeGreaterThan(70) // …and takes ~74 calc-frames to arrive
  })
})

describe('AC-1 — the drone formation: PLANE1/PLANE2 are ±0x100, not ±100', () => {
  const OFF = romValue('100', 16) // 256

  it.skipIf(!sourceAvailable)('PLANE1/PLANE2 are on RBARON.MAC:2480-2481, in a hex region', () => {
    expect(romLine('RBARON.MAC', 2480)).toContain('PLANE1')
    expect(romLine('RBARON.MAC', 2480)).toContain('-100,100')
    expect(romLine('RBARON.MAC', 2481)).toContain('PLANE2')
    expect(romLine('RBARON.MAC', 2481)).toContain('-100,-100')
    expect(radixAt('RBARON.MAC', 2480)).toBe(16)
  })

  it('the two drones fly at ±256 from the lead — our formation was 2.56× too tight', () => {
    expect(exportedValue('waves', 'DRONE_OFFSETS')).toEqual([
      [-OFF, OFF], //  PLANE1  .WORD -100,100
      [-OFF, -OFF], // PLANE2  .WORD -100,-100
    ])
  })
})

describe('AC-3 — PLPOSZ is wrong in ALL FOUR respects: sign, magnitude, length, ramp', () => {
  // RBARON.MAC:2482  PLPOSZ: .BYTE -4,-10,-20,-30,-40,-50,-60,-70,-80   (hex region)
  const LITERALS = ['-4', '-10', '-20', '-30', '-40', '-50', '-60', '-70', '-80']
  const TABLE = LITERALS.map((l) => romValue(l, 16)) // -4,-16,-32,-48,-64,-80,-96,-112,-128

  it.skipIf(!sourceAvailable)('the PLPOSZ literals are still on RBARON.MAC:2482, in a hex region', () => {
    const line = romLine('RBARON.MAC', 2482)
    expect(line).toContain('PLPOSZ')
    for (const l of LITERALS) expect(line).toContain(l)
    expect(radixAt('RBARON.MAC', 2482)).toBe(16)
  })

  it('LENGTH — the table has NINE entries, not five', () => {
    expect(exportedValue('returning-ace', 'PLPOSZ')).toHaveLength(9)
  })

  it('SIGN — every entry is NEGATIVE (it is ADDED to the depth, so the depth falls)', () => {
    const t = exportedValue('returning-ace', 'PLPOSZ') as readonly number[]
    for (const v of t) expect(v).toBeLessThan(0)
  })

  it('MAGNITUDE — the entries are the hex bytes, not the decimal digits', () => {
    expect(exportedValue('returning-ace', 'PLPOSZ')).toEqual(TABLE)
    // The shipped table, refuted entry by entry.
    expect(exportedValue('returning-ace', 'PLPOSZ')).not.toEqual([8, 10, 13, 16, 20])
  })

  it('RAMP — GMLEVL 0→5 is a 20× acceleration in closing rate, not our 2.5×', () => {
    const t = exportedValue('returning-ace', 'PLPOSZ') as readonly number[]
    // Only GMLEVL 0..5 is ever reached (PLNZD indexes it), i.e. -4 .. -80.
    const reachable = t.slice(0, 6)
    for (let i = 1; i < reachable.length; i++) {
      expect(Math.abs(reachable[i])).toBeGreaterThan(Math.abs(reachable[i - 1])) // strictly faster
    }
    expect(Math.abs(reachable[5]) / Math.abs(reachable[0])).toBe(20)
  })
})

describe('AC-1 — the wreck spins at 0x180 angle-units per frame = 67.5°, not 45°', () => {
  it.skipIf(!sourceAvailable)('UPPLX0 adds 0x80 to the low byte and 1 to the high — 0x0180 a frame', () => {
    expect(romLine('RBARON.MAC', 2999)).toContain('ADC I,80')
    expect(radixAt('RBARON.MAC', 2999)).toBe(16)
    expect(romLine('RBARON.MAC', 471)).toContain('P.MAXR') // the angle SCALE…
    expect(romLine('RBARON.MAC', 471)).toContain('1FF') // …0x200 units = 90°
  })

  it('SPIN_RATE is 3π/8 per calc-frame', () => {
    // P.MAXR = 0x1FF ";90 DEGREE MAX ROTATION" fixes the scale: 0x200 = 512 units = 90°,
    // so a full turn is 2048 units. The wreck advances 0x180 = 384 of them per frame.
    const perFrame = (romValue('1', 16) << 8) | romValue('80', 16) // 0x180 = 384
    const fullTurn = 4 * (romValue('200', 16) as number) // 4 × 90° = 2048 units
    const expected = (perFrame / fullTurn) * 2 * Math.PI // = 3π/8 = 67.5°

    expect(expected).toBeCloseTo((3 * Math.PI) / 8, 12)
    expect(exportedNumber('explosion', 'SPIN_RATE')).toBeCloseTo(expected, 12)
    expect(exportedNumber('explosion', 'SPIN_RATE')).not.toBeCloseTo(Math.PI / 4, 6) // the shipped 45°
  })
})

// ═════════════════════════════════════════════════════════════════════════════════
// AC-5 — the DECIMAL islands must NOT be swept. This is the guard that stops the fix
// from becoming the next bug: `037007.XXX` genuinely is `.RADIX 10`, and reading its
// geometry as decimal is RIGHT. Sweeping it to hex would break every shape.
// ═════════════════════════════════════════════════════════════════════════════════

describe('AC-5 — the decimal islands are NOT swept (the geometry stays decimal)', () => {
  it('PFOPOS keeps its DECIMAL reading — 15 is fifteen, not 0x15 = 21', () => {
    // 037007.XXX:88  SEGSTR 3,6,9,15.   — inside the `.RADIX 10` region opened at :80.
    // If someone "helpfully" applies rb4-1's hex correction here, these become
    // 21 / 17 / 19 / 16 and the mountain segment scan walks off its point table.
    const pfopos = exportedValue('topology', 'PFOPOS') as readonly (readonly number[])[]
    expect(pfopos[4]).toEqual([3, 6, 9, 15])
    expect(pfopos[5]).toEqual([2, 3, 6, 11])
    expect(pfopos[6]).toEqual([2, 5, 9, 13])
    expect(pfopos[7]).toEqual([3, 5, 7, 10])

    // The refutation, spelled out: the hex misreading is a DIFFERENT table.
    expect(pfopos[4]).not.toEqual([3, 6, 9, 0x15])
    expect(pfopos[5]).not.toEqual([2, 3, 6, 0x11])
  })

  it('the 42-vertex biplane keeps its DECIMAL coordinates — and this is the whole story', () => {
    // PLANE_POINTS[0] = [0, 0, 40]. That literal 40 is DECIMAL forty, because the picture
    // ROM is `.RADIX 10` from 037007.XXX:80.
    //
    // Meanwhile HORIZN =40 on RBARON.MAC:456 is HEX — 0x40 = 64.
    //
    // The SAME TWO DIGITS, in two different regions, are two different numbers. That is
    // the entire bug, and it is why this sweep must be surgical: read the region, not the
    // digits. Sweep the biplane to hex and [0,0,40] becomes [0,0,64] — the plane inflates
    // and every shape in the game is wrong.
    const pts = exportedValue('biplane', 'PLANE_POINTS') as readonly (readonly number[])[]
    expect(pts).toHaveLength(42)
    expect(pts[0]).toEqual([0, 0, 40])
    expect(pts[1]).toEqual([-16, 0, 40])

    // The refutation: the hex misreading is a DIFFERENT, bigger aeroplane.
    expect(pts[0]).not.toEqual([0, 0, 0x40]) // 64
    expect(pts[1]).not.toEqual([-0x16, 0, 0x40]) // [-22, 0, 64]
  })
})

// ═════════════════════════════════════════════════════════════════════════════════
// AC-2 — provenance. A bare number is a failure of this story: every corrected
// constant must say WHICH ROM line it came from and WHICH radix region governs it.
// And no production file may cite the DECOY BUILD.
// ═════════════════════════════════════════════════════════════════════════════════

/**
 * The files THIS story rewrites. Deliberately NOT every file under src/core/:
 * purging the decoy citation from the whole tree is rb4-2's job (RETRACT THE POISONED
 * DOC), and topology.ts is out of bounds here by AC-5. A story that edits files it has
 * no reason to touch cannot be reviewed against its own diff.
 */
const REWRITTEN_FILES = ['enemy', 'guns', 'explosion', 'landscape', 'waves', 'returning-ace', 'scoring', 'scene'] as const

function coreSource(name: string): string {
  return readFileSync(join(repoRoot, 'src', 'core', `${name}.ts`), 'utf8')
}

describe('AC-2 — the files this story rewrites no longer cite the DECOY build', () => {
  // R2BRON/R2GRND is the build that NEVER SHIPPED. It sits beside the real one and
  // differs in two lines (FRMECNT=5 vs 4), so citing it is invisible and catastrophic.
  // Our findings doc cited it — that is where the bad constants came from — and the
  // citation propagated into src/core/. tools/audit/check-citations.mjs already rejects
  // it in the audit; the constants this story re-cites must be held to the same standard.
  //
  // The remaining R2BRON citations elsewhere in src/core/ (flight, lives, blimp,
  // topology…) are rb4-2's to purge — filed as a Delivery Finding, not swept here.
  it.each(REWRITTEN_FILES)('src/core/%s.ts cites no R2BRON.MAC / R2GRND.MAC', (name) => {
    expect(coreSource(name)).not.toMatch(/R2BRON|R2GRND/)
  })
})

describe("AC-2 — the story's own doc comments do not restate the bug they exist to kill", () => {
  // rb4-1 REWORK 2 (Reviewer finding 6). This story is about a decimal being read as hex.
  // The doc comment the story ADDED at returning-ace.ts:67-68 describes the PLPOSZ ramp as
  // reaching "-0x80" — but that is PLPOSZ[8] = -128, which GMLEVL can never index
  // (MAX_GMLEVL = max(PLNLVL) = 5). The ramp's real top is PLPOSZ[5] = -0x50 = -80 decimal.
  //
  // Somebody wrote DECIMAL 80 as HEX 0x80. In the file this story wrote. In prose explaining
  // the radix fix. It is the identical error Dev correctly caught and rejected in TEA's own
  // `t[5] = -0x80` assertion, reproduced one file over — which is exactly how the original
  // bug propagated: through a document that everyone trusted and nobody re-derived.
  //
  // A comment cannot be type-checked, so the suite checks it.
  it('returning-ace.ts does not claim the GMLEVL ramp reaches -0x80 (that is PLPOSZ[8], unreachable)', () => {
    const src = coreSource('returning-ace')
    const comments = src.match(/\/\*[\s\S]*?\*\/|\/\/.*/g)?.join('\n') ?? ''
    expect(
      comments,
      'PLPOSZ[8] = -0x80 = -128 would be a 32x ramp and GMLEVL cannot reach index 8. The ' +
        'reachable top is PLPOSZ[5] = -0x50 = -80 decimal — a 20x ramp, which is what the ' +
        'comment means and not what it says. Writing decimal 80 as hex 0x80 is THIS STORY\'S ' +
        'OWN BUG.',
    ).not.toMatch(/-0x80/i)
  })

  it('…and the 20x ramp the comment claims is the one the TABLE actually delivers', async () => {
    // Derive it rather than assert it: the comment must be TRUE of the real data. GMLEVL is
    // bounded by MAX_GMLEVL = max(PLNLVL) = 5, so PLPOSZ[5] is the fastest the plane can ever
    // close — index 8 is unreachable and its -0x80 is a number from nowhere.
    const plposz = exportedValue('returning-ace', 'PLPOSZ') as readonly number[]
    const { MAX_GMLEVL } = await import('../../src/core/scoring')
    const slowest = Math.abs(plposz[0])
    const fastest = Math.abs(plposz[MAX_GMLEVL])
    expect(fastest / slowest).toBe(20) // -0x50 / -0x04 — the ramp the comment describes
    expect(fastest).toBe(0x50)
    expect(fastest).not.toBe(0x80) // the value the comment CLAIMS. It is not in reach.
  })
})

describe('AC-2 — every corrected constant cites its ROM line AND its radix region', () => {
  it.each(MANIFEST.filter((t) => t.module !== 'topology'))(
    '$ours carries its $romFile citation and names its radix region',
    (t) => {
      const src = coreSource(t.module)
      const decl = new RegExp(`\\b${t.ours}\\b\\s*[:=]`)
      expect(src, `${t.module}.ts must still declare ${t.ours}`).toMatch(decl)

      // Somewhere in the file, the ROM line this constant came from.
      expect(src, `${t.ours} must cite ${t.romFile}:${t.romLine}`).toContain(`${t.romFile}:${t.romLine}`)
      // …and the radix that governs it. A bare number is a failure of this story.
      expect(src, `${t.ours} must name the RADIX 16 region that governs it`).toMatch(/RADIX 16/)
    },
  )

  it('scene.ts no longer repeats the un-radixed "HORZ = 1000"', () => {
    // scene.ts:32 read "past the horizon distance (findings §7 HORZ = 1000, with
    // headroom)". HORZ is 0x1000 = 4096. The comment reproduced the poisoned doc's
    // un-radixed digits and made 20000 look like 20× the horizon when it is under 5×.
    expect(coreSource('scene')).not.toMatch(/HORZ\s*=\s*1000\b(?!\s*\/)/)
  })
})

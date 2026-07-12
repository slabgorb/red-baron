import { describe, it, expect } from 'vitest'
import {
  edgeKey, diffEdges, pairOne, pairPictures, verdictFor, ROM_TO_PORT, type PicturePair, type PortPicture,
} from '../../src/tools/romCompare'
import { ROM_PICTURES, type RomPicture } from '../../src/tools/romPictures.generated'

describe('edgeKey', () => {
  it('is orientation-independent', () => {
    expect(edgeKey([3, 1])).toBe(edgeKey([1, 3]))
  })
})

describe('diffEdges', () => {
  it('reports each side exclusively', () => {
    const d = diffEdges([[0, 1], [1, 2]], [[1, 0], [2, 3]])
    expect(d.onlyInRom).toEqual(['1-2'])
    expect(d.onlyInPort).toEqual(['2-3'])
  })

  it('finds no drift between identical sets', () => {
    const d = diffEdges([[0, 1]], [[1, 0]])
    expect(d.onlyInRom).toEqual([])
    expect(d.onlyInPort).toEqual([])
  })

  it('never reports a degenerate self-edge (a === b) as drift, on either side', () => {
    const d = diffEdges([[0, 1], [5, 5]], [[1, 0], [7, 7]])
    expect(d.onlyInRom).toEqual([])
    expect(d.onlyInPort).toEqual([])
  })
})

describe('ROM_TO_PORT', () => {
  it('every key names a real ROM_PICTURES name', () => {
    const romNames = new Set(ROM_PICTURES.map((m) => m.name))
    for (const key of Object.keys(ROM_TO_PORT)) {
      expect(romNames.has(key), `ROM_TO_PORT key '${key}' is not a real ROM_PICTURES name`).toBe(true)
    }
  })

  it('maps EVERY ROM_PICTURES entry — unlike star-wars, every baked picture has a port counterpart', () => {
    for (const rom of ROM_PICTURES) {
      expect(ROM_TO_PORT[rom.name], rom.name).toBeDefined()
    }
    expect(Object.keys(ROM_TO_PORT)).toHaveLength(ROM_PICTURES.length)
  })

  it('Collision pts has an empty connect-list on the port side too (points-only on both sides)', () => {
    expect(ROM_TO_PORT['Collision pts'].connect).toEqual([])
  })
})

describe('pairPictures — the headline result', () => {
  const pairs = pairPictures()

  it('pairs every ROM picture with a port counterpart', () => {
    expect(pairs).toHaveLength(ROM_PICTURES.length)
    for (const p of pairs) expect(p.port, p.name).not.toBeNull()
  })

  // THE PROJECT'S HEADLINE DELIVERABLE. Unlike star-wars (whose port edges
  // were guessed), red-baron's port connect-lists were transcribed DIRECTLY
  // from the same ROM tables this bake reads — so the expected, unremarkable
  // result is ZERO drift across the board. Pin that here: if a future change
  // to the parser, the ROM_TO_PORT map, or core/topology.ts|biplane.ts moves
  // any of these off zero, this test forces that to be a deliberate,
  // investigated change — not a silent regression.
  it.each(ROM_PICTURES.map((p) => p.name))('%s: ROM vertices deep-equal the port vertices', (name) => {
    const p = pairs.find((pair) => pair.name === name)!
    expect(p.verticesMatch, name).toBe(true)
  })

  // `pairOne` deliberately returns EMPTY diffs whenever `!verticesMatch` (an
  // edge diff across mismatched vertices is meaningless — see romCompare.ts).
  // That makes `onlyInRom`/`onlyInPort` both `[]` a state that is reached two
  // different ways: real zero drift, OR a vertex mismatch masking the diff.
  // Asserting `verticesMatch` in the SAME test as the edge-drift assertion
  // (not just in the separate `it.each` above) is what makes this test
  // non-vacuous: without it, deleting the "ROM vertices deep-equal" block
  // would leave this test green even if the vertices had drifted apart.
  it.each(ROM_PICTURES.filter((p) => p.connect.length > 0).map((p) => p.name))(
    '%s: zero edge drift AND vertices match (so the empty diff cannot be a masked vertex mismatch)',
    (name) => {
      const p = pairs.find((pair) => pair.name === name)!
      expect(p.verticesMatch, name).toBe(true)
      expect(p.onlyInRom, name).toEqual([])
      expect(p.onlyInPort, name).toEqual([])
    },
  )

  it('Collision pts is pointsOnly and never carries an edge claim', () => {
    const p = pairs.find((pair) => pair.name === 'Collision pts')!
    expect(p.pointsOnly).toBe(true)
    expect(p.onlyInRom).toEqual([])
    expect(p.onlyInPort).toEqual([])
  })

  it('every non-Collision picture is NOT pointsOnly (they all carry a ROM connect-list)', () => {
    for (const p of pairs) {
      if (p.name !== 'Collision pts') expect(p.pointsOnly, p.name).toBe(false)
    }
  })
})

// Finding-mirroring guard: edges are INDICES into `points`. If the ROM and
// port point arrays were ever to disagree (reordered, different length),
// every edge index would point at a different vertex and an edge diff would
// report FABRICATED drift while looking completely normal. `pairOne` must
// refuse to diff edges in that case. These fixtures are fabricated, not real
// data — the real pairs are proven to agree by the deep-equal tests above.
describe('pairOne: the vertex-mismatch guard', () => {
  const romWith = (points: RomPicture['points'], connect: RomPicture['connect']): RomPicture => ({
    name: 'X',
    points,
    connect,
    edges: [[0, 1], [1, 2]],
  })
  const portWith = (points: PortPicture['points'], connect: PortPicture['connect']): PortPicture => ({
    points,
    connect,
  })
  const V = (point: number) => ({ point, draw: true })
  const B = (point: number) => ({ point, draw: false })

  it('refuses to diff edges when points are reordered past index 0 (same length, same first point)', () => {
    const rom = romWith([[0, 0, 0], [1, 1, 1], [2, 2, 2]], [B(0), V(1), V(2)])
    const port = portWith([[0, 0, 0], [2, 2, 2], [1, 1, 1]], [B(0), V(1), V(2)])
    const p = pairOne(rom, port)
    expect(p.verticesMatch).toBe(false)
    expect(p.onlyInRom).toEqual([])
    expect(p.onlyInPort).toEqual([])
  })

  it('refuses to diff edges when the point arrays differ in length', () => {
    const rom = romWith([[0, 0, 0], [1, 1, 1], [2, 2, 2]], [B(0), V(1), V(2)])
    const port = portWith([[0, 0, 0], [1, 1, 1]], [B(0), V(1)])
    const p = pairOne(rom, port)
    expect(p.verticesMatch).toBe(false)
    expect(p.onlyInRom).toEqual([])
    expect(p.onlyInPort).toEqual([])
  })

  it('diffs edges normally when points are deep-equal and both carry a connect-list', () => {
    const rom = romWith([[0, 0, 0], [1, 1, 1], [2, 2, 2]], [B(0), V(1), V(2)])
    const port = portWith([[0, 0, 0], [1, 1, 1], [2, 2, 2]], [B(0), V(1), V(2)])
    const p = pairOne(rom, port)
    expect(p.verticesMatch).toBe(true)
    expect(p.onlyInRom).toEqual([])
    expect(p.onlyInPort).toEqual([])
  })

  it('never diffs edges for a pointsOnly ROM picture even when the port carries a connect-list', () => {
    const rom = romWith([[0, 0, 0], [1, 1, 1]], []) // empty ROM connect — points only
    const port = portWith([[0, 0, 0], [1, 1, 1]], [B(0), V(1)])
    const p = pairOne(rom, port)
    expect(p.pointsOnly).toBe(true)
    expect(p.onlyInRom).toEqual([])
    expect(p.onlyInPort).toEqual([])
  })

  it('returns a null-port pair when there is no port mapping', () => {
    const rom = romWith([[0, 0, 0]], [])
    const p = pairOne(rom, null)
    expect(p.port).toBeNull()
    expect(p.verticesMatch).toBe(false)
    expect(p.onlyInRom).toEqual([])
    expect(p.onlyInPort).toEqual([])
  })
})

describe('verdictFor', () => {
  const rom = (connect: RomPicture['connect'] = [{ point: 0, draw: false }]): RomPicture => ({
    name: 'X', points: [], connect, edges: [],
  })
  const port: PortPicture = { points: [], connect: [] }

  it('shows the warning + exact counts when edges drift', () => {
    const p: PicturePair = {
      name: 'X', rom: rom(), port, portEdges: [], pointsOnly: false, verticesMatch: true,
      onlyInRom: ['1-2'], onlyInPort: ['3-4', '5-6'],
    }
    const v = verdictFor(p)
    expect(v.drift).toBe(true)
    expect(v.text).toBe('⚠ 1 in ROM not in port · 2 in port not in ROM')
  })

  it('claims edges match when a non-pointsOnly pair has zero drift', () => {
    const p: PicturePair = {
      name: 'X', rom: rom(), port, portEdges: [], pointsOnly: false, verticesMatch: true,
      onlyInRom: [], onlyInPort: [],
    }
    expect(verdictFor(p).text).toBe('✓ edges match')
    expect(verdictFor(p).drift).toBe(false)
  })

  it('NEVER claims edge drift for a pointsOnly pair — reports point agreement instead', () => {
    const matching: PicturePair = {
      name: 'Collision pts', rom: rom([]), port, portEdges: [], pointsOnly: true, verticesMatch: true,
      onlyInRom: [], onlyInPort: [],
    }
    const v = verdictFor(matching)
    expect(v.text).toBe('✓ points match (points only)')
    expect(v.drift).toBe(false)
    expect(v.text).not.toMatch(/edge/)
  })

  it('reports a points mismatch (not a fabricated edge count) for a pointsOnly pair whose points differ', () => {
    const p: PicturePair = {
      name: 'Collision pts', rom: rom([]), port, portEdges: [], pointsOnly: true, verticesMatch: false,
      onlyInRom: [], onlyInPort: [],
    }
    const v = verdictFor(p)
    expect(v.text).toBe('⚠ points differ (points only)')
    expect(v.drift).toBe(true)
    expect(v.text).not.toMatch(/edge/)
  })

  it('reports "vertices differ" instead of a match/drift verdict when a non-pointsOnly pair has mismatched points', () => {
    const p: PicturePair = {
      name: 'X', rom: rom(), port, portEdges: [], pointsOnly: false, verticesMatch: false,
      onlyInRom: [], onlyInPort: [],
    }
    expect(verdictFor(p).text).toBe('vertices differ — edge diff not meaningful')
  })

  it('shows a neutral dash when the ROM picture has no port mapping', () => {
    const p: PicturePair = {
      name: 'X', rom: rom(), port: null, portEdges: [], pointsOnly: false, verticesMatch: false,
      onlyInRom: [], onlyInPort: [],
    }
    expect(verdictFor(p).text).toBe('— no port mapping')
  })
})

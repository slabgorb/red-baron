import { describe, it, expect } from 'vitest'
import { modelBounds, fitDistance, cellRects } from '../../src/tools/sheetLayout'
import type { Vec3 } from '@arcade/shared/math3d'

const CUBE: readonly Vec3[] = [
  [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
  [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
]

describe('modelBounds', () => {
  it('centres the unit cube at the origin with the corner radius', () => {
    const { center, radius } = modelBounds(CUBE)
    expect(center[0]).toBeCloseTo(0)
    expect(center[1]).toBeCloseTo(0)
    expect(center[2]).toBeCloseTo(0)
    expect(radius).toBeCloseTo(Math.sqrt(0.75)) // half space-diagonal of a 1×1×1 cube
  })

  it('finds the AABB centre of an off-origin point set', () => {
    const points: readonly Vec3[] = [[0, 0, 0], [10, 4, -2]]
    expect(modelBounds(points).center).toEqual([5, 2, -1])
  })

  it('a single point has zero radius and is its own centre', () => {
    const { center, radius } = modelBounds([[3, -1, 7]])
    expect(center).toEqual([3, -1, 7])
    expect(radius).toBe(0)
  })
})

describe('fitDistance', () => {
  it('grows with radius', () => {
    expect(fitDistance(200, Math.PI / 3)).toBeGreaterThan(fitDistance(100, Math.PI / 3))
  })
  it('is finite and positive for a degenerate (zero-radius) model', () => {
    const d = fitDistance(0, Math.PI / 3)
    expect(Number.isFinite(d)).toBe(true)
    expect(d).toBeGreaterThan(0)
  })
})

describe('cellRects', () => {
  it('returns one rect per item', () => {
    expect(cellRects(900, 600, 6, 3)).toHaveLength(6)
  })
  it('lays items out row-major across the given columns', () => {
    const r = cellRects(900, 600, 6, 3) // 3 cols × 2 rows ⇒ 300×300 cells
    expect(r[0]).toEqual({ x: 0, y: 0, w: 300, h: 300 })
    expect(r[2]).toEqual({ x: 600, y: 0, w: 300, h: 300 })
    expect(r[3]).toEqual({ x: 0, y: 300, w: 300, h: 300 })
    expect(r[5]).toEqual({ x: 600, y: 300, w: 300, h: 300 })
  })
  it('covers the full width with no gaps', () => {
    const r = cellRects(800, 600, 4, 2)
    expect(r[1].x + r[1].w).toBeCloseTo(800)
  })
})

// tests/scaffold.test.ts
//
// Red Baron-internal scaffold contract (rb1-1). These tests read Red Baron's
// OWN config files (they never reach up into the orchestrator — a standalone
// `git clone red-baron` must still pass) and pin the invariants the epic's
// toolchain ruling names: pinned port 5277 (NOT 5270/5273/5274/5275/5276, which
// belong to lobby/tempest/star-wars/asteroids/battlezone), base '/',
// strictPort + allowedHosts on both server and preview, package.json scripts
// copied verbatim from the sibling games, TS strict, and a black-canvas
// index.html booting src/main.ts.
//
// THE SHARED-CONSUMER TWIST: unlike battlezone/star-wars (which ported a local
// math3d.ts), Red Baron is the FIRST arcade game built as a native @arcade/shared
// consumer. So instead of a "local math3d provenance" check, this suite proves
// the dependency PIPE end to end: package.json pins @arcade/shared at v0.5.0, and
// a live `import('@arcade/shared/math3d')` resolves to the real Math Box under
// vitest. rb1-3 will build the flight camera on it; rb1-1 only proves it resolves.
//
// RED until GREEN adds vite.config.ts / tsconfig.json / index.html / src/main.ts
// and pins + installs @arcade/shared. The cross-repo wiring invariants
// (.gitignore, repos.yaml, justfile, lobby tile, cloudflared) live in the
// orchestrator suite: tests/red-baron-bootstrap.test.mjs.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// tests/scaffold.test.ts → repo root is one level up from tests/.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const path = (rel: string): string => join(root, rel)
const read = (rel: string): string => readFileSync(path(rel), 'utf8')
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1

// Red Baron owns 5277. Every other pin belongs to a live sibling and must never
// leak into this config: 5270 lobby, 5273 tempest, 5274 star-wars, 5275
// asteroids, 5276 battlezone.
const RED_BARON_PORT = '5277'
const TAKEN_PORTS = ['5270', '5273', '5274', '5275', '5276']

describe('scaffold — vite.config.ts (pinned port 5277, base /)', () => {
  it('vite.config.ts exists', () => {
    expect(existsSync(path('vite.config.ts')), 'red-baron/vite.config.ts must exist').toBe(true)
  })

  it('serves under base /', () => {
    expect(read('vite.config.ts')).toMatch(/base:\s*['"]\/['"]/)
  })

  it('pins port 5277 on both the dev server and preview', () => {
    const cfg = read('vite.config.ts')
    // Count actual `port:` ASSIGNMENTS (server + preview), not bare occurrences of
    // the number — the config comment also names 5277, so a raw substring count
    // would still pass (comment + one block) if a block dropped its port.
    const portAssignments = cfg.match(new RegExp(`port:\\s*${RED_BARON_PORT}`, 'g')) ?? []
    expect(portAssignments.length).toBeGreaterThanOrEqual(2)
  })

  it('does NOT reuse a sibling pinned port (5270/5273/5274/5275/5276)', () => {
    // Port-collision guard. Every one of these is already bound by a live sibling
    // game/lobby; Red Baron must own 5277 alone.
    const cfg = read('vite.config.ts')
    for (const taken of TAKEN_PORTS) {
      expect(cfg, `vite.config.ts must not reference the already-pinned port ${taken}`).not.toContain(
        taken,
      )
    }
  })

  it('keeps strictPort: true on both server and preview (fail loud on collision)', () => {
    const cfg = read('vite.config.ts')
    expect(count(cfg, 'strictPort: true')).toBeGreaterThanOrEqual(2)
  })

  it('allow-lists arcade.slabgorb.com on both server and preview (tunnel Host)', () => {
    const cfg = read('vite.config.ts')
    // Count actual `allowedHosts: ['arcade.slabgorb.com']` ENTRIES, not bare
    // hostname mentions — a config comment names the host too, so a raw substring
    // count could pass even with both allowedHosts entries deleted.
    const allowLists = cfg.match(/allowedHosts:\s*\[\s*['"]arcade\.slabgorb\.com/g) ?? []
    expect(allowLists.length).toBeGreaterThanOrEqual(2)
  })
})

describe('scaffold — package.json scripts (verbatim from the sibling games)', () => {
  const pkg = (): Record<string, unknown> => JSON.parse(read('package.json'))
  const scripts = (): Record<string, string> =>
    (pkg().scripts ?? {}) as Record<string, string>

  it('dev → vite', () => {
    expect(scripts().dev).toBe('vite')
  })

  it('build → tsc --noEmit && vite build', () => {
    expect(scripts().build).toBe('tsc --noEmit && vite build')
  })

  it('preview → vite preview', () => {
    expect(scripts().preview).toBe('vite preview')
  })

  it('test → vitest run --passWithNoTests', () => {
    expect(scripts().test).toBe('vitest run --passWithNoTests')
  })

  it('test:watch → vitest', () => {
    expect(scripts()['test:watch']).toBe('vitest')
  })

  it('lint → tsc --noEmit', () => {
    expect(scripts().lint).toBe('tsc --noEmit')
  })

  it('declares vite, vitest, and typescript as devDependencies', () => {
    const dev = (pkg().devDependencies ?? {}) as Record<string, string>
    expect(dev.vite, 'vite devDependency').toBeTruthy()
    expect(dev.vitest, 'vitest devDependency').toBeTruthy()
    expect(dev.typescript, 'typescript devDependency').toBeTruthy()
  })
})

describe('scaffold — tsconfig.json (TypeScript strict, mirrors the sibling games)', () => {
  it('tsconfig.json exists', () => {
    expect(existsSync(path('tsconfig.json')), 'red-baron/tsconfig.json must exist').toBe(true)
  })

  it('enables strict mode', () => {
    // tsconfig may carry comments/trailing commas; assert on the raw text so a
    // JSON5-ish config still parses under this contract.
    expect(read('tsconfig.json')).toMatch(/"strict":\s*true/)
  })
})

describe('scaffold — index.html boots a canvas via src/main.ts', () => {
  it('index.html exists', () => {
    expect(existsSync(path('index.html')), 'red-baron/index.html must exist').toBe(true)
  })

  it('loads the src/main.ts module and hosts a <canvas>', () => {
    const html = read('index.html')
    expect(html).toMatch(/src=['"]\/src\/main\.ts['"]/)
    expect(html).toMatch(/<canvas/i)
  })
})

describe('scaffold — first native @arcade/shared consumer (proves the dependency pipe)', () => {
  // Red Baron does NOT port math3d like the older games. It consumes the extracted
  // Math Box from @arcade/shared/math3d at a pinned git-URL tag. rb1-1 only proves
  // the pipe resolves; rb1-3 builds the flight camera on it.

  it('does NOT keep a local src/core/math3d.ts (the Math Box lives in @arcade/shared/math3d)', () => {
    expect(
      existsSync(path('src/core/math3d.ts')),
      'red-baron must NOT port a local math3d.ts — it consumes @arcade/shared/math3d (design brief §3)',
    ).toBe(false)
  })

  it('pins @arcade/shared as a git-URL dependency', () => {
    // The invariant rb1-1 actually cares about: the dependency pipe is a git-URL pin at
    // an explicit ref, never a floating range.
    //
    // SH2-18: this used to hard-code `#v0.12.0`, which made it a tripwire on every pin
    // bump rather than a guard (SH2-14 already had to rewrite it once). Worse, a shared
    // extraction pins the FEATURE BRANCH during the dev inner-loop and only moves to the
    // `vX.Y.Z` tag at release — so an exact-tag match would have to be edited twice per
    // story. So the shape is pinned here, and what the code actually NEEDS (a resolved
    // package new enough to carry /synth) is proven below, which is the stronger check.
    expect(read('package.json')).toMatch(
      /"@arcade\/shared":\s*"github:slabgorb\/arcade-shared#[^"]+"/,
    )
  })

  it('resolves an @arcade/shared new enough to carry /synth (SH2-18)', async () => {
    // The honest version guard: not "which tag is written in package.json" but "does the
    // installed package actually have the code red-baron imports". A stale lockfile (the
    // classic git-dep trap: editing the #ref and running a bare `npm install` keeps the
    // OLD commit) fails right here.
    const installed = JSON.parse(
      readFileSync(path('node_modules/@arcade/shared/package.json'), 'utf8'),
    ) as { version: string }
    const [maj, min] = installed.version.split('.').map((n) => Number.parseInt(n, 10))
    expect(
      maj > 0 || min >= 14,
      `@arcade/shared ${installed.version} is too old — /synth landed in 0.14.0 (stale lockfile?)`,
    ).toBe(true)

    const synth = await import('@arcade/shared/synth')
    expect(typeof synth.createSynthEngine, '@arcade/shared/synth must export createSynthEngine').toBe(
      'function',
    )
  })

  it('resolves @arcade/shared/math3d to the real Math Box at runtime', async () => {
    // The load-bearing proof: if the dep is unpinned/uninstalled this import
    // rejects (RED). Once GREEN pins + installs it, the real module resolves and
    // its core identities hold — this is the whole point of rb1-1.
    const m3d = await import('@arcade/shared/math3d')
    expect(Array.isArray(m3d.IDENTITY), '@arcade/shared/math3d must export IDENTITY').toBe(true)
    expect(m3d.IDENTITY.length, 'IDENTITY is a length-16 row-major mat4').toBe(16)
    // Normalise signed zero (rotationY(0) yields -0 from -sin(0)) so the mat4
    // identity comparison is mathematical, not bitwise: -0 and +0 are equal reals.
    const noNegZero = (m: readonly number[]): number[] => m.map((v: number) => v + 0)
    // multiply(IDENTITY, IDENTITY) === IDENTITY, and rotationY(0) === IDENTITY.
    expect(noNegZero(m3d.multiply(m3d.IDENTITY, m3d.IDENTITY))).toEqual([...m3d.IDENTITY])
    expect(noNegZero(m3d.rotationY(0))).toEqual([...m3d.IDENTITY])
    // Non-trivial operand so this discriminates the REAL Math Box from an
    // identity-shaped stub: I · T(1,2,3) must equal T(1,2,3), not IDENTITY.
    const t = m3d.translation(1, 2, 3)
    expect(noNegZero(m3d.multiply(m3d.IDENTITY, t))).toEqual([...t])
  })
})

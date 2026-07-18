// tests/helpers/boot-cockpit.ts
//
// Story rb4-4 (TEA) — the shared BOOTED-COCKPIT harness, extracted from the
// rb4-1 pattern in tests/cockpit-loop.test.ts. `document` and `window` are just
// globals; this stubs them, imports src/main.ts, captures the rAF callback, and
// drives THE REAL LOOP — the real accumulator, the real calc-frames — against a
// fake canvas that records every stroke AND every HUD text.
//
// Two deliberate extensions over the rb4-1 original:
//
//   * KEYS. The rb4-1 harness had no pilot ("no keys are ever held"). rb4-4 is
//     the story that makes the game killable, so the harness must be able to
//     HOLD FIRE and BANK. `pressKey`/`releaseKey` dispatch to every handler
//     main.ts registered, exactly as the browser would.
//   * FAST TICKS. The rb4-1 harness ticks 16 ms (a 60 Hz browser). The dead
//     mechanics live at the ~10.42 Hz calc-frame cadence (timing.ts), and the
//     ace pass needs ~1000 calc frames to develop — so this harness lets a tick
//     advance `nowMs` by a caller-chosen step (default 96 ms = exactly ONE calc
//     frame per display frame; the fixed-step accumulator handles any dt, and
//     96 ms is far below main.ts's own 250 ms catch-up cap, so the loop under
//     test is byte-for-byte the shipped loop).
//
// This helper stubs globals and boots; it takes NO vi.mock — module taps
// (returning-ace, shell/audio) belong to each test file, where vitest hoists
// them.

import { vi } from 'vitest'

/** One recorded vector stroke on the fake canvas. */
export interface Stroke {
  readonly op: 'moveTo' | 'lineTo'
  readonly x: number
  readonly y: number
}

/** Everything one display frame painted: stroke batches (split at beginPath) + HUD texts. */
export interface Painted {
  /** Vector strokes, batched per beginPath — batch 0 is the horizon (drawn first in draw()). */
  readonly batches: readonly (readonly Stroke[])[]
  /** Every HUD text string the frame HANDED TO the glyph renderer, in draw order — the score
   *  readout, the GAME OVER card. rb4-19: since the HUD no longer draws through canvas fillText,
   *  this is tapped at core/hud-font's INPUT, so it proves the string was COMPUTED for this frame
   *  (the game decided to draw it), NOT that pixels reached the glass — the "reached the glass"
   *  guarantee is cockpit-draw-path.test.ts's stroke-count parity. Sufficient for the game-logic
   *  observations here (score counts up; GAME OVER appears); do not read it as a render assertion. */
  readonly texts: readonly string[]
}

export interface Cockpit {
  /** Advance the browser one display frame of `msStep` wall-clock ms. */
  tick(msStep?: number): Painted
  /** Hold a key down (dispatches every keydown handler main.ts registered). */
  pressKey(key: string): void
  /** Release a held key. */
  releaseKey(key: string): void
  readonly aspect: number
}

/**
 * Boot src/main.ts against a fake DOM and hand back a driving handle.
 *
 * `seedMs` is what `Date.now()` answers — main.ts seeds its Rng streams from it,
 * so a pinned seed makes the whole run deterministic without touching the game.
 * Callers that vi.mock modules must do so at file scope; this calls
 * `vi.resetModules()` so the boot always gets a fresh main.ts.
 */
export async function bootCockpit(width: number, height: number, seedMs: number): Promise<Cockpit> {
  vi.resetModules()

  let batches: Stroke[][] = [[]]
  let texts: string[] = []
  const ctx = {
    beginPath: () => batches.push([]),
    moveTo: (x: number, y: number) => batches[batches.length - 1].push({ op: 'moveTo', x, y }),
    lineTo: (x: number, y: number) => batches[batches.length - 1].push({ op: 'lineTo', x, y }),
    stroke: () => {},
    fillRect: () => {},
    fillText: (text: string) => texts.push(text),
    save: () => {},
    restore: () => {},
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    shadowColor: '',
    shadowBlur: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
    globalAlpha: 1,
  }
  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    getContext: () => ctx,
  }

  const keydownHandlers: Array<(e: unknown) => void> = []
  const keyupHandlers: Array<(e: unknown) => void> = []
  let rafCallback: ((nowMs: number) => void) | null = null
  vi.stubGlobal('document', { getElementById: () => canvas })
  vi.stubGlobal('window', {
    innerWidth: width,
    innerHeight: height,
    addEventListener: (event: string, cb: (e: unknown) => void) => {
      if (event === 'keydown') keydownHandlers.push(cb)
      if (event === 'keyup') keyupHandlers.push(cb)
    },
    removeEventListener: () => {},
    requestAnimationFrame: (cb: (nowMs: number) => void) => {
      rafCallback = cb
      return 1
    },
  })
  vi.spyOn(Date, 'now').mockReturnValue(seedMs)

  // rb4-19: the HUD readout is no longer canvas fillText — it strokes shared-font glyphs via
  // core/hud-font. Tap that renderer's INPUT (runtime doMock, before main is imported) so
  // Painted.texts keeps reporting the HUD strings. NB this observes what was COMPUTED for the
  // frame, not what reached the glass (see the Painted.texts doc). Passthrough: real glyphs draw.
  vi.doMock('../../src/core/hud-font', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/core/hud-font')>()
    return {
      ...actual,
      hudTextSegments: (text: string, opts: Parameters<typeof actual.hudTextSegments>[1]) => {
        texts.push(text)
        return actual.hudTextSegments(text, opts)
      },
    }
  })

  await import('../../src/main')
  if (rafCallback === null) throw new Error('main.ts never scheduled a frame — the cockpit did not boot')
  const frame = rafCallback as (nowMs: number) => void

  const keyEvent = (key: string): unknown => ({ key, repeat: false, preventDefault: () => {} })
  let nowMs = 0
  return {
    aspect: width / height,
    tick(msStep = 96): Painted {
      const painted: Stroke[][] = []
      batches = [[]]
      texts = []
      nowMs += msStep
      frame(nowMs)
      for (const b of batches) if (b.length > 0) painted.push(b)
      return { batches: painted, texts }
    },
    pressKey(key: string): void {
      for (const h of keydownHandlers) h(keyEvent(key))
    },
    releaseKey(key: string): void {
      for (const h of keyupHandlers) h(keyEvent(key))
    },
  }
}

// src/main.ts
//
// The runnable cockpit — flown by the rb2-1 flight model, now with a live enemy.
// The yoke is the keyboard (←/→ or A/D turn, ↑/↓ or W/S climb-dive); its input
// feeds a FlightInput the sim steps ONCE per calculation frame (timing.ts
// SIM_TIMESTEP_S — findings §1: the sim ticks at ~10.42 Hz, NOT per display frame,
// or it runs ~6× too fast — the ÷N fidelity trap). The stepped attitude drives the
// rb1 tilting horizon; MULTI-PLANE WAVES of weaving enemy biplanes (rb2-7) are
// spawned, stepped in the SAME calc-frame loop, and drawn through the rb2-3 biplane
// substrate.
//
// The NEAREST plane's live depth feeds DISCHK: proximityBand(nearestDepth) sets
// FlightInput.proximity, so the control feel SHARPENS as the closest enemy closes in
// (findings §2). No throttle: forward motion is implicit; the pilot commands only
// turn and pitch (findings §2).
//
// THE KILL PAYOFF (rb2-6): a shell that connects SCORES the plane BY ITS KIND (rb2-7 —
// PLVALU for a close lead, the flat DRONE_SCORE for a drone), bumps the kill count that
// ramps the difficulty (OBJKLD → gmlevlForKills → GMLEVL, widening the weave), and hands
// the plane to its UPPLEX wreck — it falls, spins, bursts into the PIECE0-3 debris.
//
// THE WAVE (rb2-7): score-scaled counts (300 → 2 planes, 1000 → 3), drones in the
// PLANE1/PLANE2 formation, PLNXCG lead promotion, and the MODECT/MCOUNT schedule
// (stepWaveClock) that brings the next wave in after its inter-wave gap (waves.ts).

import { flightView, type Attitude } from './core/camera'
import { horizonSegments } from './core/horizon'
import { INITIAL_FLIGHT, step, toAttitude, controlBand, type FlightInput } from './core/flight'
import { step as stepEnemy, proximityBand, type Enemy } from './core/enemy'
import {
  spawnWave, promoteLead, INITIAL_WAVE_CLOCK, stepWaveClock,
  grmodeForWave, planeGenDisabled, isGroundMode, GRMODE_PLANE,
} from './core/waves'
import { biplaneLOD, renderModel } from './core/biplane'
import {
  shouldSpawnBlimp, spawn as spawnBlimp, step as stepBlimp, blimpFires, type Blimp,
} from './core/blimp'
import { initialLives, loseLife, type Lives } from './core/lives'
import { initialMountains, stepMountain, mountainSegments, type Mountain } from './core/landscape'
import { sceneProjection, projectSegment, type SceneSegment } from './core/scene'
import { SIM_TIMESTEP_S } from './core/timing'
import { INITIAL_GUNS, fire, step as stepGuns, shellDepth, type Guns, type Shell } from './core/guns'
import { explode, stepWreck, EXPL2_FRAMES, type Wreck } from './core/explosion'
import { scoreKill, gmlevlForKills } from './core/scoring'
import { EXPLOSION_PIECES, BLIMP_PICTURE } from './core/topology'
import type { GameEvent } from './core/events'
import { createAudioEngine } from './shell/audio'
import { playEventSounds, updateContinuousSounds } from './shell/audio-dispatch'
import { multiply, translation, rotationZ, rotationY, type Vec3, type Mat4 } from '@arcade/shared/math3d'
import { createRng, nextFloat } from '@arcade/shared/rng'
import { INITIAL_PAUSED, isPauseKey, togglePaused } from '@arcade/shared/pause'
import { drawEscOverlay } from '@arcade/shared/esc-overlay'

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')

// rb4-1 REWORK 2: a hand-copied mirror of the gun's reach used to live here, and its own
// comment promised it would track the real one in core/guns. It didn't — copies don't track
// anything. When the reach was corrected against the ROM this stayed behind, and the tracer
// was drawn at an EIGHTH of the depth the same shell killed at. The conversion is now
// `guns.shellDepth`, the very function the collision test uses, so the picture and the hit
// cannot disagree. DO NOT reintroduce a local depth constant in this file: it is unreachable
// from the test suite (main.ts touches `document` at module scope, vitest runs under node),
// which is exactly why the last one rotted here unnoticed. See tests/core/tracer-seam.ts.

/** Each of the four PIECE0-3 debris fragments flies out along a distinct diagonal. Inferred. */
const DEBRIS_DIRS: readonly (readonly [number, number])[] = [
  [-1, 1],
  [1, 1],
  [-1, -1],
  [1, -1],
]
/** Window units each debris fragment spreads per exploding frame — the burst expands. Inferred. */
const DEBRIS_SPREAD = 4

/**
 * The BLIMP_PICTURE ROM geometry is authored NOSE-ON along local z; a quarter-turn yaw
 * presents the airship's flank (BROADSIDE), the way the cabinet frames the drifting
 * Zeppelin. Inferred — the source pins the geometry, not the presentation pose.
 */
const BLIMP_YAW = Math.PI / 2

/**
 * Screen-window |x| past which the drifting blimp has left the frame and is despawned.
 * blimp.step is unbounded by design (it never reverses), so main.ts owns the bound: the
 * airship enters at |x| ≤ ENTRY_X_MIN+RANGE (300) and drifts across, so this sits well
 * beyond the entry band. Inferred (BLMOTN off-screen bound is not byte-transcribed).
 */
const BLIMP_DESPAWN_X = 640

/**
 * Chance a blimp shot connects on one of its ÷2 fire-frames. `blimpFires` is a deterministic
 * even-frame cadence — costing a life on EVERY fire would kill the pilot in ~1 s — so a per-shot
 * hit roll turns the airship into a real threat that does not insta-kill (the hit model TEA
 * flagged for Dev). Inferred (BLMOTN's hit probability is not byte-transcribed).
 */
const BLIMP_HIT_CHANCE = 0.05

function resize(): void {
  canvas.width = canvas.clientWidth || window.innerWidth
  canvas.height = canvas.clientHeight || window.innerHeight
}

/** NDC ([-1, 1], +y up) → canvas pixels (y down). */
function toPixel(nx: number, ny: number, width: number, height: number): [number, number] {
  return [((nx + 1) / 2) * width, ((1 - ny) / 2) * height]
}

/** Stroke a list of NDC segments as glowing vectors on the current context. */
function strokeSegments(segs: readonly SceneSegment[], width: number, height: number): void {
  if (!ctx) return
  ctx.beginPath()
  for (const seg of segs) {
    const [x1, y1] = toPixel(seg.x1, seg.y1, width, height)
    const [x2, y2] = toPixel(seg.x2, seg.y2, width, height)
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
  }
  ctx.stroke()
}

/**
 * Project a player shell to a short glowing tracer streak. The shell's z (0..S.MAXZ) maps to
 * a world depth THROUGH THE GUN'S OWN CONVERSION (`shellDepth`) — the same one `collides`
 * uses — so the tracer is drawn at the depth the bullet would actually hit at. The streak
 * trails one z-unit behind so it reads as motion. The shell's (x, y) are world-window units,
 * the same space the enemy lives in.
 */
function shellSegments(shell: Shell, viewProj: Mat4): readonly SceneSegment[] {
  const wd = shellDepth(shell.z)
  const wdBack = shellDepth(Math.max(0, shell.z - 1))
  const front: Vec3 = [shell.x, shell.y, -wd]
  const back: Vec3 = [shell.x, shell.y, -wdBack]
  const seg = projectSegment(front, back, viewProj)
  return seg ? [seg] : []
}

/**
 * Draw the downed enemy (rb2-6): a spinning biplane while it FALLS, then the four
 * authentic PIECE0-3 explosion-debris models bursting outward while it EXPLODES
 * (findings §3). Nothing once the wreck is 'done'. renderModel accepts any
 * {points, connect} picture, so the topology debris pieces render like the plane.
 */
function drawWreck(wreck: Wreck, projView: Mat4, width: number, height: number): void {
  if (wreck.phase === 'falling') {
    const model = multiply(translation(wreck.x, wreck.y, -wreck.depth), rotationZ(wreck.spin))
    strokeSegments(renderModel(biplaneLOD(wreck.depth), multiply(projView, model)), width, height)
    return
  }
  if (wreck.phase === 'exploding') {
    const spread = (EXPL2_FRAMES - wreck.timer) * DEBRIS_SPREAD // grows as the burst opens
    EXPLOSION_PIECES.forEach((piece, i) => {
      const [dx, dy] = DEBRIS_DIRS[i]
      const model = multiply(
        translation(wreck.x + dx * spread, wreck.y + dy * spread, -wreck.depth),
        rotationZ(wreck.spin),
      )
      strokeSegments(renderModel(piece, multiply(projView, model)), width, height)
    })
  }
}

function draw(
  attitude: Attitude,
  enemies: readonly Enemy[],
  blimp: Blimp | null,
  mountains: readonly Mountain[],
  wrecks: readonly Wreck[],
  shells: readonly Shell[],
  overheated: boolean,
  score: number,
): void {
  if (!ctx) return
  const { width, height } = canvas
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)

  const aspect = height === 0 ? 1 : width / height
  ctx.strokeStyle = '#33ff66'
  ctx.lineWidth = 2
  ctx.shadowColor = '#33ff66'
  ctx.shadowBlur = 8

  // the tilting horizon
  strokeSegments(horizonSegments(attitude, aspect), width, height)

  // the scrolling ground-wave landscape (rb3-3) — up to 4 SCAPE mountains falling
  // from the horizon, projected through the SAME rb1 substrate as everything else.
  // Empty (renders nothing) outside a ground wave.
  strokeSegments(mountainSegments(mountains, attitude, [0, 0, 0], aspect), width, height)

  // the wave — each live plane is a camera-relative screen-window object (x, y) at
  // `depth`, banked, tilting with the player's attitude. MVP = projection · view · model;
  // the LOD is picked by depth (biplaneLOD). Downed planes fall away as UPPLEX wrecks
  // (rb2-6) that coexist with the survivors still weaving (rb2-7 multi-plane waves).
  const view = flightView(attitude, [0, 0, 0])
  const projView = multiply(sceneProjection(aspect), view)
  for (const wreck of wrecks) {
    drawWreck(wreck, projView, width, height)
  }
  for (const enemy of enemies) {
    const model = multiply(translation(enemy.x, enemy.y, -enemy.depth), rotationZ(enemy.bank))
    strokeSegments(renderModel(biplaneLOD(enemy.depth), multiply(projView, model)), width, height)
  }

  // the drifting blimp (rb2-13) — the authentic BLIMP_PICTURE, yawed BROADSIDE (rotationY):
  // the ROM geometry is authored nose-on along local z, so a quarter-turn yaw presents the
  // airship's flank. It flies level (bank 0), drawn through the SAME projection substrate.
  if (blimp !== null) {
    const model = multiply(
      translation(blimp.x, blimp.y, -blimp.depth),
      multiply(rotationY(BLIMP_YAW), rotationZ(blimp.bank)),
    )
    strokeSegments(renderModel(BLIMP_PICTURE, multiply(projView, model)), width, height)
  }

  // the player's tracers — bright bullets streaking out along the boresight (rb2-5)
  for (const shell of shells) {
    strokeSegments(shellSegments(shell, projView), width, height)
  }

  // GUN.ST overheat warning — the ROM "shows a warning" when the guns lock out
  // (findings §5); it clears as they cool, so the cue doubles as the cooldown signal.
  if (overheated) {
    ctx.save()
    ctx.fillStyle = '#ff5533'
    ctx.shadowColor = '#ff5533'
    ctx.shadowBlur = 12
    ctx.font = 'bold 24px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('GUNS HOT', width / 2, height * 0.16)
    ctx.restore()
  }

  // the running score (rb2-6) — PLVALU accrues per kill (the lead counts DOWN as it
  // closes; only a far/dim plane pays the full flat DRNPNT — rb4-1/CB-003). A minimal
  // readout until the ROM HUD glyph font (findings §7) arrives in a later story.
  ctx.save()
  ctx.fillStyle = '#33ff66'
  ctx.shadowColor = '#33ff66'
  ctx.shadowBlur = 8
  ctx.font = 'bold 20px monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(`SCORE ${score}`, 16, 12)
  ctx.restore()
}

// ─── the yoke: keyboard → FlightInput ─────────────────────────────────────────

const held = new Set<string>()
const CONTROL_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'a', 'A', 'd', 'D', 'w', 'W', 's', 'S',
  ' ', // Space = fire — must not scroll the page
])
const axis = (pos: boolean, neg: boolean): number => (pos ? 1 : 0) - (neg ? 1 : 0)

window.addEventListener('keydown', (e) => {
  held.add(e.key)
  if (CONTROL_KEYS.has(e.key)) e.preventDefault() // arrows must fly, not scroll
})
window.addEventListener('keyup', (e) => held.delete(e.key))

// rb2-11: POKEY + analog sound. The browser forbids an AudioContext before a user
// gesture, so the engine stays inert until the pilot touches a key (or clicks) —
// resume() is idempotent, so wiring it to EVERY gesture is safe and costs nothing.
const audio = createAudioEngine()
const unlockAudio = (): void => audio.resume()
window.addEventListener('keydown', unlockAudio)
window.addEventListener('pointerdown', unlockAudio)

// SH2-14: Escape toggles pause via the shared @arcade/shared/pause gate — the
// cabinet-wide VERB. Edge, not level (guard e.repeat) so a held key can't
// machine-gun the toggle. The freeze itself is the frame loop's pause guard below.
let paused = INITIAL_PAUSED
window.addEventListener('keydown', (e) => {
  if (!e.repeat && isPauseKey(e.key.toLowerCase())) paused = togglePaused(paused)
})

// Per-cabinet NUMBERS for the pause card: red-baron's yoke keybinds (letter
// alternates so no arrow glyphs the ROM font lacks), the cabinet green, and the
// dim alpha. The card strokes through drawEscOverlay's transitive @arcade/shared/font
// — no separate red-baron HUD-font migration (the clean AC-4 resolution). Copy /
// colour / opacity are playtest-tunable.
const RED_BARON_PAUSE = {
  lines: [
    'PAUSED',
    '',
    'ESC          RESUME',
    'A / D        TURN',
    'W / S        CLIMB DIVE',
    'SPACE        FIRE',
  ],
  color: '#33ff66',
  opacity: 0.72,
} as const

/** Depth of the CLOSEST live plane (smallest depth), or +Infinity when the sky is clear. */
function nearestDepth(planes: readonly Enemy[]): number {
  let d = Number.POSITIVE_INFINITY
  for (const e of planes) if (e.depth < d) d = e.depth
  return d
}

/**
 * Adapt the drifting blimp to the shared Enemy-shaped target the rb2-5 guns collision
 * (`stepGuns`/`collides`) and the rb2-6 explosion (`explode`) consume — the airship rides
 * the SAME kill pipeline as a plane. Its kill is valued on a dedicated 'blimp' score path
 * (flat 200), so the placeholder `kind` here is cosmetic to those geometry-only seams (rb2-13
 * AC-7: the Enemy-vs-Blimp kind is resolved by adapting at the main.ts boundary).
 */
const blimpEnemy = (b: Blimp): Enemy => ({
  kind: 'lead',
  x: b.x,
  y: b.y,
  depth: b.depth,
  deltaX: b.deltaX,
  bank: b.bank,
  side: b.side,
  active: b.active,
})

/**
 * The pilot's yoke plus the DISCHK band. Normally the live band from the nearest enemy's
 * depth ('far' when clear); while a ground wave runs (GRMODE D7) the control is forced to
 * the slow band regardless of the nearest object (rb3-2, findings §2).
 */
function readInput(enemies: readonly Enemy[], grmode: number): FlightInput {
  return {
    turn: axis(held.has('ArrowRight') || held.has('d') || held.has('D'), held.has('ArrowLeft') || held.has('a') || held.has('A')),
    pitch: axis(held.has('ArrowUp') || held.has('w') || held.has('W'), held.has('ArrowDown') || held.has('s') || held.has('S')),
    proximity: controlBand(isGroundMode(grmode), proximityBand(nearestDepth(enemies))),
  }
}

// ─── the loop: render at display rate, step the sim at the calc-frame rate ────

resize()
window.addEventListener('resize', resize)

let flight = INITIAL_FLIGHT
let kills = 0 // OBJKLD — each kill bumps this; gmlevlForKills(kills) drives the GMLEVL ramp
let score = 0 // running PLVALU total (a DISTANT lead is worth most — rb4-1/CB-003)
let enemies: readonly Enemy[] = [] // the live wave (rb2-7); the schedule spawns the opening wave
let blimp: Blimp | null = null // the drifting airship (rb2-13) — null when none is on screen (BLMOTN ~25% roll)
let lives: Lives = initialLives() // the player's planes remaining (rb2-9) — the blimp's fire is the first wired damage
let mountains: readonly Mountain[] = [] // the scrolling ground-wave landscape (rb3-3); populated only in GRMODE
let wrecks: Wreck[] = [] // downed planes falling/exploding as UPPLEX wrecks, coexisting with survivors
let waveClock = INITIAL_WAVE_CLOCK // MODECT/MCOUNT schedule — spaces waves at the calc-frame cadence
let grmode = GRMODE_PLANE // GRMODE ground-wave byte — set to INITGR (0C0) on a ground slot, cleared (STPLNE) on a plane slot (rb3-2)
let guns: Guns = INITIAL_GUNS
let simFrame = 0 // calc-frame counter — drives the blimp's ÷2 fire cadence (blimpFires)
const blimpRng = createRng((Date.now() ^ 0x5e_ed) >>> 0) // the BLMOTN spawn roll + the blimp's per-shot hit roll
let lastMs: number | null = null
let accumulator = 0

function frame(nowMs: number): void {
  if (lastMs === null) lastMs = nowMs
  // Cap the catch-up so a stalled tab (huge dt) can't spiral the fixed-step loop.
  accumulator += Math.min((nowMs - lastMs) / 1000, 0.25)
  lastMs = nowMs

  const input = readInput(enemies, grmode)
  const fireHeld = held.has(' ')
  // rb2-11: the sound moments this frame's calc-steps produce. red-baron has no
  // single stepGame, so the loop ASSEMBLES the event list from the signals it
  // already computes, then hands it to the shell's dispatch below.
  const events: GameEvent[] = []
  // SH2-14: the frozen-frame gate. While paused, run NO calc-frames (the sim —
  // flight, guns, waves, wrecks, blimp, mountains, score — is held) and discard the
  // banked time down to the sub-step remainder, so resume never burst-replays the
  // paused span. (red-baron's state lives across many closure vars, not one object,
  // so the freeze is realised as this loop guard rather than the shared single-state
  // stepUnlessPaused thunk — see the SH2-14 deviation note; the shared pause VERB is
  // still the isPauseKey/togglePaused edge above.)
  if (paused) accumulator %= SIM_TIMESTEP_S
  while (accumulator >= SIM_TIMESTEP_S) {
    flight = step(flight, input)
    guns = fire(guns, fireHeld)
    // advance any dying planes (fall → PIECE0-3 burst → done); drop the finished wrecks.
    wrecks = wrecks.map((w) => stepWreck(w)).filter((w) => w.phase !== 'done')

    // rb3-3: the scrolling landscape runs ONLY while a ground wave is up (GRMODE D7,
    // rb3-2). It seeds on the first ground calc-frame, scrolls toward the eye each
    // frame at the calc-frame cadence, and clears when the wave returns to the sky.
    if (isGroundMode(grmode)) {
      if (mountains.length === 0) mountains = initialMountains()
      mountains = mountains.map(stepMountain)
    } else if (mountains.length > 0) {
      mountains = []
    }

    const level = gmlevlForKills(kills)

    // The live wave weaves at the kill-ramped level (rb2-7). Downed planes still score BY
    // KIND, bump OBJKLD, wreck, and PLNXCG-promote below — but the shells now fire + collide
    // in ONE pass against the planes AND the blimp, so a shot connects with whatever it meets.
    if (enemies.length > 0) {
      enemies = enemies.map((e) => stepEnemy(e, level))
    }

    // ── the blimp (rb2-13): drift + fire, every calc-frame while present ──
    // The airship drifts one calc-frame (steady, non-weaving) and — on its ÷2 FRAME cadence —
    // fires at the player. A connecting shot (per-shot hit roll) costs a life through the REAL
    // rb2-9 damage channel (loseLife), not a discarded bool. Its drift is unbounded by design,
    // so main.ts DESPAWNS it once it has drifted off-screen (|x| past the bound).
    if (blimp !== null) {
      const drifted = stepBlimp(blimp)
      if (blimpFires(simFrame) && nextFloat(blimpRng) < BLIMP_HIT_CHANCE) {
        lives = loseLife(lives).lives
        events.push({ type: 'player-hit' }) // the CRSHSN crash
      }
      blimp = Math.abs(drifted.x) > BLIMP_DESPAWN_X ? null : drifted
    }

    // ── ONE shared collision pass (rb2-5): the player's shells vs the planes AND the blimp ──
    // The blimp rides the shared guns seam via blimpEnemy(); it sits AFTER the planes in the
    // target list, so a hit on that index is the airship going down.
    const blimpTargetIndex = enemies.length
    const targets: readonly Enemy[] = blimp !== null ? [...enemies, blimpEnemy(blimp)] : enemies
    const shotResult = stepGuns(guns, targets)
    guns = shotResult.guns
    if (shotResult.hits.length > 0) {
      const downed = new Set<number>(shotResult.hits.map((h) => h.target))
      // The blimp kill (AC-5/AC-7): scored a FLAT 200 on its own 'blimp' path, wrecked through
      // the shared UPPLEX explosion, and cleared from the sky.
      if (blimp !== null && downed.has(blimpTargetIndex)) {
        const downedBlimp = blimp
        const points = scoreKill('blimp', downedBlimp.depth)
        score += points
        kills += 1
        wrecks.push(explode(blimpEnemy(downedBlimp)))
        events.push({ type: 'enemy-destroyed', kind: 'blimp', points })
        blimp = null
        downed.delete(blimpTargetIndex)
      }
      // The plane kills (rb2-6/rb2-7): scored BY KIND, wrecked, and PLNXCG lead promotion.
      if (downed.size > 0) {
        for (const idx of downed) {
          const plane = enemies[idx]
          const points = scoreKill(plane.kind, plane.depth)
          score += points
          kills += 1
          wrecks.push(explode(plane))
          // A kill worth the flat 300 also rings the TH jingle (findings §6A).
          events.push({ type: 'enemy-destroyed', kind: plane.kind, points })
        }
        enemies = promoteLead(enemies.filter((_, i) => !downed.has(i)))
      }
    }

    // ── the wave schedule + the BLMOTN blimp roll, only as the sky clears ──
    // Once the planes are down and their wrecks finished, the MODECT/MCOUNT schedule brings the
    // next plane wave in after its gap — and, on a wave decision, the blimp rolls in on its
    // ~25% BLMOTN chance (if none is already drifting), a menace even in the quiet between waves.
    if (enemies.length === 0 && wrecks.length === 0) {
      // A wave DECISION fires when the countdown has elapsed (pre-step countdown 0); it
      // advances MODECT, so capture the firing slot's modect BEFORE stepping.
      const decisionModect = waveClock.modect
      const wasDecision = waveClock.countdown === 0
      const sched = stepWaveClock(waveClock)
      waveClock = sched.clock
      // On a decision the slot enters its GRMODE: a plane slot clears ground mode (STPLNE),
      // a ground slot sets INITGR (0C0) so plane-gen is skipped + control slows. GRMODE holds
      // between decisions — only a decision transitions it (rb3-2, findings §4).
      if (wasDecision) grmode = grmodeForWave(decisionModect)
      // Plane waves spawn only when new-plane generation is enabled (D6 clear); a ground
      // slot's INITGR disables it, so the ground interval is an empty-sky, slow-control wait
      // until the next plane slot (ground-wave CONTENT lands in rb3-3..rb3-6).
      if (sched.spawnPlaneWave && !planeGenDisabled(grmode)) {
        enemies = spawnWave(createRng((Date.now() + kills) >>> 0), score, gmlevlForKills(kills))
        events.push({ type: 'wave-incoming' }) // the WP descending announce
      }
      // The BLMOTN ~25% roll: a blimp drifts in during the lull if the sky has none.
      if (wasDecision && blimp === null && shouldSpawnBlimp(nextFloat(blimpRng))) {
        blimp = spawnBlimp(blimpRng)
      }
    }

    simFrame += 1
    accumulator -= SIM_TIMESTEP_S
  }

  // rb2-11: the sound. One-shot cues ride this frame's event list; the continuous
  // voices (engine hum, the gun's rat-a-tat, the enemy-approach whine) are re-read
  // from live state. A paused game falls silent.
  playEventSounds(audio, events)
  updateContinuousSounds(audio, {
    playing: !paused,
    gunFiring: fireHeld && !guns.overheated,
    nearestDepth: nearestDepth(enemies),
  })

  draw(toAttitude(flight), enemies, blimp, mountains, wrecks, guns.shells, guns.overheated, score)
  // SH2-14: the pause overlay dims the frozen scene and draws the keybind card over
  // it — drawn last (over the whole world) and only while paused. red-baron draws in
  // device pixels (no dpr pre-scale), so it takes canvas.width/height directly.
  if (paused && ctx) drawEscOverlay(ctx, canvas.width, canvas.height, RED_BARON_PAUSE)
  window.requestAnimationFrame(frame)
}
window.requestAnimationFrame(frame)

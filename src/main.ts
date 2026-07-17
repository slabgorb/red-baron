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

import { flightView } from './core/camera'
import { horizonSegments } from './core/horizon'
import { INITIAL_FLIGHT, step, toAttitude, toEye, controlBand, type FlightInput, type FlightState } from './core/flight'
import { proximityBand, displayPos, WO_RTN, type Enemy } from './core/enemy'
import {
  spawnWave, stepWave, promoteLead, INITIAL_WAVE_CLOCK, stepWaveClock,
  grmodeForWave, planeGenDisabled, isGroundMode, GRMODE_PLANE,
} from './core/waves'
import { biplaneLOD, planeModel, renderModel } from './core/biplane'
import {
  shouldSpawnBlimp, spawn as spawnBlimp, step as stepBlimp, blimpFires,
  reapBlimp, blimpSegments, blimpTarget, type Blimp,
} from './core/blimp'
import { initialLives, loseLife, tickGrace, enemiesDisabled, type Lives } from './core/lives'
import { initialMountains, stepMountain, mountainSegments, type Mountain } from './core/landscape'
import { sceneProjection, type SceneSegment } from './core/scene'
import { SIM_TIMESTEP_S } from './core/timing'
import { INITIAL_GUNS, fire, step as stepGuns, shellSegments, type Guns, type Shell } from './core/guns'
import { explode, stepWreck, type Wreck } from './core/explosion'
import { wreckSegments } from './core/wreck-render'
import { scoreKill, gmlevlForKills } from './core/scoring'
import { closesPast, beginPass, evadeCheck, ACE_ATTACK_FRAMES, type ReturningAce } from './core/returning-ace'
import { initialCountUp, queueScore, tickCountUp } from './core/score-countup'
import { beginEol, tickEol, eolDone, type EolState } from './core/eol'
import { groundCollision } from './core/ground-collision'
import type { GameEvent } from './core/events'
import { createAudioEngine } from './shell/audio'
import { playEventSounds, updateContinuousSounds } from './shell/audio-dispatch'
import { multiply, type Mat4, type Vec3 } from '@arcade/shared/math3d'
import { createRng, nextFloat } from '@arcade/shared/rng'
import { INITIAL_PAUSED, isPauseKey, togglePaused } from '@arcade/shared/pause'
import { drawEscOverlay } from '@arcade/shared/esc-overlay'

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')

// ─── NO GEOMETRY IS AUTHORED IN THIS FILE (rb4-1 REWORK 3 — read this before adding any) ───
//
// THREE constants used to live right here, and TWO of them were shipped bugs:
//
//   SHELL_DRAW_FAR = 800   a hand-copied mirror of the gun's reach. When the reach was
//                          corrected against the ROM (800 -> 6400) the copy stayed behind, and
//                          a shell that KILLED the plane at depth 4224 was DRAWN at 528.
//   BLIMP_DESPAWN_X = 640  "screen-window |x| past which the blimp has left the frame" — true
//                          at its old cruise depth, and at the corrected depth it is ndc 0.295,
//                          so the airship was DELETED IN THE MIDDLE OF THE SCREEN.
//   DEBRIS_SPREAD = 4      window units per frame, so the explosion's size on screen was decided
//                          by how far away the plane happened to die. At spawn depth: invisible.
//
// They rotted HERE and nowhere else, and that is not a coincidence. Every excuse for it rested on
// one sentence, which this file used to carry as gospel: "main.ts touches `document` at module
// scope, so under vitest it CANNOT BE IMPORTED — every line in it is unreachable from every test."
//
// THAT SENTENCE WAS A LIE, AND IT WAS THE MOST EXPENSIVE LINE IN THE REPO. Believing it is why
// every guard on this file was a REGEX over its source text — and a regex can only ask what the
// code SAYS, while the bug is always what the code DOES. Round 2's four regexes were walked around
// in a minute. Round 3's were walked around in one line (`|| Math.abs(drifted.x) > 640`), with the
// suite 832/832 green, by a Reviewer who never touched a test or a core file.
//
// `document` and `window` are just globals. tests/cockpit-loop.test.ts STUBS THEM, imports this
// module, captures the rAF callback, and DRIVES THE REAL LOOP — the real accumulator, the real
// calc-frames, the real despawn — against a fake canvas that records every stroke. main.ts is
// now the most-observed file in the game, not the least. Anything you write here that changes
// what the player sees will be seen.
//
// The pure geometry stays GONE all the same — in core, where it is denominated, cited and reusable:
//
//   guns.shellSegments        the tracer     (beside the depth<->z conversion it must agree with)
//   blimp.blimpSegments       the airship    (beside the hull its despawn reasons about)
//   blimp.reapBlimp           the despawn    (the DECISION, not a predicate to argue with)
//   wreck-render.wreckSegments the debris    (burst denominated in the frame it bursts into)
//
// DO NOT WRITE A DISTANCE, A DESPAWN BOUND, OR A SPREAD IN THIS FILE. If you need one, it is a
// pure function of the sim state and it belongs in core with a test on it. What is left here is
// canvas, keyboard, audio and the loop.

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
 * The LIVE viewport's aspect ratio — the frame every screen-space question is asked against.
 *
 * rb4-1: this is not just a render number any more. "Has the blimp left the frame?" and "where
 * does the blimp ENTER the frame?" are questions about the SCREEN, and the screen's world
 * extent depends on how wide the window is (screen.ts). So the sim loop asks them with the
 * aspect the player is actually looking at, rather than with a world constant fitted once
 * against a depth that has since moved. A degenerate canvas (height 0, pre-layout) reads 1.
 */
function viewAspect(): number {
  return canvas.height === 0 ? 1 : canvas.width / canvas.height
}

function draw(
  flight: FlightState,
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

  const aspect = viewAspect()
  ctx.strokeStyle = '#33ff66'
  ctx.lineWidth = 2
  ctx.shadowColor = '#33ff66'
  ctx.shadowBlur = 8

  // rb4-5: the camera TRANSLATES the world. Turning is the UNIV4X lateral eye pan and
  // altitude is the I4YPOS eye height (both from toEye); the ONLY rotation is the bank.
  const attitude = toAttitude(flight)
  const eye = toEye(flight)

  // the tilting horizon — at the finite depth HORZ, sliding with altitude (rb4-5).
  strokeSegments(horizonSegments({ roll: attitude.roll, altitude: flight.altitude }, aspect), width, height)

  // the scrolling ground-wave landscape (rb3-3) — up to 4 SCAPE mountains falling
  // from the horizon, projected through the SAME substrate as everything else.
  // Empty (renders nothing) outside a ground wave.
  strokeSegments(mountainSegments(mountains, attitude, eye, aspect), width, height)

  // the wave — each live plane is a WORLD object at `depth`, banked, tilting with the player's
  // attitude, and drawn where the pilot can actually see it: `displayPos(enemy, eye)`, the ROM's
  // PLSTAT − UNIV4X (:2909-2913).
  //
  // rb4-6 round 2 RETRACTS the exemption that used to sit here. It read "motion objects are
  // already in view-relative coords, so they take ONLY the bank (eye at the origin) — the
  // UNIV4X/I4YPOS world pan must not drift them off as the pilot turns or climbs", and it was the
  // one claim the ROM contradicts outright: a plane's stored position IS world, and turning or
  // climbing is EXACTLY what moves it across the screen. That is how the pilot aims. Exempting
  // motion objects from the pan meant the stick could not move a plane one unit, so the servo wove
  // it out of a gun window nothing could steer — the round-1 soft-lock. rb4-5's own suite already
  // stated the correct model ("objects are drawn at (their X − UNIV4X)", camera-shape.test.ts:10-11);
  // motion objects were simply wrongly excused from it.
  //
  // The eye enters through `planeModel` → `displayPos` rather than through `flightView` so the
  // plane is DRAWN through the identical function the gun KILLS it with — one seam, no second
  // copy of the pan to rot (the lesson guns.ts's own `shellDepth` comment records). `view`
  // therefore stays at the origin: it is the display-space camera the tracers, wrecks and
  // airship already live in. MVP = projection · view · model; the model matrix is core's
  // `planeModel` (rb4-17 — the ×4 picture scale + dual-Z), and the vertex set is picked by the
  // PLSTAT+6 D4 orientation bit (biplaneLOD(enemy.facingAway), rb4-13 — never by depth).
  const view = flightView(attitude, [0, 0, 0])
  const projView: Mat4 = multiply(sceneProjection(aspect), view)

  // the downed planes — falling/spinning, then bursting into the PIECE0-3 debris (rb2-6).
  // The picture (and the burst's size, which is a SCREEN quantity) lives in core/wreck-render.
  for (const wreck of wrecks) {
    strokeSegments(wreckSegments(wreck, projView), width, height)
  }
  for (const enemy of enemies) {
    // The model matrix is core's `planeModel` (rb4-17): the eye still enters through
    // `displayPos` — inside planeModel — so the plane is DRAWN through the identical pan the
    // gun KILLS it with, and the ROM's ×4 picture scale + dual-Z live where a test can reach.
    strokeSegments(renderModel(biplaneLOD(enemy.facingAway), multiply(projView, planeModel(enemy, eye))), width, height)
  }

  // the drifting blimp (rb2-13) — the authentic BLIMP_PICTURE yawed BROADSIDE, posed and
  // projected by core/blimp. The airship is DESPAWNED by the same module (reapBlimp), so the
  // thing that decides it has left the frame and the thing that draws it are one module — and
  // the suite watches them agree, both in core (tests/core/screen-scale.test.ts) and through
  // THIS function, in the booted cockpit (tests/cockpit-loop.test.ts).
  if (blimp !== null) {
    strokeSegments(blimpSegments(blimp, projView), width, height)
  }

  // the player's tracers — bright bullets streaking out along the boresight (rb2-5), projected
  // by core/guns through the SAME z→depth conversion `collides` kills with.
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
// rb4-4: THE SCORE IS A COUNT-UP, NOT A REGISTER. A kill QUEUES its points
// (";QUEUE SCORE", RBARON.MAC:3049) and the SCOREM machine (core/score-countup)
// drains them +10/+100 per tick — the TK/TP tones ride the ticks, the BONUSL
// bonus life rides the tick that crosses its rung. The HUD and the wave sizing
// both read `countUp.displayed`, the ROM's own SCORE register.
let countUp = initialCountUp()
let enemies: readonly Enemy[] = [] // the live wave (rb2-7); the schedule spawns the opening wave
let blimp: Blimp | null = null // the drifting airship (rb2-13) — null when none is on screen (BLMOTN ~25% roll)
let lives: Lives = initialLives() // the player's planes remaining (rb2-9) — the blimp's fire is the first wired damage
let mountains: readonly Mountain[] = [] // the scrolling ground-wave landscape (rb3-3); populated only in GRMODE
let wrecks: Wreck[] = [] // downed planes falling/exploding as UPPLEX wrecks, coexisting with survivors

/**
 * The airship as a WORLD-space target, so it can ride the same collision pass the planes do.
 *
 * `blimpTarget` reports the airship where it is ON SCREEN (rb2-13 stores it that way), while a
 * plane's (x, y) is now its world position and `guns.collides` subtracts the eye from every target
 * it is handed. Lifting the airship by that same eye makes the round trip exact, so its hit window
 * lands precisely where it always did. See the call site for why this is the ROM's conversion and
 * what rb4-15 does with it.
 */
function worldBlimpTarget(b: Blimp, eye: Vec3): Enemy {
  const t = blimpTarget(b)
  return { ...t, x: t.x + eye[0], y: t.y + eye[1] }
}
let waveClock = INITIAL_WAVE_CLOCK // MODECT/MCOUNT schedule — spaces waves at the calc-frame cadence
let grmode = GRMODE_PLANE // GRMODE ground-wave byte — set to INITGR (0C0) on a ground slot, cleared (STPLNE) on a plane slot (rb3-2)
let guns: Guns = INITIAL_GUNS
let simFrame = 0 // calc-frame counter — drives the blimp's ÷2 fire cadence (blimpFires)

// ─── rb4-3: DETERMINISM — the SHELL owns the seed; the sim never reads the clock ──
// The ROM's RANDOM (RBARON.MAC:6193) is a pure software LFSR with no clock input. The
// shell resolves ONE seed at boot and threads it through every Rng stream below, so
// the same seed + the same inputs reproduce the same game — the same-seed replay and
// regression tests the rest of epic rb4 needs. A `?seed=<n>` URL param pins a game for
// replay (asteroids reads location.search the same way); absent it, the shell mints one
// fresh-game seed from the wall clock — the ONLY clock read in the game, at boot, never
// in the calc-frame path. `!== null` (not `||`) so seed 0 is a valid seed, not "absent".
const seedSearch = typeof window !== 'undefined' && window.location ? window.location.search : ''
const seedParam = new URLSearchParams(seedSearch).get('seed')
const seed = seedParam !== null ? Number(seedParam) >>> 0 : (Date.now() >>> 0)

// Each stream draws from its OWN sub-seed off the one shell seed — deterministic, and
// independent so consuming one does not shift another (the rb4-4 draw-order discipline).
const blimpRng = createRng((seed ^ 0x5e_ed) >>> 0) // the BLMOTN spawn roll + the blimp's per-shot hit roll

// ─── rb4-4: the dead mechanics, wired ─────────────────────────────────────────
// The returning ace (rb2-8's module, shelved until now), the two-channel death
// sequence (core/eol), ground collision (core/ground-collision), and game over.
// The ace's 50/50 rolls draw from their OWN seeded stream — sharing blimpRng
// would shift the airship's whole life (TEA's rng-discipline finding).
let ace: ReturningAce | null = null // the armed pass (ENSIDE + BEFLAG); one per game, like the ROM's globals
// PLSTAT+7, the fly-past slot counter. WO.RTN SEEDS it ("DISABLE PLANE FOR WO.RTN FRAMES",
// :2736-2737) and the returning pass resolves its evade check on the frame it reads 0x0C
// (`LDA PLSTAT+7 / CMP I,0C`, :1078-1080 — our ACE_ATTACK_FRAMES). The two constants are ONE
// mechanism: the gap between them, WO_RTN − ACE_ATTACK_FRAMES = 4 frames, IS AC-3's "WO.RTN
// re-entry delay". Round 1 exported WO_RTN, wired nothing, and seeded this from ACE_ATTACK_FRAMES,
// which left two unrelated numbers and no delay at all.
let aceCountdown = WO_RTN
let dying: EolState | null = null // the EOGTMR sequence in progress; freezes the pilot's world
let gameOver = false // ENDLFE with no lives left (RBARON.MAC:1207-1212)
const aceRng = createRng((seed ^ 0xace5) >>> 0) // the EOLSEQ JSR RANDOM (:1090)

let lastMs: number | null = null
let accumulator = 0

/**
 * rb4-4 — THE PRE-MOTION BLOCK, one call per calc frame, dead, dying or alive.
 *
 * Mirrors the ROM's calc-frame preamble: `JSR EOLSEQ` runs unconditionally every
 * frame (RBARON.MAC:825), SCOREM ticks off the NMI regardless of the pilot's
 * state (RBGRND.MAC:236), and `BIT GREND / BVS 20$` gates the playfield update
 * on a GROUND collision BEFORE any motion (:783-785).
 *
 * In order:
 *   1. THE RETURNING ACE — consulted every frame. The fly-by arms the pass when
 *      the closest plane reaches the P.MNDP floor (P.UPD0, :2727); the armed ace
 *      attacks on the PLSTAT+7 cadence (:1078-1080), reading the pilot's LIVE
 *      PLDELX; a 'hit' verdict opens the shells channel (:3758-3759).
 *   2. SCOREM — the count-up ticks in every state, death included; the BONUSL
 *      rung it crosses is `INC LIVES` (:1602).
 *   3. THE EOGTMR SEQUENCE — ticks toward ENDLFE (:1124-1126): DEC LIVES, then
 *      respawn (I4YPOS re-seeded, rb2-9) or game over (:1207-1212). The GROUND
 *      channel freezes the whole world (the BVS skips PFMOTN, NWPLNE and PLMOTN,
 *      :783-789) — the frame is consumed, return true. The SHELLS channel only
 *      grounds the PILOT (PLDELX/PLDELY zeroed, :1108-1113): the planes fly
 *      away and the airship drifts on — return false and let the war animate.
 *   4. GREND BEFORE MOTION — the ground-collision check runs against the
 *      standing world before the playfield would move; a hit opens the ground
 *      channel (D6, :4643-4645) and consumes the frame.
 *
 * Returns true when the calc frame is fully consumed (the caller `continue`s);
 * consuming paths advance simFrame and the accumulator exactly as the loop
 * bottom would. Mutates the cockpit's closure state like every block above.
 */
function preMotionFrame(events: GameEvent[]): boolean {
  const consumeFrame = (): void => {
    simFrame += 1
    accumulator -= SIM_TIMESTEP_S
  }

  // 1 — EOLSEQ: the returning ace, consulted every calc frame (:825).
  // ARM once: the fly-by arms the pass the frame the closest plane reaches the P.MNDP floor
  // (P.UPD0, :2727) — it then flies PAST and is destroyed (rb4-6 stepWave drops it), and a
  // returning plane (NWENME) re-enters from its side. So once armed the ace attacks on its
  // PLSTAT+7 cadence INDEPENDENTLY of the closing wave — it IS that separate returning attacker,
  // no longer the plane that flew by (which is why the old "only while a plane hovers past the
  // floor" gate no longer holds: nothing hovers there anymore).
  // `JSR EOLSEQ` runs EVERY calc frame (:825): consult closesPast unconditionally so the per-frame
  // cadence holds even once the pass is armed (the returning plane keeps re-entering off the floor).
  const closing = closesPast(nearestDepth(enemies))
  if (!gameOver && dying === null) {
    if (ace === null) {
      if (closing) {
        let closest = enemies[0]
        for (const e of enemies) if (e.depth < closest.depth) closest = e
        ace = beginPass(closest.side)
        aceCountdown = WO_RTN // :2736 — the slot is held empty for WO.RTN frames before re-entry
      }
    } else if (!enemiesDisabled(lives)) {
      aceCountdown -= 1
      if (aceCountdown <= ACE_ATTACK_FRAMES) {
        // :1078-1080 — the pass resolves the frame PLSTAT+7 reads 0x0C, WO.RTN−0x0C frames after
        // the fly-past armed it; then the slot re-seeds for the next re-entry.
        aceCountdown = WO_RTN
        const attack = evadeCheck(ace, flight.turnRate, nextFloat(aceRng))
        ace = attack.ace
        if (attack.result === 'hit') {
          dying = beginEol('shells') // GREND = 0x80, "SHELL CD" (:3758-3759)
          events.push({ type: 'player-hit' }) // the CRSHSN crash
        }
      }
    }
  }

  // 2 — SCOREM: the count-up ticks off the NMI in every state (:1533-1602).
  const ticked = tickCountUp(countUp)
  countUp = ticked.score
  for (const e of ticked.events) {
    if (e.type === 'bonus-life') lives = { count: lives.count + 1, grace: lives.grace } // INC LIVES (:1602)
    events.push(e)
  }

  // 3 — the death sequence (EOGTMR → ENDLFE).
  if (dying !== null) {
    dying = tickEol(dying)
    if (eolDone(dying)) {
      const groundDeath = dying.channel === 'ground'
      dying = null
      const taken = loseLife(lives) // ENDLFE: DEC LIVES (:1207)
      lives = taken.lives
      if (taken.gameOver) {
        gameOver = true // nothing left → the high-score seat (:1210-1212); the card draws below
      } else {
        flight = INITIAL_FLIGHT // GMINIT/INITIAL — I4YPOS back to 0x0210 (rb2-9)
      }
      if (groundDeath) {
        consumeFrame()
        return true // the crash's last frozen frame
      }
      return false
    }
    if (dying.channel === 'ground') {
      consumeFrame()
      return true // BVS 20$ — ground death freezes playfield AND planes (:783-789)
    }
    return false // shells death: the pilot is grounded, the war animates on
  }
  if (gameOver) return false // the yoke still flies the empty war (attract's seat)

  // 4 — GREND before motion (:783-785).
  if (groundCollision(toEye(flight)[1], mountains)) {
    dying = beginEol('ground')
    events.push({ type: 'player-hit' }) // the CRSHSN crash
    consumeFrame()
    return true
  }

  // WO.CNT spawn grace runs down only in live flight (rb2-9).
  lives = tickGrace(lives)
  return false
}

function frame(nowMs: number): void {
  if (lastMs === null) lastMs = nowMs
  // Cap the catch-up so a stalled tab (huge dt) can't spiral the fixed-step loop.
  accumulator += Math.min((nowMs - lastMs) / 1000, 0.25)
  lastMs = nowMs

  const input = readInput(enemies, grmode)
  const fireHeld = held.has(' ')
  // The frame the sim's SCREEN-SPACE questions are asked against (the blimp's entry + despawn).
  const aspect = viewAspect()
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
    // rb4-4: the pre-motion block — EOLSEQ, SCOREM, ENDLFE and the GREND check,
    // one call per calc frame (see preMotionFrame). It returns true only when
    // the frame is FULLY consumed (the ground channel's whole-world freeze); a
    // shells death leaves the war animating and merely grounds the pilot below.
    if (preMotionFrame(events)) continue
    // The pilot flies only while no death sequence runs — EOLSEQ zeroes
    // PLDELX/PLDELY for the duration (RBARON.MAC:1108-1113), so the horizon
    // holds still while the war (and the airship) animates on. After game over
    // the yoke still flies the empty war — the ROM parks in attract.
    if (dying === null) flight = step(flight, input)
    // EOL clears GUN.ST and the shell sound (:1109-1110): no NEW shells while
    // dying or after the end — the trigger reads released and the gun cools.
    guns = fire(guns, fireHeld && dying === null && !gameOver)
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

    // The live wave weaves at the kill-ramped level (rb2-7/rb4-6). stepWave runs the two-axis
    // window machine on each plane, holds/breaks the drone formation (PARALLEL → FREE), and
    // DROPS planes that have bored past P.MNDP (rb4-6: they fly PAST and are destroyed as
    // objects, not floored) so the wave empties instead of hovering in the pilot's face. Downed
    // planes still score BY KIND, bump OBJKLD, wreck, and PLNXCG-promote below — the shells fire
    // + collide in ONE pass against the planes AND the blimp, so a shot connects with what it meets.
    if (enemies.length > 0) {
      enemies = stepWave(enemies, level)
    }

    // ── the blimp (rb2-13): drift + fire, every calc-frame while present ──
    // The airship drifts one calc-frame (steady, non-weaving) and — on its ÷2 FRAME cadence —
    // fires at the player. A connecting shot (per-shot hit roll) costs a life through the REAL
    // rb2-9 damage channel (loseLife), not a discarded bool.
    //
    // Its drift is unbounded by design, so it must be DESPAWNED once it has left the frame. THAT
    // DECISION IS NOT TAKEN HERE. `reapBlimp` takes it, in core, in projected space, at the depth
    // and aspect the airship is actually being seen at — and it hands back the airship or nothing.
    // This line has no operator in it ON PURPOSE, and that is the whole lesson of rb4-1:
    //
    //   round 0  the bound was a world constant here      (|x| > 640 — deleted it mid-screen)
    //   round 3  the bound moved to core, but the cockpit still held the BOOLEAN:
    //              blimp = blimpOffScreen(drifted, aspect) ? null : drifted
    //            …and the Reviewer poisoned it in one line, with the suite still 832/832 green:
    //              blimp = (blimpOffScreen(...) || Math.abs(drifted.x) > REAP_LIMIT) ? null : drifted
    //            A correct predicate `||`-ed with a rival bound is a rival bound. IMPORTING the
    //            right function is not OBEYING it.
    //   now      the cockpit gets the ANSWER, not an opinion. There is no boolean here to poison.
    //
    // DO NOT re-introduce a condition on this line. tests/cockpit-loop.test.ts boots this file and
    // watches the real airship cross the real frame; screen-scale.test.ts's DECISION PATH guard
    // rejects any write to `blimp` that is not a bare call to a core producer. Both will fail.
    if (blimp !== null) {
      const drifted = stepBlimp(blimp)
      // rb4-4: a connecting shot opens the SHELLS death channel — the life is
      // taken by ENDLFE when the EOGTMR runs out, not on the impact frame. The
      // hit ROLL is always drawn on a fire-frame (the rng stream must not shift
      // with the pilot's state); only the EFFECT is gated on him being alive.
      if (blimpFires(simFrame) && nextFloat(blimpRng) < BLIMP_HIT_CHANCE && dying === null && !gameOver) {
        dying = beginEol('shells')
        events.push({ type: 'player-hit' }) // the CRSHSN crash
      }
      blimp = reapBlimp(drifted, aspect)
    }

    // ── ONE shared collision pass (rb2-5): the player's shells vs the planes AND the blimp ──
    // The blimp rides the shared guns seam via blimpTarget(); it sits AFTER the planes in the
    // target list, so a hit on that index is the airship going down.
    //
    // rb4-6 round 2: the shot is judged in DISPLAY space, so the gun takes the pilot's own eye —
    // the same `toEye` pair the camera uses (UNIV4X on X, I4YPOS on Y). Without it a plane is shot
    // at in world coordinates the stick cannot move, and the sky goes bulletproof.
    //
    // The airship is still a DISPLAY-space drifter (rb2-13; the ROM's approaching-Z airship is
    // rb4-15's story), so it is LIFTED into world space here to ride the one collision pass the
    // planes now use. That is the ROM's own conversion, not a fudge — every spawn site stores
    // `offset + UNIV4X` (`ADC UNIV4X / STA PLSTAT`, RBARON.MAC:2291-2297, :2223, :2500) precisely
    // because positions live in world and only screen READS subtract the pilot back out. Adding the
    // eye here and subtracting it in `collides` is that round trip, so the airship's behaviour is
    // bit-identical to what it shipped: it stays pinned to the screen. When rb4-15 gives the blimp
    // real world coordinates, this lift is what it deletes.
    const eyeNow = toEye(flight)
    const blimpTargetIndex = enemies.length
    const targets: readonly Enemy[] = blimp !== null ? [...enemies, worldBlimpTarget(blimp, eyeNow)] : enemies
    const shotResult = stepGuns(guns, targets, eyeNow)
    guns = shotResult.guns
    if (shotResult.hits.length > 0) {
      const downed = new Set<number>(shotResult.hits.map((h) => h.target))
      // The blimp kill (AC-5/AC-7): scored a FLAT 200 on its own 'blimp' path, wrecked through
      // the shared UPPLEX explosion, and cleared from the sky.
      if (blimp !== null && downed.has(blimpTargetIndex)) {
        const downedBlimp = blimp
        const points = scoreKill('blimp', downedBlimp.depth)
        countUp = queueScore(countUp, points) // ";QUEUE SCORE" (:3049) — SCOREM drains it
        kills += 1
        wrecks.push(explode(blimpTarget(downedBlimp)))
        events.push({ type: 'enemy-destroyed', kind: 'blimp', points })
        blimp = null
        downed.delete(blimpTargetIndex)
      }
      // The plane kills (rb2-6/rb2-7): scored BY KIND, wrecked, and PLNXCG lead promotion.
      if (downed.size > 0) {
        for (const idx of downed) {
          const plane = enemies[idx]
          const points = scoreKill(plane.kind, plane.depth)
          countUp = queueScore(countUp, points) // ";QUEUE SCORE" (:3049) — SCOREM drains it
          kills += 1
          // The wreck bursts where the plane WAS ON SCREEN. A downed plane leaves the world sim
          // (the ROM's `STA PLSTAT+6 ;CLR PLANE`, :2741) and becomes a display-space object that
          // falls out of frame, which is the space wrecks/tracers/the airship already share — so
          // the world→display conversion happens once, here, at the boundary the object crosses.
          wrecks.push(explode({ ...plane, ...displayPos(plane, toEye(flight)) }))
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
    // rb4-4: no new waves while the pilot is dying (the ROM gates plane
    // generation through the EOL flags, :787-788) or after the game is over.
    if (enemies.length === 0 && wrecks.length === 0 && dying === null && !gameOver) {
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
        // NWPLNE sizes the wave off SCORE — the DISPLAYED register, not the queue.
        enemies = spawnWave(createRng((seed + kills) >>> 0), countUp.displayed, gmlevlForKills(kills))
        events.push({ type: 'wave-incoming' }) // the WP descending announce
      }
      // The BLMOTN ~25% roll: a blimp drifts in during the lull if the sky has none.
      if (wasDecision && blimp === null && shouldSpawnBlimp(nextFloat(blimpRng))) {
        blimp = spawnBlimp(blimpRng, aspect)
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

  // rb4-5 draws from the FLIGHT (the translated-world camera); rb4-4 supplies the
  // DISPLAYED score — the SCOREM count-up's register, not an instant total.
  draw(flight, enemies, blimp, mountains, wrecks, guns.shells, guns.overheated, countUp.displayed)
  // rb4-4: the end-state card. ENDLFE with no lives left parks the ROM at the
  // high-score check (RBARON.MAC:1210-1212); the clone's minimal seat for that
  // story is the card itself, over an emptied sky the yoke still flies.
  if (gameOver && ctx) {
    ctx.save()
    ctx.fillStyle = '#33ff66'
    ctx.shadowColor = '#33ff66'
    ctx.shadowBlur = 12
    ctx.font = 'bold 48px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('GAME OVER', canvas.width / 2, canvas.height * 0.4)
    ctx.restore()
  }
  // SH2-14: the pause overlay dims the frozen scene and draws the keybind card over
  // it — drawn last (over the whole world) and only while paused. red-baron draws in
  // device pixels (no dpr pre-scale), so it takes canvas.width/height directly.
  if (paused && ctx) drawEscOverlay(ctx, canvas.width, canvas.height, RED_BARON_PAUSE)
  window.requestAnimationFrame(frame)
}
window.requestAnimationFrame(frame)

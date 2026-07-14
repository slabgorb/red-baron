// src/core/lives.ts
//
// LIVES + DEATH SEQUENCE + RESPAWN GRACE (story rb2-9) — the damage channel the
// returning ace (rb2-8) hands off to. You get hit, the windshield takes a
// bullet-hole on the shoulder he came from (ENSIDE), the world spins down through
// a starfield, and ENDLFE decrements your planes: respawn (briefly untouchable)
// if any remain, else the game is over.
//
// LIVES & RESPAWN (EOLSEQ→ENDLFE, findings §5, RBARON.MAC:1057-1212): "on death the
// windshield bullet-hole graphics step in (side = ENSIDE), the horizon scrolls down
// and the playfield spins with a spiral sound, then a starfield + plane-explosion;
// ENDLFE does DEC LIVES → INITIAL respawn if any remain, else high-score entry.
// Initial lives from options INITLF: .BYTE 2,3,4,5."
//
// RESPAWN SPAWN-GRACE (GMINIT/INITIAL, findings §5, RBARON.MAC:1217-1293): "on
// (re)spawn, PLSTAT+7 = WO.CNT(5) disables enemy planes for 5 frames ... resets eye
// altitude I4YPOS=0x0210." (Analogous to Battlezone's rez_protect spawn grace.)
//
// SCOPE: this is the DETERMINISTIC SPINE only — lives count, the ordered death
// stages, and the WO.CNT grace window. The on-screen rendering (drawing the
// bullet-hole windshield, the spiral horizon-scroll, the starfield) and the HUD
// lives counter are the shell's job, driven off DEATH_SEQUENCE / Lives.count in a
// later render story. `RESPAWN_ALTITUDE` is the documented I4YPOS reset; the flight
// model re-spawns by re-seeding INITIAL_FLIGHT (which already sits at 0x0210).
//
// INFERRED (finding pins the facts, not the encoding — see the Dev/TEA deviations):
//   * `count` is planes remaining incl. the one being flown; game over exactly when
//     the post-DEC count hits 0 ("respawn if any remain").
//   * the three death sub-stages have NO ROM-pinned durations (unlike WO.CNT=5), so
//     DEATH_SEQUENCE is an ordered cursor advanced one stage per call — the shell
//     owns each stage's frame count. No fabricated durations.
//
// PURE and deterministic. No DOM, no time, no randomness — every function returns a
// fresh value and never mutates its input.

// ─── ROM-exact constants (findings §5) ───────────────────────────────────────

/** INITLF — options-indexed initial lives (RBARON.MAC, `.BYTE 2,3,4,5`). */
export const INITLF: readonly number[] = Object.freeze([2, 3, 4, 5])

/** WO.CNT — respawn spawn-grace: enemy planes disabled for 5 frames on (re)spawn (PLSTAT+7). */
export const WO_CNT = 5

/** I4YPOS respawn eye altitude — matches flight.ts INITIAL_FLIGHT.altitude (findings §5). */
export const RESPAWN_ALTITUDE = 0x0210

// ─── the on-death windshield sequence (ordered stages, findings §5) ──────────

/** The death animation's stages, in ROM order (mirrors explosion.ts WreckPhase). */
export type DeathPhase = 'bullethole' | 'spiral' | 'starfield'

/** DEATH_SEQUENCE — bullet-hole steps in, the world spirals down, then the starfield. */
export const DEATH_SEQUENCE: readonly DeathPhase[] = Object.freeze([
  'bullethole',
  'spiral',
  'starfield',
])

// ─── pure helpers ─────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** Clamp an options selector to a valid INITLF index; NaN/negative/over-range fold to a valid slot. */
const livesIndex = (option: number): number => clamp(Math.floor(option) || 0, 0, INITLF.length - 1)

// ─── the death sequence (records ENSIDE + steps through the stages) ───────────

/** A death animation in progress — the ENSIDE bullet-hole side and the stage cursor. */
export interface DeathSequence {
  /** ENSIDE — the shoulder the ace came from; the bullet-hole side. */
  readonly side: -1 | 1
  /** Cursor into DEATH_SEQUENCE; === length means the sequence is done (ENDLFE fires). */
  readonly phase: number
}

/** Begin the death sequence: record ENSIDE and open on the bullet-hole (phase 0). */
export function beginDeath(side: -1 | 1): DeathSequence {
  return { side, phase: 0 }
}

/** Step to the next death stage; clamps at the end (total — never advances off the sequence). */
export function advanceDeath(seq: DeathSequence): DeathSequence {
  return { side: seq.side, phase: Math.min(seq.phase + 1, DEATH_SEQUENCE.length) }
}

/** The current death stage, or 'done' once the sequence has run past the last stage. */
export function currentPhase(seq: DeathSequence): DeathPhase | 'done' {
  return seq.phase < DEATH_SEQUENCE.length ? DEATH_SEQUENCE[seq.phase] : 'done'
}

/** Has the death sequence finished (past the starfield) — time for ENDLFE? */
export function deathComplete(seq: DeathSequence): boolean {
  return seq.phase >= DEATH_SEQUENCE.length
}

// ─── lives + the WO.CNT spawn grace (ENDLFE / GMINIT-INITIAL) ─────────────────

/** The player's lives state — planes remaining and the spawn-grace frames left. */
export interface Lives {
  /** LIVES — planes remaining, including the one being flown. */
  readonly count: number
  /** WO.CNT spawn-grace frames left; while > 0, enemy planes are disabled. */
  readonly grace: number
}

/**
 * GMINIT/INITIAL — seed the lives from INITLF[option] and arm the WO.CNT spawn grace.
 * `option` defaults to 0 (2 lives); an out-of-range/NaN option clamps to a valid slot.
 */
export function initialLives(option = 0): Lives {
  return { count: INITLF[livesIndex(option)], grace: WO_CNT }
}

/**
 * ENDLFE — DEC LIVES. If any planes remain the player respawns (WO.CNT grace re-armed);
 * when the decremented count reaches 0 it is game over (high-score entry). Total: the
 * count never goes negative, and a spent game keeps returning game over.
 */
export function loseLife(lives: Lives): { lives: Lives; gameOver: boolean } {
  const count = Math.max(0, Math.floor(lives.count) - 1)
  const gameOver = count === 0
  return { lives: { count, grace: gameOver ? 0 : WO_CNT }, gameOver }
}

/** One calc-frame of spawn grace: decrement WO.CNT toward 0 (floored). The life count is untouched. */
export function tickGrace(lives: Lives): Lives {
  return { count: lives.count, grace: Math.max(0, Math.floor(lives.grace) - 1) }
}

/** WO.CNT gate — are enemy planes disabled this frame? (spawn grace still running). */
export function enemiesDisabled(lives: Lives): boolean {
  return lives.grace > 0
}

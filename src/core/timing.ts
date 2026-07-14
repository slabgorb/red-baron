// src/core/timing.ts
//
// Red Baron's three time bases (findings §1 — the load-bearing timing fact).
// The hardware NMI ticks at 250 Hz; the VG display refreshes every 4th NMI
// (62.5 Hz); the GAME-LOGIC / calculation frame advances every 24th NMI
// (~10.42 Hz, 96 ms). The sim steps ONCE per calculation frame while the picture
// redraws at 62.5 Hz — ticking the sim per display frame runs it ~6× too fast
// (the Red Baron analogue of the Asteroids ÷4 trap). These constants let the
// runnable cockpit's loop tick at the right rate.
//
// Cite: RBGRND.MAC:61,102,221-235; RBARON.MAC:621.
//
// PURE constants. No DOM, no time, no randomness.

/** Hardware NMI: one tick every 4 ms (RBGRND.MAC:102 "[FROM HARDWARE]"). */
export const MASTER_NMI_HZ = 250

/** CALCNT 0x18 — the gameplay calculation frame divides the NMI by 24 (RBARON.MAC:621). */
export const CALC_FRAME_NMIS = 24

/** FRMECNT — the shipped VG display refresh divides the NMI by 4 (RBGRND.MAC:61). */
export const DISPLAY_FRAME_NMIS = 4

/** Game-logic rate: ~10.42 Hz. The sim advances ONE step per calculation frame. */
export const SIM_HZ = MASTER_NMI_HZ / CALC_FRAME_NMIS

/** VG display refresh: 62.5 Hz. The picture redraws this fast while the sim waits. */
export const DISPLAY_HZ = MASTER_NMI_HZ / DISPLAY_FRAME_NMIS

/** The fixed sim timestep: 96 ms. Tick the sim at this rate, NOT the display rate. */
export const SIM_TIMESTEP_S = CALC_FRAME_NMIS / MASTER_NMI_HZ

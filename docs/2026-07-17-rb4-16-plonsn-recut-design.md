# rb4-16 re-cut — PLONSN, the plane on-screen, byte-pinned end to end

**Date:** 2026-07-17
**Story:** rb4-16 (8 pt, p1, `tdd`, red-baron)
**Status:** design approved by user (brainstorm), pending TEA RED
**Supersedes:** the parked scope in `sprint/context/context-story-rb4-16.md` (the PARKED banner + the
original body, which encoded a coordinate premise now known wrong). This document is the authority.

---

## 1. What this story is, and why it was parked

rb4-6 shipped the enemy plane's window servo as an **eye-free** machine that decides its zone from the
plane's **stored world** position, held on-screen by an **ad-hoc ±olim world clamp** that the code
itself labels a stand-in for the ROM's real bound (`src/core/enemy.ts:453-456`:
*"It stands in for PLONSN, which we do not model"*). rb4-16 was cut to finish that seam: port the
ROM's actual on-screen bound (**PLONSN**, RBARON.MAC :2877-2937) and move the servo into the space the
ROM's servo really runs in.

The first attempt was **parked and handed back** (2026-07-16/17) on two blockers, both logged in
`sprint/archive/rb4-16-session.md`:

1. **Coordinate premise wrong.** The original spec moved the servo onto our `displayPos` (world − eye,
   a *pre-divide* quantity). But the ROM's servo reads `PLSTAT+8..+B`, the **post-divide SCREEN**
   block (`;X/Y SCREEN POSITION`, RBARON.MAC:3157/:3162; carries POSITH's `ADC I,HORIZN` post-divide
   lift, RBGRND.MAC:303). Three coordinate spaces, not two.
2. **PLONSN "not derivable / AC-R3 infeasible."** A frames-in-reach sweep scored **0.0 at level 4 for
   every window coefficient tried — including the "no PLONSN" case** — and the story concluded the
   window was unpinnable because *"the SINE table is a bare ROM address whose data is in no `.MAC`
   file."*

## 2. Both blockers have since dissolved

**rb4-17 (merged, `644ad58`)** shipped the three prerequisites that were missing when rb4-16 was
parked:

- the **growing COLLD gun window** — the gun is now the plane's **projected picture plate**
  (`src/core/guns.ts:136-167`; `WINDOW_X ±48`, `WINDOW_Y −64..+80`, scaled by `PICTURE_SCALE`), which
  **widens as the plane closes**, replacing the fixed ±32 world tube;
- **dual-Z** in `enemy.ts` — `positionZ` (PLSTAT+19/+1A, `;295 POSITION Z`) is now a real, separate
  field from `depth` (PICTURE Z), spawned at P.INDP and stepped by its own delta (`enemy.ts:314-326`);
- the **scene NDC scale** re-anchored to the ROM's own screen windows (SETBM/SETGRS), so a
  screen-space window finally has a unit.

That kills blocker 2's premise directly. The 0.0-at-L4 measurement was taken **through the ±32 gun
rb4-17 deleted** — it is *stale*, not a proven wall. Nobody has re-measured through the growing gun.

**The SINE table is not missing.** It is in `037007.XXX:48` — the picture/data ROM, ASCII assembler
source, the *same file rb4-17 pulled vertex geometry from*:

```
.=^H03800                 ; 037007.XXX:4  — origin matches RBARON.MAC:396  SINE = 3800
.RADIX 16                 ; 037007.XXX:43 — values are HEX
SINE:  .WORD 0,192,324,4B5,646, ... ,3FFB,4000   ; 65 words, quarter-wave 0 → 0x4000 (unity, 14-bit)
QUADSN: .BYTE 0,80,0C0,40                          ; 037007.XXX:64 — quadrant signs D7=cos, D6=sin
```

It **cross-checks**: 65 words = 130 bytes = `0x82`, and RBARON.MAC:397 EQUs `QUADSN = SINE+082`. The
readers are `T.SINE`/`TRIG` (RBARON.MAC:6019-6053) and `PFTRIG` (:5972+). The parked story grepped
only `*.MAC`, saw the bare `SINE = 3800` address EQU, and stopped. **PLONSN's rotation and absolute
window are fully byte-pinnable.**

**Consequence:** there is no un-pinned constant left to hedge against, and no proven infeasibility. The
story collapses back to *one* clean fidelity story on standard TDD. **No spike phase, no throwaway
measurement rig** — the reachability measurement is simply this story's acceptance test.

## 3. Design decisions (resolved with the user in brainstorm)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Fidelity-first.** Build the ROM's actual machine; the ad-hoc ±olim world clamp is **retired**. | This is a ROM-fidelity epic. Matching the cabinet's machine is the deliverable, not a tuned outcome. |
| D2 | **PLONSN is byte-pinned end to end** — window `0x1A0 × depth` via the Math Box `>>16` (MBUCOD.V05:494-516) *and* the real PFROTN rotation from the 037007.XXX sine table + QUADSN. | The only reason to approximate (the "missing" trig) is gone (§2). |
| D3 | **Servo moves into post-divide SCREEN space** — the space PLNDEL reads (PLSTAT+8/+A), **not** our pre-divide `displayPos`. | Corrects the parked premise. |
| D4 | **AC-R3 is a regression guard, not the goal.** A committed, deterministic frames-in-reach test; its bar is the **current shipped baseline measured through the current (rb4-17) gun** — captured honestly, never the stale 10.8, never re-tuned to pass. | Fidelity is the target; the guard only proves the faithful machine doesn't soft-lock. |
| D5 | **If the fully-faithful machine still regresses reachability, that is a green-phase *finding* to investigate honestly — not a bar to lower and not a reason to keep the clamp.** Likely axis: PLONSN's window *scale/unit* (the parked sweep measured the citable derivations at C≈0.63/1.58 — loose *through the old ±32 gun*; re-check against the growing gun), **not** any pre-named culprit. The growing gun makes a regression *unlikely* (it catches close planes the old tube missed). | With real trig in hand, a regression is genuine ROM behavior or a real bug, surfaced by a failing test. |

## 4. Scope

**In scope (core + servo-coupled — user width "B"):**

- **AC-1 — Servo → screen space.** The window servo's zone detection (inner/outer) and delta selection
  run on the plane's **post-divide screen** position, the space PLNDEL operates in. HORIZN still adds
  **no** term in this module — our display Y is horizon-relative by construction; POSITH/`scene.ts` is
  the one place HORIZN lives (rb4-6, settled; do **not** re-introduce a HORIZN bias here).
- **AC-2 — PLONSN ported, byte-pinned.** The on-screen bound clamps the plane's position each frame so
  its projected picture stays inside the depth-scaled, PFROTN-rotated window. Window magnitude
  (`0x1A0`), depth scale (Math Box `>>16`), and rotation (037007.XXX sine table + QUADSN via T.SINE)
  are each transcribed from cited bytes; any factor that genuinely cannot be byte-pinned is declared a
  seam with its derivation shown (the `scene.ts:43` precedent) — but §2 expects there to be none.
- **AC-3 — Retire the ad-hoc ±olim world clamp.** PLONSN replaces it. The `enemy.ts:453-456`
  stand-in comment goes away with the code.
- **AC-4 — Outer-zone depth gate** (:2776-2781). "Return to centre" is depth-gated: when
  `POSITION Z < 4` the plane does **not** turn back — it flies past off-screen. Fold this into the
  servo's outer arm, reading the `positionZ` field (rb4-17). Today's `windowServo` returns
  unconditionally.
- **AC-R3 — Reachability regression guard.** Drive a stepping eye through `step`/`stepWave` with the
  real `guns.collides`; a plane stays reachable through rb4-17's growing gun at every level. Bar =
  the captured current baseline (D4). A drop is a finding (D5), never a re-tune.
- **AC-5 — rb4-6 comment cleanups** (cheap, ride along): the NaN-clamp totality overclaim; one
  disclosing line on AC-R3's z-gate; name the specific regex the ace-wiring comment indicts.

**Deferred to named successors (out of scope, documented at the port site):**

- **N.PLNZ / GMEND0 gate** — whether PLONSN runs at all (`N.PLNZ >= 5` / `GMEND0`, :2877-2881). Needs
  both counters modelled **and** the coin-up reset traced (only writes seed decimal 10 on the
  attract/hi-score path, :2058). **Standing user ruling: port PLONSN's clamp _ungated_ and record the
  divergence in a code comment citing :2877-2881 — we clamp where the arcade may let planes 5+ escape.**
  Successor story.
- **STPLNE MAXDEL entry-delta seeding** (:2298-2309) — entry-dependent velocity scaling we seed as 0.
  Successor.

## 5. Landmines (read before touching the ROM)

- **Find the `LDX` before reading any `ZX,` operand.** `PLNDEL` runs one servo twice; the axis is
  selected by the X register. `:2749 LDA ZX,PLSTAT+8` is the **Y** entry (`:2747 LDX I,2` → reads
  PLSTAT+0A), *not* X. The parked story burned a review round "correcting" this the wrong way. Cross-
  check against `enemy.ts:103-128`, which already has it right.
- **HORIZN normalizes, it does not displace.** The Y entry's `SBC I,HORIZN` only returns Y to the
  space X already occupies; porting it as a positional bias double-counts what our origin absorbs.
- **Do not re-tune the AC-R3 bar to reach green.** The `WINDOW_X/Y/Z` gun window and the servo limits
  are the only knobs; a failing guard is failing honestly — fix the machine or file the finding.
- **`.XXX` picture ROMs are ASCII assembler source.** Search them, not just `.MAC`. The sine table
  proved this; other "missing" data may be there too.

## 6. Workflow

Standard `tdd`: setup → **red** (TEA writes AC-R3's committed frames-in-reach harness + the PLONSN /
servo-space guards, captures the honest baseline) → **green** (Dev builds the faithful machine, retires
the clamp; a persistent reachability regression is surfaced here as a finding per D5) → review →
finish. The parked branch `refactor/rb4-16-plonsn-display-space-servo` and TEA's old RED `bdd03f1` are
evidence only — the suite `tests/core/plonsn.test.ts` is rewritten (its AC-2 premise assertions are
wrong).

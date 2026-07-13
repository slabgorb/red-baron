# Red Baron (1980) — primary-source fidelity audit

**Date:** 2026-07-13
**Trigger:** "the game seems way off."
**Method:** the `rom-fidelity-audit` skill — preflight → citation checker → 9 paired auditors →
coverage review → adversarial refutation → clustering.
**Source:** the preserved Atari assembler source (LF copy, read-only, copyrighted, never in this repo).

---

## The answer, in one paragraph

The game is way off for a **single systematic reason**, and it is not the timebase.
`RBARON.MAC` sets **`.RADIX 16`** at line 74. Its gameplay constants are therefore **hexadecimal**.
They were transcribed into this clone **as if they were decimal** — `ACCEL =30` became `30` when it
means `0x30` = 48; `P.MNDP =140` became `140` when it means `0x140` = 320; `S.MAXZ =19` became `19`
when it means `0x19` = 25; `HORZ =1000` became `1000` when it means `0x1000` = 4096. Roughly **thirty
of the game's tuning constants are wrong**, most of them by a factor between 1.6× and 3.9×, all in the
same direction. On top of that, **four whole mechanics are wired to nothing** — the returning ace, the
lives/death path, ground collision, and 60% of the sound inventory — and the **camera is the wrong
shape** (the arcade translates the world; we rotate it). The clone is not slightly off. It is playing a
different, easier, flatter game.

The root cause is documented: **our own internal findings doc** (`docs/red-baron-1980-source-findings.md`)
sourced its enemy constants to **`R2BRON.MAC` — a build that never shipped** — and misread that build's
hex constants as decimal. The clone faithfully implemented a document that was wrong twice over.

---

## 1. The three traps, and which ones bit

### Trap 1 — the decoy build. **Avoided by the audit; it had already bitten the code.**

The source tree contains **two complete builds**. `RBARON.MAP` (14-SEP-81) links
`RBARON,RBCOIN,RBSOUN,RBGRND,VGUT,RBROM/C RBINT` and `IMGFIL`-splits it into the **seven release ROMs**
(036995.01 … 037001.01). Beside it sits `R2BRON`/`R2GRND` — an **earlier** build (10-SEP-81) emitting a
single image (036996.02), whose object module is *also* identified as "RBARON" in its own load map.

`R2GRND.MAC` differs from the shipped `RBGRND.MAC` in **exactly two lines**, and one of them is the
frame divider: **`FRMECNT=5` (50 Hz) instead of `FRMECNT=4` (62.5 Hz)**. Citing the decoy is invisible
and catastrophic. **Zero of the 169 findings cite it** — the citation checker rejects it outright — but
our internal findings doc *does*, which is where the bad constants came from.

### Trap 2 — the radix. **This is the bug.**

`.RADIX` is not per-file, it is **per-region**:

| File | Regions |
|---|---|
| `RBARON.MAC` | `:74` → **16** · `:6217` → 10 · `:6281` → back to **16** |
| `RBGRND.MAC` | `:6` → **16** · `:723` → 10 |
| `RBSOUN.MAC` | `:2` → **16** |
| `037007.XXX` | `:43` → **16** · `:80` → **10** (the whole picture/landscape data base) |

A trailing period forces decimal inside a hex region (`CMP I,250.` is 250, not 0x250 = 592).

We computed the governing radix for **every cited line in the audit** by backward scan. The result is
the whole story in one table:

- **152 findings cite `.RADIX 16` regions** — the program constants. **These we read as decimal. Wrong.**
- **11 cite `.RADIX 10` regions** — the picture ROM and the `RBARON.MAC:6217-6280` vertex island.
  **These we also read as decimal. Right.** They are almost all `CONFIRMED`, and `topology.ts` is
  byte-exact.

The transcriber applied **decimal everywhere**. That is correct for the geometry tables and wrong for
every gameplay constant. It is why the plane *shapes* are perfect and the plane *behaviour* is not.

### Trap 3 — the timebase. **Already correct. Not the bug.**

Derived, not assumed, and corroborated by the author's own arithmetic
(`RBGRND.MAC:189`, `CMP I,250.` with the comment `;250.*.004=1`):

| Clock | Derivation | Rate |
|---|---|---|
| Hardware NMI | "INTERRUPT OCCURS EVERY 4 MS. [FROM HARDWARE]" (`RBGRND.MAC:102`) | **250 Hz** |
| VG display refresh | `F.CNTR` ← `FRMECNT`=4 NMI | **62.5 Hz** |
| **Calculation frame (the sim)** | `C.CNTR` ← `CALCNT`=`18` hex = 24 NMI | **10.4167 Hz — a 96 ms step** |

`MAIN` runs all motion then blocks on `INTWAIT` (`LSR CALFLG`), so **every piece of game motion advances
exactly once per 96 ms**, while the picture redraws ~6× between updates. `src/core/timing.ts` already
encodes all three clocks correctly and `main.ts` steps at 96 ms.

**Caveat for implementers:** the sound driver is **not** on this clock. `MODSND` is called from the NMI
handler (`RBGRND.MAC:237`) at **250 Hz / 4 ms**. Any sound envelope timed on the calc frame is 24× wrong.

---

## 2. What the audit produced

| | |
|---|---|
| Findings | **169**, every one citing both sides byte-for-byte |
| `CONFIRMED` (we match) | **63** → 60 after the coverage review killed 3 false ones |
| `DIVERGENCE` | 74 → **77** |
| `BOOK_WAS_WRONG` (our own doc) | **10** |
| `NO_COUNTERPART` (in the arcade, absent from us) | **15** |
| `STRUCTURAL` (float/dt vs integer/IRQ — accepted) | 5 |
| Attacked by refuters | 98 → **95 survived, 3 killed, 72 materially corrected** |
| Killed by the coverage review | 1 more (`OB-011`) + 3 false `CONFIRMED`s |

A **low kill rate with a high correction rate is the healthy signature** — the citation gate had already
removed fabrications, so what remained failed by misreading, not invention.

### What the coverage review caught that nothing else could

- **`OB-011` — false, and dangerous.** It read `;DO ALL THREE BLADE PAIRS` as "draw all three" when it
  means **construct** all three: `.PROPS` is a six-entry `JMPL` table (3 pictures × 2 VG buffers), each
  pair closed by its own `VGRTSL`, and `PLPROP` patches **one** in per VG frame. It *is* a 3-frame
  animation. Acting on the finding would have deleted a correct comment and invited a regression.
- **Three false `CONFIRMED`s**, printed as proof we matched the arcade. `CD-005` certified our blimp's
  fire rate by borrowing the **plane's** ÷2 divisor; the blimp uses `SHLAUN`'s **÷4** plus a `GMLEVL>=2`
  gate. We fire twice as fast as the arcade, on levels where the arcade does not fire at all.
- **A subsystem nobody audited:** `PERCENT` (below).

---

## 3. The ruling sheet — 12 clusters

Raw findings over-count wildly (169 findings ≈ 224 person-days as filed). Merged, they are **12 changes**.
**The radix sweep (C1) lands first** — every later numeric fix re-bakes the wrong base otherwise.

| # | Cluster | Subsumes | What it is | Size |
|---|---|---|---|---|
| **C1** | **The radix sweep — READ THE CONSTANTS AS HEX** | EN-002/3/4/14, CB-003/11/18/19, MI-010/11/14/15/16/17/22, FL-016/17, RD-003/16 (~30 constants) | The single highest-value change in the audit. One systematic pass over every constant transcribed from a `.RADIX 16` region. Nothing else should land first. | **M** |
| **C2** | **Retract the findings doc** | EN-001, CD-013, CD-014, OB-013, RD-016, FL-002, FL-003, SN-003, MI-010 | Our own doc cites the **decoy build** and misreads hex as decimal. It is the *source* of C1. It is cited as authority in code comments throughout. Until it is fixed it will re-infect every future story. | **S** |
| **C3** | **Wire up the dead mechanics** | CD-010, CD-011, EN-019, MI-021, CB-004, SN-009 | `returning-ace.ts` is **never imported**. `lives` is written and never read — **the player cannot die**. No ground collision — you cannot crash into a mountain. No extra lives. 3 of 5 POKEY sounds are wired to events nothing emits. | **L** |
| **C4** | **The camera is the wrong shape** | FL-013, FL-014, FL-015, FL-001, FL-004, FL-005 | The arcade **translates the universe** (`UNIV4X`) and the eye (`I4YPOS`); it applies **no yaw and no pitch rotation** to the view. We rotate the camera. Also `.4WORD` multiplies every pitch-table operand by 4 — an undecoded macro. | **L** |
| **C5** | **The enemy is the wrong machine** | EN-016, EN-017, EN-018, EN-020, EN-021 | The weave reverses at the **inner** window, not the outer; the same window machine runs on **Y as well as X** (our planes never move vertically); planes **fly past and are destroyed**, ours hover at a floor. | **L** |
| **C6** | **The mission clock** | MI-003/4/5/7/8/9, CB-001, CD-009 | `MCOUNT[MODECT>>1]` gives **runs** of plane waves, not 1:1 alternation; `MODECT` wraps mod 16; `NEWCT` counts **waves**, not frames; ground mode ends on a **condition**; `GMLEVL` indexes by `OBJKLD>>1` — **our difficulty ramps twice as fast**. | **M** |
| **C7** | **The mountains** | MI-014/15/16/18/19 | Placement is **authored** (`PFOBIZ`), not generated; two closing rates (horizon vs free); "on horizon" is a **latched bit** with hysteresis; mountains **scroll laterally** with the player. | **M** |
| **C8** | **The screen is missing things** | RD-001/2/4/5/6/7/8/9/10, OB-014 | The **player's propeller** — the ROM's most prominent foreground element, repatched every VG frame — **is not drawn**. No depth-cued **intensity** (the AVG has 3-bit per-vector intensity; we stroke one flat green). No `HORIZN` screen offset. No lives, no windscreen bullet holes, no `PLVALU` readout. Shells are **dots**, not streaks. | **L** |
| **C9** | **The sound** | SN-003/5/6/7/8/11/12/13/14/16/17 | The envelope `NUMBER` rule is off by two (and the ROM's **own comments are wrong** — see SN-003's 5-of-5 arithmetic proof). Sounds fire on the wrong cue and the wrong clock (**250 Hz**, not the calc frame). The gun fires on **enemy** shells too. | **M** |
| **C10** | **The ground targets** | OB-017, MI-008, OB-016, OB-018 | The ROM's four ground objects — **pyramid, house, tank, pill box** (`037007.XXX:1132-1230`), with point-sets, decode-lists and pointer tables — are **entirely absent** from `topology.ts`. So is the blimp's collision box. | **M** |
| **C11** | **Determinism** | GP-003 | Our RNG is seeded from **`Date.now()` inside the sim step** (`main.ts:467`); the ROM's `RANDOM` is a deterministic LFSR. Same-seed replay is impossible, and it violates the core/shell boundary. Cheap, and unblocks regression testing for everything above. | **S** |
| **C12** | **`PERCENT` — RECOMMEND DESCOPE** | GP-001 | An **EAROM-backed adaptive difficulty system**: the cabinet measures average game length, compares it to an operator-set target (`GTOPTS`, 45–135 s) and adds a delta to **every closing speed** (`PRPDEL` ±25–50% of base; `PRMDEL` = ×4), persisting **across games**. It is real, and it is absent. **But it exists to regulate how long a quarter buys.** This repo has a standing rule against replicating quarter-extracting mechanics. Recommend a **deliberate descope**, recorded — not an omission. | **—** |

**Dependency:** C1 → everything numeric. C2 alongside C1 (or the doc re-infects the next story).
C11 early (it makes the rest testable). C3 is the one that changes the game from "a diorama" to "a game."

---

## 4. Limitations — recorded honestly

- **The refutation of 6 of 14 batches was run by the controller, not an independent adversarial agent.**
  The environment ran out of process slots mid-audit. The controller applied the same checks (radix
  region proven by backward scan, macros decoded, absence claims re-grepped, load-bearing ROM lines
  re-read by hand) and verified the load-bearing claims of each batch personally — but a self-refuted
  finding is weaker evidence than an independently-refuted one. The affected batches are
  `5-mission-b2`, `6-objects-b1`, `7-sound-b1/b2`, `8-render-b1/b2`. **The sound pair received the least
  adversarial scrutiny of any subsystem** and its per-sound millisecond figures should be re-derived
  before anyone implements them.
- **`COND65`, `ASCVG` and `MBDIAG` shipped but are absent from the quarry.** `RBSOUN.MAC:3` includes
  `COND65`, so parts of the sound driver's vocabulary are unknowable from this source.
- **The analog sound board is off-CPU.** Gun/explosion/engine *timbre* is not in this source at all;
  only the triggering, gating and envelope timing are auditable.
- **The Math Box microcode (`MBUCOD`)** is out of this repo's scope (it lives in `@arcade/shared/math3d`).
- **Deep-level difficulty tables** were not exhaustively traced, per the standing "don't gold-plate what
  nobody reaches" guardrail.

---

## 5. Artefacts

- `docs/audit/plan.md` — the ground truth handed verbatim to every agent.
- `docs/audit/findings/pair-*.json` — 169 machine-checked findings, both sides cited byte-for-byte.
- `docs/audit/coverage-review.md` — the Phase-3 review (false `CONFIRMED`s, contradictions, scope holes).
- `docs/audit/verdicts/*.json` — 98 adversarial verdicts.
- `tools/audit/` + `tests/audit/citations.test.ts` — the citation gate. **`npm test -- citations` must stay green.**
  It rejects any citation to the decoy build, and re-opens every cited line byte-for-byte.

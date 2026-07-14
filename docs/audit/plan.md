# Red Baron primary-source fidelity audit — plan

**Date:** 2026-07-13
**Trigger:** the game "seems way off" in play.
**Method:** `rom-fidelity-audit` skill.
**Source (LF, read-only — a separate checkout, not copied into this repo):**
`/Users/slabgorb/Projects/red-baron-source-text`

---

## Ground truth (Phase 0 — established before any auditor was dispatched)

Every auditor, refuter and reviewer is handed this verbatim.

### 1. What shipped

The shipping build is **RBARON** (`RBARON.MAP`, 14-SEP-81):

```
BIN:RBARON,RBARON.XX=OBJ:RBARON,RBCOIN,RBSOUN,RBGRND,VGUT,RBROM/C
RBINT
```

`RBARON.COM`'s `IMGFIL` step splits that binary into the **seven release ROM images** —
036995.01, 036996.01, 036997.01, 036998.01, 036999.01, 037000.01, 037001.01. That is what
makes it the shipping build rather than a prototype.

**ALLOWLIST (citable):** `RBARON`, `RBCOIN`, `RBSOUN`, `RBGRND`, `VGUT`, `RBROM`, `RBINT`,
plus `TCN65` (`.INCLUDE`d by RBCOIN.MAC:27) and `VGMC` (RBINT.MAC:119), plus the two
separately-built picture ROMs `037007.XXX` (= `.TITLE RBPICS - RED BARON PICTURES`) and
`037006.XXX` (= `RBCHAR`).

**DENYLIST (a citation to any of these invalidates the finding):**

| Module | Why it must never be cited |
|---|---|
| `R2BRON.MAC`, `R2GRND.MAC` | **The decoys.** An *earlier* build (`R2BRON.MAP`, 10-SEP-81) that emits a single ROM image (036996.02). `R2BRON.MAC` is identical to `RBARON.MAC` but for 14 lines; `R2GRND.MAC` differs from `RBGRND.MAC` in exactly **two** places — `FRMECNT=5` vs `FRMECNT=4`, and `CMP I,40` vs `CMP I,3`. Cite the decoy and the display rate silently comes out **50 Hz instead of 62.5 Hz**. R2BRON's object module is even *identified* as "RBARON" in its own load map. |
| `036464.XXX` | RBDEC, the auxiliary decode PROM. Not game code. |
| `MBUCOD.V05` | Math Box microcode (builds `03617X.SAV`). Real silicon, but it is the coordinate hardware — ported in `@arcade/shared/math3d`, a different repo. Out of scope, not out of the cabinet. |
| `VGAN.MAC` | No shipped module `.INCLUDE`s it. Only `037006` (the glyph ROM) does. |
| `STATE2.MAC` | Standalone utility; absent from every link string. |
| `COND65`, `ASCVG`, `MBDIAG` | These **did** ship (`.INCLUDE`d by RBSOUN:3, RBINT:120, RBINT:557) but are **absent from the quarry entirely**. We cannot open them, so nothing can be cited against them. Recorded as a limitation. |

**Dead conditional-assembly blocks — emit no bytes, must not be cited as evidence of a value:**
`RBARON.MAC:267–373` and `RBROM.MAC:163–172` are `.IF EQ,1`. MACRO-65 assembles `.IF EQ,expr`
only when `expr == 0`, so these never assembled. (RBARON's block is a *documentation* block —
the `PLOBDB` data-structure layout. Excellent as a glossary; worthless as evidence.)

### 2. Radix — it switches REGION BY REGION, not file by file

Default `.RADIX 16`, with **decimal islands**. A bare number's meaning depends on which region
the line is in:

| File | Regions |
|---|---|
| `RBARON.MAC` | `:74` → 16 · `:6217` → **10** · `:6281` → back to 16 |
| `RBGRND.MAC` | `:6` → 16 · `:723` → **10** |
| `RBINT.MAC` | `:2` → 16 · `:123` → 16 · `:873` → **10** |
| `RBSOUN.MAC` | `:2` → 16 |
| `037007.XXX` | `:43` → 16 · `:80` → **10** (the whole picture/landscape data base is DECIMAL) |
| `037006.XXX` | `:11` → 16 |

**A trailing period makes a literal decimal inside a hex region**: `CMP I,250.` is 250, not 592.

### 3. The timebase — three clocks, and the sim is the SLOW one

Derived from hardware and corroborated by the author's own arithmetic:

| Clock | Derivation | Rate |
|---|---|---|
| Hardware NMI | `RBGRND.MAC:102` — "INTERRUPT OCCURS EVERY 4 MS. [FROM HARDWARE]"; corroborated at `RBGRND.MAC:189` `CMP I,250.` with the comment `;250.*.004=1` | **250 Hz** |
| VG display refresh | `F.CNTR` reloads from `FRMECNT`=4 (`RBGRND.MAC:61`, decremented `:231`) | **62.5 Hz** |
| **Calculation frame (the sim)** | `C.CNTR` reloads from `CALCNT`=`18` hex = **24** (`RBARON.MAC:621`, decremented `RBGRND.MAC:221`) | **10.4167 Hz — a 96 ms step** |

Both counters are decremented in the **same** NMI handler, so they share the NMI unit; the ratio
is exactly 6:1. `MAIN` (`RBARON.MAC:763`) runs the whole game — `PFMOTN` (flight), `NWPLNE`,
`PLMOTN` (planes & drones) — then blocks in `INTWAIT` (`RBARON.MAC:926`, `LSR CALFLG`) and loops
(`JMP MAIN`, `:878`).

**Therefore: every piece of game motion advances exactly ONCE per 96 ms.** The picture is redrawn
~6× between updates. Ticking the sim per display frame runs it **6× too fast**.

> Our `src/core/timing.ts` already encodes all three clocks correctly. **The timebase is not the
> bug.** Auditors must not "fix" it, and must convert using **10.4167 Hz** — not 60, not 62.5 —
> when comparing any per-frame source constant against our per-second values.

---

## Phase 2 — the auditor pairs

Each pair is one agent: one subsystem, source ↔ ours, writing
`docs/audit/findings/pair-<n>-<name>.json`.

| Pair | Scope | Source | Ours |
|---|---|---|---|
| 1 · `cadence` | The calc-frame contract as *consumed*: does everything that must advance once per 96 ms actually do so, and nothing else? Accumulator, pause, per-step vs per-render state. | `RBARON.MAC` MAIN/INTWAIT, `RBGRND.MAC` NMI | `src/core/timing.ts`, `src/main.ts` (loop) |
| 2 · `flight` | Player flight: pot scaling, `PFMOTN`, `PLDELX`→pan, `PFROTN`→bank, `PLDELY`→pitch, clamps, the camera/horizon pipeline. | `RBARON.MAC` `POTSCL`, `PFMOTN` | `src/core/flight.ts`, `camera.ts`, `horizon.ts` |
| 3 · `enemy` | Enemy planes/drones: spawn (`NWPLNE`), motion (`PLMOTN`), the weaving follower AI, level gating, the returning ace, the blimp. | `RBARON.MAC` `NWPLNE`, `PLMOTN` + tables | `src/core/enemy.ts`, `returning-ace.ts`, `blimp.ts` |
| 4 · `combat` | Guns/shells (`NEWSHL`), overheat, collision, the two death channels, lives, grace, scoring, explosion lifecycle. | `RBARON.MAC` `NEWSHL`, damage/score | `src/core/guns.ts`, `lives.ts`, `scoring.ts`, `explosion.ts` |
| 5 · `mission` | Wave/mission sequence, `MODECT` alternation, ground mode (`GRMODE`/`GREND`), mountains, landscape, ground targets. | `RBARON.MAC` mode logic, `RBGRND.MAC`, `037007.XXX` landscape DBs | `src/core/waves.ts`, `scene.ts`, `landscape.ts` |
| 6 · `objects` | Vector object data: the biplane's vertices + connect-lists, blimp, prop, explosion pieces, stars. **The `037007.XXX` data base is `.RADIX 10` from line 80.** | `037007.XXX` (RBPICS), `RBARON.MAC` point tables | `src/core/topology.ts`, `biplane.ts` |
| 7 · `sound` | POKEY envelope driver, the sound inventory, which cue fires when. | `RBSOUN.MAC` | `src/shell/audio.ts`, `pokey.ts`, `audio-dispatch.ts` |
| 8 · `render` | What actually reaches the screen: the VG display-list build, draw order, scaling/intensity, what is drawn at all. | `RBARON.MAC` VG list build, `VGUT.MAC`, `VGMC.MAC` | `src/main.ts` (draw), `src/core/scene.ts` |

**Known limitations, recorded up front:** `COND65` / `ASCVG` / `MBDIAG` are absent from the quarry;
the Math Box microcode (`MBUCOD`) is out of this repo's scope; the analog sound board is off-CPU
and not in this source at all.

## Phases 3–6

3. **Coverage review** — one agent over ALL findings: false `CONFIRMED`s, cross-pair
   contradictions, scope holes, fragmentation.
4. **Refutation** — adversarial, batched ~6 findings per agent, default REFUTED under uncertainty.
5. **Synthesise + cluster** — the audit document and a ruling sheet of merged clusters.
6. **Human rules** — we recommend, the human decides. Only ruled-"fix" clusters become an epic.

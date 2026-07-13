# Red Baron fidelity audit — coverage review (Phase 3)

**Date:** 2026-07-13
**Scope:** all 166 findings across `docs/audit/findings/pair-{1..8}-*.json`.
**Not in scope:** citation accuracy (already verified byte-for-byte) and the merits of any
individual DIVERGENCE / BOOK_WAS_WRONG / NO_COUNTERPART claim (the refutation pass owns those).

This review looks only at what neither of those passes can see: **false `CONFIRMED`s**,
**cross-pair contradictions**, **scope holes**, **filing honesty**, and **sizing/fragmentation**.

---

## 0. Headline

Three of the 63 `CONFIRMED`s are **false** and must not be printed as proof we match the arcade
(§1). One `DIVERGENCE` is **false in the dangerous direction** — actioning it would break code
that is currently correct (§2C). Two subsystems were **assigned to nobody** and one of them
(`PERCENT`) sits in `MAIN`'s per-calc-frame call list and modulates every closing speed in the
game (§3). The 103 actionable findings total **~224 person-days as filed**; after collapsing the
duplicate clusters they are **~70 distinct changes**, and the epic as it stands is
**unschedulable** (§5).

Credit where it is due, in one line each:

- **Zero denylist citations across all 166 findings.** Not one pair cited `R2BRON`, `R2GRND`,
  `VGAN`, `STATE2`, `036464` or `MBUCOD`. The decoy trap was cleanly avoided.
- **Filing is honest.** Every pair filed `CONFIRMED`s (low: pair 8 render, 3/16 = 19%; high:
  pair 6 objects, 10/18 = 56%). Nobody went hunting. Pair 8's low rate is genuine — we draw a
  strict subset of the ROM's display list — and it filed two `STRUCTURAL` null results
  (RD-011 monochrome is fine, RD-015 double-buffering is equivalent), which is exactly right.
- **The radix discipline held on the tables.** I independently re-derived the radix region for
  every numeric `CONFIRMED`. `.RADIX` directives confirmed: `RBARON.MAC` 74→16, 6217→10,
  6281→16; `RBGRND.MAC` 6→16, 723→10; `RBSOUN.MAC` 2→16; `037007.XXX` 43→16, 80→10;
  `037006.XXX` 11→16. Every value table (P.OLIM, P.ILIM, PLNLVL, MCOUNT, INITLF, the 037007
  picture DB) checks out.

---

## 1. FALSE `CONFIRMED`s — 3 of 63

A `CONFIRMED` is never attacked by anyone and gets printed as evidence we match the arcade.
These three do not.

### CD-005 — FALSE. The blimp's fire cadence does not match; it is 2× too fast.

CD-005 certifies our blimp code:

> "blimpFires(simFrame) (main.ts:405, blimp.ts:145 `(frame & 1) === 0`) therefore fires every
> 2nd calc frame = 192 ms, **matching the PLNSHL divide-by-2**."

**The blimp does not use PLNSHL.** `BLMOTN` calls `SHLAUN` (RBARON.MAC:4229,
`JSR SHLAUN ;LAUNCH SHELL @ PLAYER`), and SHLAUN's own gate is a **divide-by-four**:

```
RBARON.MAC:4027  SHLAUN: LDA FRAME
RBARON.MAC:4028          AND I,3          ;1 OUT OF 4 FRAMES
RBARON.MAC:4030          BEQ SHLAU0
RBARON.MAC:4038          LDX GMLEVL
RBARON.MAC:4039          DEX
RBARON.MAC:4040          DEX
RBARON.MAC:4041          BMI SHLAUX       ;NO GROUND SHELLS @ LOWER LEVELS
```

The `÷2` CD-005 borrowed belongs to the **enemy plane**, and PLNSHL reaches the launcher by
`JMP SHLAU0` (RBARON.MAC:4812) — **jumping past SHLAUN's `AND I,3` entirely**:

```
RBARON.MAC:4809          LDA FRAME
RBARON.MAC:4810          LSR
RBARON.MAC:4811          BCS 10$          ;EVERY OTHER FRAME
RBARON.MAC:4812          JMP SHLAU0       ;FIRE SHELLS
```

So the plane is ÷2 and the blimp is ÷4-plus-a-`GMLEVL >= 2`-gate. CD-005 attached the plane's
divisor to the blimp. **EN-024 has this exactly right and directly contradicts CD-005.**
Our blimp fires at 5.2 shots/s where the arcade fires 2.6, and fires at all on levels 0–1 where
the arcade fires nothing.

> Salvage: CD-005's *other* claim — that `FRAME` is the 96 ms calc frame, `INC FRAME` at
> RBARON.MAC:870 inside MAIN after INTWAIT — is **true and load-bearing**. Keep that half; it is
> what makes EN-008 and EN-024 comparable at all. Delete the blimp half.

### CD-009 — FALSE. The wave-clock mapping is not "exact"; it is a divergence.

CD-009 certifies `if (enemies.length === 0 && wrecks.length === 0)` (main.ts:452) as gating
`stepWaveClock` "identically" to NWPLNE, concluding **"The mapping is exact."**

NWPLNE has **three** gates before `DEC NEWCT`, not one. CD-009 saw the first and missed two:

```
RBARON.MAC:2241  NWPLNE: LDA PLSTAT+6     ;PLANE #0
RBARON.MAC:2242          AND I,0C0
RBARON.MAC:2243          BNE 17$          ;FLIGHT/EXPLOSION   <-- the gate CD-009 saw
RBARON.MAC:2244          DEC PLSTAT+7     ;DEC PLANE COUNT    <-- MISSED (per-frame countdown)
RBARON.MAC:2245          BNE 17$
...
RBARON.MAC:2253  15$:    LDA SCRTAB+3     ;WAIT FOR SCORES    <-- MISSED (score count-up gate)
RBARON.MAC:2254          BEQ 20$
RBARON.MAC:2258  20$:    DEC NEWCT        ;MODE COUNT?
```

`NEWCT` is reached only **after `PLSTAT+7` expires** — i.e. it decrements once per
**plane-generation event**, not once per calc frame. Our `countdown` decrements once per calc
frame while the sky is clear (main.ts:452-458): it is `NEWCT` in name and `PLSTAT+7` in
behaviour. **This is precisely MI-004's DIVERGENCE.** CD-009 certifies as exact the very thing
MI-004 files as broken.

> Also unfiled by anyone: the `SCRTAB+3` "WAIT FOR SCORES" gate (RBARON.MAC:2253-2256) — the ROM
> will not start the next wave while the score count-up is still ticking. Add it to MI-004.

### FL-015 — FALSE. It confirms a transform pipeline our code does not run.

FL-015 certifies "translate by the eye, then roll about Z, then divide by depth — **our
composition matches**", citing `camera.ts:47  return viewMatrix(eye, orientation)`.

But the eye is **hard-coded to the origin at every call site**:

```
src/main.ts:185   strokeSegments(mountainSegments(mountains, attitude, [0, 0, 0], aspect), ...)
src/main.ts:191   const view = flightView(attitude, [0, 0, 0])
```

There is no eye translation. Step 1 of the three-step pipeline FL-015 certifies **does not
happen** — and FL-014, written by the *same auditor*, says so in as many words: "the eye is
hard-coded to the origin and `toEye()` is never called anywhere in src/". Meanwhile
`camera.ts:43-46` composes `rotationZ ∘ rotationX ∘ rotationY` — three rotations where POSITH
has exactly one (FL-013, FL-014).

FL-015 is true only of a hypothetical tree in which FL-013 **and** FL-014 are already fixed.
Printed in the audit it reads as "our camera pipeline matches the arcade", which is the opposite
of the truth. **This is an intra-file contradiction (FL-015 vs FL-013/FL-014) that the auditor
noticed and filed as a match anyway.**

### Not false, but overclaimed — fix the wording, keep the verdict

| id | Problem |
|---|---|
| **SN-004** | Titled "byte-accurate", but the body concedes our envelope emits **5** values where the ROM emits **4** (SN-003 proves `NUMBER` = count of distinct values). The 5th is volume 0, so TK is *audibly* identical while running 35 frames against the ROM's 28. Retitle; the verdict survives. |
| **CB-014** | "the SAME window in different units" is only true *within each system's own depth scale*. CB-011/CB-012 show our shell-z↔world-depth scale differs from the ROM's, so the absolute window differs. The substantive claim — window = 1 sub-step ⇒ sub-step windows abut ⇒ no tunnelling — holds in both. Keep as CONFIRMED; fix the sentence. |
| **CD-004** | "Every MAIN-loop motion routine has its counterpart" is true of the *motion* routines it lists. But MAIN also calls `JSR PERCENT ;GAME PERCENTAGING` (RBARON.MAC:852), which has no counterpart at all (§3.1). The claim is narrowly true; the impression of completeness is not. |
| **CD-008** | "Same semantics" is right for the **pause** path but sits awkwardly beside CD-012, which says the ROM *never* double-steps while our accumulator replays up to 2 frames. Narrow CD-008's claim to pause. |

### Verified TRUE, against my own suspicion — CB-017

`.EXPL2 = 12` is the exact shape of a radix error, so I traced it. It is **correct**:

```
RBARON.MAC:479  .EXPL1  =6      ;6 FRAMES W/FALL
RBARON.MAC:480  .EXPL2  =12     ;12 FRAMES TOTAL SEQUENCE
RBARON.MAC:2970         CMP I,.EXPL1
RBARON.MAC:2983         CMP I,.EXPL2    ;FINISHED?
RBARON.MAC:2984         BCS UPPLX1      ;YES
```

`.EXPL2` is `0x12 = 18` (hex region), and it is the **total**. 6 falling + 12 exploding = 18.
Our `EXPL2_FRAMES = 12` reaches the right behaviour through the wrong reading, exactly as CB-017
warns. Two independent witnesses in the same equate block prove the region is hex and that the
author comments the *decimal* value of his *hex* literal: `STINIT =18 ;SCORE 24.*4 MS.COUNT`
(0x18 = 24) and `GRLSHL =0E ;GROUND SHELL DB = 14. BYTES` (0x0E = 14). **CB-017's warning is
correct and valuable — do not let anyone "fix" `EXPL2_FRAMES` to 18.**

---

## 2. Cross-pair contradictions

### A. CD-005 vs EN-024 — the blimp's fire cadence. **CD-005 is wrong.** (§1)

A false CONFIRMED contradicting a correct DIVERGENCE. Highest severity: if CD-005 is printed,
EN-024's fix gets ruled "no change needed."

### B. CD-009 vs MI-004 — what NEWCT counts. **CD-009 is wrong.** (§1)

### C. OB-011 vs CD-016 + RD-005 — the enemy propeller. **OB-011 is wrong, and it is the dangerous kind.**

OB-011 is a `DIVERGENCE` claiming `topology.ts:161`'s docstring ("the three prop-blade frames,
indexed by prop rotation") is wrong, because "PPROPA, PPROPB and PPROPC are all decoded into the
SAME picture on EVERY frame, producing a static 6-spoke blur, **not a 3-frame animation**."

**It is a 3-frame animation.** OB-011 misread `;DO ALL THREE BLADE PAIRS` as "draw all three"
when it means "**construct** all three". The evidence:

```
037007.XXX:68   PROPS:  .WORD PPROPA,PPROPB,PPROPC     <-- 3 connect-lists
037007.XXX:70   .PROPS: JMPL 27A0                      <-- a SIX-entry JMPL table:
037007.XXX:71           JMPL 27BE                          3 addresses x 2 VG buffers
037007.XXX:72           JMPL 27DC
037007.XXX:73           JMPL 2FA0
037007.XXX:74           JMPL 2FBE
037007.XXX:75           JMPL 2FDC
RBARON.MAC:399  .PROPS  =PROPS+6      ;PLANE PROP BUFFER ADDRS (VG)
RBARON.MAC:400  PFOPOS  =.PROPS+0C    <-- .PROPS is 0x0C = 12 bytes = 6 words. Confirms 3x2.
```

`PLNPRP` (RBARON.MAC:5044-5067) starts `RAMPTR` at 0x27A0 (or 0x2FA0 for buffer 1) and builds the
three blade pairs back-to-back — **each closed by its own `JSR VGRTSL ;CONSTRUCT RTSL (VG)`
(:5057) with the pen origin reset between them (:5058-5062)**. You do not emit an RTSL in the
middle of a picture you intend to stroke as one. The result is **three separately callable VG
sub-lists** at 27A0 / 27BE / 27DC — exactly the three addresses in `.PROPS`.

`PLPROP` then patches **one** of them into the display list per VG frame:

```
RBARON.MAC:882  PLPROP: LDY PROP.F        ;GET PICTURE OFFSET
RBARON.MAC:884-888      INY / INY / CPY I,6 / BCC 5$ / LDY I,0     <-- PROP.F = 0, 2, 4
RBARON.MAC:892-895      LDA AY,.PROPS+6 / ... / STA A,VGRAM+0F94
```

**CD-016 and RD-005 are right; OB-011 is wrong.** `topology.ts`'s docstring is correct. Actioning
OB-011 would delete a correct comment and invite someone to merge the three lists into one
picture — a regression. **Reclassify OB-011 as REFUTED.**

### D. FL-015 vs FL-013/FL-014 — intra-file. **FL-015 is wrong.** (§1)

### E. CD-016 vs RD-001 — *apparent* contradiction, actually **two different propellers**. Do not merge.

CD-016 says the prop cycle is **3-phase** (`CPY I,6` → offsets 0,2,4). RD-001 says it is
**7 pictures** (PROP0..PROP6 via LNEPRP). Both are right — `PLPROP` drives **two** props:

| | Symbol | Lines | Phases | Data |
|---|---|---|---|---|
| **Enemy plane's prop** | `PROP.F` — *"PLANE PROP PICTURE OFFSET"* (RBARON.MAC:198) | PLPROP :882-900 | 3 (`CPY I,6`) | PPROPA/B/C via `.PROPS` |
| **Player's own prop** | `PLYPRP` — *"PLAYER PROP OFFSET"* (RBARON.MAC:197) | PLPROP :901-916 | **7** (`CPY I,0E` → 0,2,4,6,8,A,C) | PROP0..PROP6 via `LNEPRP` |

Arithmetic witness: `LNEPRP = DBPROP+13D` and `COLLD = LNEPRP+0E` (RBARON.MAC:408-409) →
LNEPRP is 0x0E = 14 bytes = **7 JSRL words**. RD-001's seven pictures are confirmed.

CD-016 read only the first half of PLPROP; RD-001 only the second. **The synthesis MUST NOT merge
RD-001 and RD-005/CD-016 — they are two separate missing features** (we render neither prop, and
we have not even transcribed the player's).

### F. SN-002/SN-011 vs SN-013/SN-014 — who owns POKEY channel 3? **Both; the ROM arbitrates, and SN-011's model is incomplete.**

SN-002 (CONFIRMED) says ch3 = the `WP` plane-announce envelope. SN-013/SN-014 say ch3+ch4 = the
engine hum / approach whine, written directly by `SOUNDS` every calc frame. Both readings are
correct — and the ROM has an explicit priority rule that **no finding states**:

```
RBARON.MAC:997   LDX A,POINT+4     ;OTHER SOUNDS ON ? (HIGHER PRIORITY)
RBARON.MAC:998   BNE 70$           ;YES     <-- SOUNDS yields ch3+ch4 to WP entirely
RBARON.MAC:999   LDA GMEND1
RBARON.MAC:1000  BMI 30$           ;EOL     <-- and mutes at end-of-life
RBARON.MAC:1004  BIT GRMODE        ...      <-- and in ground mode w/ plane not approaching
```

SN-002 **survives** (its channel map is right). But **SN-011's assertion that per-channel seizure
"is the full priority model" is wrong** — the hum *voluntarily yields* to a ch3 envelope, which is
a fourth rule, and any mutual-exclusion fix derived from SN-011 alone will be wrong. Amend SN-011.

### G. Duplicates filed as separate findings (not contradictions, but they will double-count)

| Same fact | Findings | Note |
|---|---|---|
| `returning-ace.ts` is never imported | **CD-010 ≡ EN-019** | literal duplicates, both `m` |
| GMLEVL indexes PLNLVL by `OBJKLD>>1` | **CB-001 ≡ MI-009** | same source line (RBARON.MAC:2403 `LSR`), same fix. EN-011 (CONFIRMED) *states the `>>1` correctly in passing* but pair 3 never filed it — so one fact is 1 CONFIRMED + 2 identical DIVERGENCEs |
| `HORIZN = 0x40` offset is missing | **FL-016 ≡ RD-003** | filed `NO_COUNTERPART` by one pair and `DIVERGENCE` by the other — pick one class |
| DB.LNS drawn dimmer by `0x60` | **OB-014 ≡ RD-006** ⊂ RD-002 | |
| Shells sub-step 4× per calc frame | **CD-006 ≡ CB-015** | duplicate **CONFIRMED**s |
| PFOPOS byte-exact | **MI-013 ≡ OB-010** | duplicate **CONFIRMED**s |
| SEGSTR decodes as ×6+4 | **MI-023 ≡ OB-001** | duplicate **CONFIRMED**s |
| "1 ROM frame == 1 of our steps" | FL-019 / CD-004 / CB-026 | three findings, one fact |

The real CONFIRMED count is **~59**, not 63.

### H. CB-025 is mis-classed

CB-025 is `NO_COUNTERPART` — "Nothing in lives.ts models any of this". But a counterpart **does**
exist, in `returning-ace.ts`, which pair 4 never opened (EN-012/EN-013 audit it and find it
inverted). Not a factual contradiction, but as filed it will double-count against EN-012/EN-013 in
the synthesis. Reclass as a pointer, or fold into the ace cluster.

---

## 3. Scope gaps

### 3.1 `PERCENT` / `PRPDEL` / `PRMDEL` — the adaptive difficulty system. **ASSIGNED TO NOBODY. NEEDS A RE-RUN.**

This is the significant hole. `PERCENT` is in **MAIN's per-calc-frame call list** — the same list
CD-004 walked and pronounced complete:

```
RBARON.MAC:852   JSR PERCENT      ;GAME PERCENTAGING
RBARON.MAC:1610  ;MANTAIN PERCENTAGE INFO IN EAROM
RBARON.MAC:1612  PERCENT: LDA A,PRCTIM
RBARON.MAC:260   PRPDEL: .BLKB 4          ;DELTA PERCENT PLANE
RBARON.MAC:261   PRMDEL  =PRPDEL+2        ;DELTA PERCENT PF OBJECTS (MOUNTAINS)
```

and the deltas it produces are **added to every closing speed in the game**:

```
RBARON.MAC:2419  ADC A,PRPDEL     ;CARRY CLR (ADD PERCENTAGE DELTA)     <-- plane closing rate
RBARON.MAC:3342  ADC A,PRPDEL     ;ADD PERCENTAGING DELTA               <-- free mountain rate
RBARON.MAC:3384  ADC A,PRMDEL     ;ADD PERCENT DELTA                    <-- horizon mountain rate
```

**No pair owns it.** FL-018 explicitly punts it ("PRPDEL is the difficulty percentaging delta and
belongs to another pair's scope") and MI-015 mentions it only in passing. Pair 1 should have
caught it as a MAIN routine with no counterpart; pair 3 and pair 5 should have caught the deltas
it feeds.

This bears directly on the trigger for the whole audit — *"the game seems way off"* — because it
modulates **exactly the closing rates that EN-002, EN-003, EN-014 and MI-015 are already
flagging**. An operator-tunable, EAROM-backed difficulty term stacked on top of constants we
already have wrong is a plausible compounding factor.

**Verdict: needs an auditor re-run.** One agent, `RBARON.MAC` PERCENT (:1612-1880), the two
delta consumers, and our `enemy.ts` / `landscape.ts`.

### 3.2 The RNG and core determinism. **ASSIGNED TO NOBODY. NEEDS A RE-RUN (small).**

The ROM's `RANDOM` is a deterministic software LFSR (`RANDOM: JSR RAND2 ;4 TIMES`,
RBARON.MAC:6193). Ours seeds from the **wall clock, inside the sim step**:

```
src/main.ts:349   const blimpRng = createRng((Date.now() ^ 0x5e_ed) >>> 0)
src/main.ts:467   enemies = spawnWave(createRng((Date.now() + kills) >>> 0), score, ...)
```

main.ts:467 is **inside the accumulator block** (main.ts:373-478). Five audited ROM mechanics ride
on `RANDOM` — the lone-plane roll (EN-010), the blimp roll (EN-022), the level-4 fire coin-flip
(EN-007), the ace 50/50 (EN-013), the ground target groups (MI-008) — so the RNG is load-bearing
for five findings and audited by none.

It also violates this repo's own stated invariant. `CLAUDE.md`: *"`src/core/` is the pure
deterministic simulation … that boundary is the single most important rule in every game repo."*
A wall-clock read inside the sim step means no wave sequence is reproducible and no regression
test can pin one. **CD-004 audited *where* state is written, not *whether the core is
deterministic*, and passed it.**

**Verdict: needs a re-run.** Small — one agent, one file.

### 3.3 The player's own propeller data — pair 6's assigned scope, never opened. **RECORD AS A LIMITATION.**

Pair 6's scope reads: *"Vector object data: the biplane's vertices + connect-lists, blimp,
**prop**, explosion pieces, stars."* Pair 6 audited the **enemy** prop (DBPROP, PPROPA/B/C —
OB-009, OB-011) and never opened the **player's**: `PROP0..PROP6` + `LNEPRP`
(037007.XXX:477-597), a 7-picture screen-space `VCTR` set that `topology.ts` does not contain.
Same for the other screen-space picture sets in pair 6's own file: `B.HOLE` / `SEQUNA` / `SEQUNB`
(037007.XXX:849-914) and `LPLANE` (:918-936).

Only pair 8 noticed, and only from the render side — RD-001 (prop not drawn), RD-010 (bullet holes
not drawn), RD-007 (lives glyph not drawn). Nobody filed *"the data is not transcribed"*.

**Verdict: record as a limitation, no re-run.** Pair 8 covered the consequence and the fix items
already exist; only the data-transcription half of the story is missing, and the fixes will have
to transcribe it anyway. Note it in the audit so the omission is deliberate rather than silent.

### 3.4 Subsystems no pair was assigned at all — **all legitimate; record, don't re-run**

| Subsystem | Citations across all 166 findings | Ruling |
|---|---|---|
| **Coin/credit** (`RBCOIN.MAC`, `TCN65.MAC`) | **zero** | Out of scope. A browser cabinet has no coin slot. **Limitation.** |
| **Self-test / diagnostics** (`RBINT.MAC`) | **zero** | Out of scope. No EAROM, no hardware to test. **Limitation.** |
| **Attract mode** | glancing only — CD-017 (BNRCNT's 48 ms second calc rate), SN-019 (SNDON is a no-op in attract) | We have no attract mode. This is a **product** gap, not a fidelity bug. Flag for the human in "deliberate omissions"; do not re-run. |
| **High-score entry** (`NW.HSC`) | mentioned in passing by CB-023, RD-008 | We use `@arcade/shared/highscore`. **Limitation.** |
| **Math Box** (`MBUCOD`) | none | Explicitly out of scope per the plan (ported in `@arcade/shared/math3d`). ✓ |
| **`COND65` / `ASCVG` / `MBDIAG`** | none | Absent from the quarry. Already recorded. ✓ |

The four "record as a limitation" rows are all defensible, but they should appear **as an explicit
list in the final audit**, signed off by the human — not left as silence.

---

## 4. Honest filing

Good. No action.

| Pair | CONFIRMED | Total | % |
|---|---|---|---|
| 1 cadence | 9 | 17 | 53% |
| 2 flight | 9 | 20 | 45% |
| 3 enemy | 8 | 26 | 31% |
| 4 combat | 11 | 26 | 42% |
| 5 mission | 7 | 23 | 30% |
| 6 objects | 10 | 18 | 56% |
| 7 sound | 6 | 20 | 30% |
| 8 render | 3 | 16 | 19% |

No pair filed zero CONFIRMEDs. Pair 8's 19% is the outlier and it is *earned* — our draw list is a
genuine subset of the ROM's — and it filed two `STRUCTURAL` null results (RD-011: the AVG is
monochrome, our green is legitimate; RD-015: double-buffering is equivalent to our rAF redraw),
which is exactly the behaviour an honest auditor shows when the answer is "we're fine."

---

## 5. Sizing and fragmentation

### 5.1 The epic is unschedulable as filed. Say so plainly.

103 actionable findings (74 `DIVERGENCE`, 14 `NO_COUNTERPART`, 10 `BOOK_WAS_WRONG`, 5 `STRUCTURAL`).
Of these, 93 carry a size: **50 `s`, 34 `m`, 9 `l`**.

- At s=1d / m=3d / l=8d → **224 person-days ≈ 45 working weeks.**
- At the most generous read (s=½d / m=1½d / l=4d) → **112 person-days ≈ 22 weeks.**

**This is not an epic. It is a rewrite of the game.** The human must be told that before they rule
on clusters, because "fix everything" is not on the menu at any staffing level this project has.

### 5.2 Ten actionable findings carry **no size at all** — they will be invisible to any capacity plan

`CD-012` (DIVERGENCE), `CD-015`, `CD-017`, `FL-020`, `EN-026`, `CB-026`, `OB-018`, `SN-019`,
`RD-011`, `RD-015`.

Five of these are `STRUCTURAL` (CD-015, CB-026, RD-011, RD-015 — and these are *observations*, so
being unsized is correct). But **CD-012 (a DIVERGENCE), CD-017, FL-020, EN-026, OB-018 and SN-019
are actionable and unsized.** Size them or classify them out.

### 5.3 Undersized — sized `s`/`m` but obviously a rewrite

| id | Filed | Should be | Why |
|---|---|---|---|
| **CB-013** | `m` | **`l`** | The hit box must become the perspective-projected silhouette: rotate `COLLD` by the plane's live attitude (PLTEST), project it (D.LOOP), reduce to a screen box (MINMAX). That is a new **projection-coupled collision pipeline**, not a constant change. |
| **MI-019** | `m` | **`l`** | "Mountains never scroll laterally" needs `PLYRDL`, `PFXSCR`, `WRAPIT` **and** the fall-time X re-seed from the horizon scroll position. A new subsystem. |
| **FL-014** | `m` | fold into FL-013 (`l`) | The eye is hard-coded to the origin and `toEye()` is dead code. Fixing it re-bases every object's Y on `I4YPOS` across `camera.ts` / `horizon.ts` / `scene.ts` / `landscape.ts`. With FL-013 (turning is a lateral translation of `UNIV4X`, not a yaw) this is **one camera + world-space rewrite**, not `l` + `m`. |
| **RD-002** | `m` | `m`–`l` | Depth-cued intensity must be threaded through `SceneSegment`, `strokeSegments` and every renderer — a cross-cutting type change, not a local edit. |

### 5.4 N findings that are really ONE change

> **THE RADIX FAMILY — ~14 findings, one root cause.**
> `EN-001` (the doc itself), `EN-002` (P.INDP), `EN-003` (ACCEL), `EN-004` (P.MNDP),
> `EN-014` (PLPOSZ, in part), `CB-011` (S.MAXZ), `CB-018` (EX.ACY), `CB-020` (.TIME1/.TIME2),
> `MI-010` (PLANE1/PLANE2), `MI-011` (DRINZ), `MI-016` (P.OBZI), `FL-017` + `MI-022` + `RD-016`
> (HORZ), `OB-013` (the "distance LOD").
>
> Every one is the same sentence: *a constant was copied out of
> `docs/red-baron-1980-source-findings.md`, which prints `.RADIX 16` literals as decimal.* The fix
> is **one sweep** — re-derive every constant from the source under the radix rule, and repair or
> retire the doc — not fourteen tickets. Filing it as fourteen `s`s makes it look like fourteen
> days of trivia. It is one day of re-derivation plus one systemic conclusion that **no individual
> finding states**: *every remaining bare numeric constant in `src/core/` is suspect until swept.*

> **THE RETURNING ACE — 7 findings, 1 feature.**
> `CD-010` ≡ `EN-019` (literal duplicates: the module is never imported), plus `EN-012` (evade
> polarity inverted), `EN-013` (branch order inverted), `EN-014` (PLPOSZ), `EN-018` (the plane
> never flies past you), `CB-025` (mis-classed, §2H). This is one `l`: *"wire up `returning-ace.ts`
> and correct it."* It is also the game's signature mechanic, so it is the cluster most likely to
> explain "seems way off" to a *player*.

> **HORZ / HORIZN — 5 findings, 2 constants.** `FL-016` ≡ `RD-003` (HORIZN = 0x40 missing);
> `FL-017` + `MI-022` + `RD-016` (HORZ = 0x1000 = 4096).

> **INTENSITY — 3 findings, 1 change.** `RD-002` ⊃ `RD-006` ≡ `OB-014`.

> **GMLEVL `>>1` — 2 findings, 1 line.** `CB-001` ≡ `MI-009`.

> **THE BLIMP — 4 findings + 1 false CONFIRMED, 1 module.** `EN-023` (no 4-plane gate), `EN-024`
> (÷2 not ÷4, no level gate), `EN-025` (drifts instead of closing), `EN-026` (no yaw), and CD-005's
> false confirmation of the fire cadence. `blimp.ts` is a rewrite: one `m`.

**After collapsing, the 103 actionable findings are roughly ~70 distinct changes.**

---

## 6. What needs to happen before Phase 5

**Auditor re-runs (2):**

1. **`PERCENT` / percentaging** — unassigned, in MAIN's per-frame call list, modulates every
   closing speed in the game (§3.1).
2. **RNG / core determinism** — unassigned, load-bearing for five findings, violates the repo's
   own core/shell invariant (§3.2).

**Re-classifications (5):**

3. **CD-005** → REFUTED (blimp half). Keep the `FRAME`-is-the-calc-frame half.
4. **CD-009** → REFUTED. Fold into MI-004, and add MI-004's missing `SCRTAB+3` gate.
5. **FL-015** → REFUTED. Fold into FL-013/FL-014.
6. **OB-011** → REFUTED. `topology.ts`'s `PROPS` docstring is **correct**; actioning OB-011 is a
   regression.
7. **CB-025** → reclass from `NO_COUNTERPART`; fold into the ace cluster.

**Amendments (4):** SN-004 (retitle), CB-014 (reword the units sentence), CD-004 (narrow the
completeness claim), SN-011 (the priority model is not per-channel-only — the hum yields to WP at
RBARON.MAC:997-998).

**Recorded limitations (4):** coin/credit, self-test, attract mode, high-score entry — plus the
player-prop / bullet-hole / lives-glyph **data** transcription gap in pair 6 (§3.3). Put these in
the audit as an explicit, human-signed list.

**For the human's ruling:** the epic is ~224 person-days as filed and ~70 distinct changes after
collapsing. It cannot all be done. The clusters most likely to explain *"the game seems way off"*
in descending order of player-visible impact are: **the returning ace (dead code)**, **the weave
servo (EN-015/EN-016/EN-017)**, **the radix family (every constant is wrong by 1.5×–4×)**, **the
camera (FL-013/FL-014 — we rotate where the ROM translates)**, and **the flight gains
(FL-001/FL-004 — 8×–21× too slow)**.

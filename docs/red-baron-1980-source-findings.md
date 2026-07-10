# Red Baron (1980) — source-code findings from the `historicalsource/red-baron` quarry

**Source:** [github.com/historicalsource/red-baron](https://github.com/historicalsource/red-baron) —
the original Atari MAC65 6502 assembly source for *Red Baron* (arcade, 1980; Atari project
**22603**, programmer **Rich Moore**, sound driver **Rich Adam**, dated 3/11/81). Cloned
locally into the gitignored, checkout-local `reference/red-baron/` quarry. This is real Atari
source — original labels and developer comments — not a community disassembly. (Correction,
rb2-2: an earlier draft called the picture/vector ROMs' *source* — `RBPICS.MAC`/`RBCHAR.MAC` — the
one part **not** in the checkout. It is present, merely misnamed by ROM part number: `037007.XXX`
**is** `RBPICS.MAC` and `037006.XXX` **is** `RBCHAR.MAC`. See §7 and the now-closed gap #1 in §9.)

**Scope:** This is rb1-2's authority-chain document — the ROM facts later Red Baron stories rely
on (frame cadence, the flight-camera pipeline, enemy AI, the wave structure, collision/lives, the
POKEY + analog sound model, and the plane/picture/ground object data) are established here, each
cited to its `.MAC` source, before any gameplay code exists. It is scoped to **seed rb1-3 (the
roll/pitch flight camera) and rb2–rb5** — see §10. Per the epic's "don't gold-plate" guardrail,
deep-level (`GMLEVL` 4–5) delta-table fidelity is flagged, not exhaustively traced.

**How this was produced:** four parallel read-only passes over the quarry (mechanics, timing,
sound, object data), each citing `file:label` or `file ~line`. Every material fact is tagged
**[ROM-verified]** (read directly in source) or **[inferred]** (deduced/uncertain) so the Reviewer
can audit citations against the quarry. Constants in `RBARON.MAC`/`RBGRND.MAC` live in a
`.RADIX 16` region (`RBARON.MAC:74`) — hex unless written with a trailing dot (`250.` = decimal).
The committed distillation here does **not** require the gitignored `reference/` quarry to be
present; the quarry's own refresh is just `git clone https://github.com/historicalsource/red-baron`.

> **Two builds in the quarry — and which one shipped (adjudicated).** The quarry ships two nearly
> identical source sets: `RBARON.MAC`+`RBGRND.MAC` and `R2BRON.MAC`+`R2GRND.MAC`. They differ only
> in checksum bytes and **one substantive value: the VG-frame divider `FRMECNT` (4 in `RBGRND.MAC`
> vs 5 in `R2GRND.MAC`)**. The two agents initially disagreed on which shipped. Resolved by the
> actual LINK recipes: **`RBARON.COM`** assembles+links `RBARON,RBCOIN,RBSOUN,RBGRND,VGUT,RBROM,RBINT`
> and emits the released program-ROM part images `037001.01, 037000.01, 036999.01, …` (matching the
> `RBARON.DOC` part manifest) — so the **canonical release is the `RBARON`/`RBGRND` set,
> `FRMECNT=4` → 62.5 Hz**. `R2BRON.COM` links the `R2` set and emits only the `036996.02` EPROM
> revision — an alternate 50 Hz variant. **Adopt 62.5 Hz; treat 50 Hz as the R2 revision.** (The
> `RBARON.DOC` "MAIN PROGRAM SOURCE FILES: … R2BRON … R2GRND" note that misled the first read is
> a stale manifest line, contradicted by the `.COM` build recipes and the release part numbers.)
> Cite `RBARON.COM` / `R2BRON.COM`. [ROM-verified]

---

## Table of contents

1. [Timing & frame cadence — the fidelity trap](#1--timing--frame-cadence--the-fidelity-trap)
2. [Player flight model (seeds rb1-3)](#2--player-flight-model-seeds-rb1-3)
3. [Enemy behavior — planes, drones, the returning ace, the blimp](#3--enemy-behavior--planes-drones-the-returning-ace-the-blimp)
4. [Ground / mission sequence](#4--ground--mission-sequence)
5. [Collision / damage / lives / respawn](#5--collision--damage--lives--respawn)
6. [Sound — POKEY envelope driver + analog board](#6--sound--pokey-envelope-driver--analog-board)
7. [Object / vector data — plane points, connect-lists, picture-ROM inventory, ground objects](#7--object--vector-data--plane-points-connect-lists-picture-rom-inventory-ground-objects)
8. [Math Box / coordinate system (consume `@arcade/shared/math3d`)](#8--math-box--coordinate-system-consume-arcadesharedmath3d)
9. [What's ROM-verified vs inferred / open gaps](#9--whats-rom-verified-vs-inferred--open-gaps)
10. [What this seeds (rb1-3 + rb2–rb5)](#10--what-this-seeds-rb1-3--rb2rb5)
11. [Provenance / changelog](#11--provenance--changelog)

---

## 1 · Timing & frame cadence — the fidelity trap

**Source:** `RBGRND.MAC` (NMI handler), `RBARON.MAC` (main loop, dividers), `RBINT.MAC` (vectors).

This is the single most important fidelity fact. There are three time bases; conflating them runs
the sim at the wrong speed (the Red Baron analogue of the Asteroids ÷4 trap — but the multiplier
here is ~6×).

- **Master tick = NMI every 4 ms → 250 Hz**, from hardware. `RBGRND.MAC:102` `; INTERRUPT OCCURS
  EVERY 4 MS. [FROM HARDWARE]`; corroborated by the 1-second clock `250. × .004 = 1` →
  `INC SECCNT` (`RBGRND.MAC:188-193`). NMI vector `7FFA` → `NMI` (`RBINT.MAC:914`). The IRQ vector
  (`7FFE`) points at `PWRON`, **not** a game tick. [ROM-verified]
- **Display / VG refresh = NMI ÷ `FRMECNT`.** `F.CNTR` counts NMIs; at zero it reloads `FRMECNT`
  and sets the frame-sync flag `INTFLG` (`RBGRND.MAC:231-235`). Shipped **`FRMECNT=4` → 16 ms →
  62.5 Hz** (`RBGRND.MAC:61`; R2 = 5 → 50 Hz). [ROM-verified]
- **Game-logic / calculation frame = NMI ÷ `CALCNT`.** `C.CNTR` counts NMIs; at zero reloads
  `CALCNT` and sets `CALFLG` (`RBGRND.MAC:221-229`). Gameplay **`CALCNT=0x18=24` → 96 ms →
  ~10.42 Hz**; attract/banner **`BNRCNT=0x0C=12` → 48 ms → ~20.83 Hz** (`RBARON.MAC:620-621`).
  [ROM-verified]

The main loop (`MAIN`, `RBARON.MAC:761`) computes the **entire** sim + display list once per
calculation frame, waits on `CALFLG` then `INTFLG` (`INTWAIT`, `RBARON.MAC:924-931`), swaps
buffers, restarts the VG, and `INC FRAME` (`RBARON.MAC:868`). While it computes, the NMI keeps
**re-drawing the previous display list at 62.5 Hz**. So: **the simulation advances one step per
calculation frame (~96 ms, ~10.4 Hz); the picture refreshes at 62.5 Hz.** All motion routines
(`PFMOTN`, `NWPLNE`, `PLMOTN`, `SHLMOT`, `NEWSHL`) run exactly once per loop pass — **the sim
timestep is one calc-frame.** [ROM-verified]

Three distinct counters — do not conflate:

| Symbol | Role | Cadence | Cite |
|---|---|---|---|
| `INTCNT` | raw 4 ms tick (0-249, wraps at 1 s) | every NMI | `RBARON.MAC:120`; `RBGRND.MAC:187` |
| `FRAME` | **game-logic frame counter** (the ÷N masks key off this) | 1× per calc-frame | `RBARON.MAC:140,868` |
| `SECCNT` | real-time seconds | ÷250 NMIs | `RBGRND.MAC:188-193` |

**Frame-cadence summary** (the port contract):

| Subsystem | Cadence | Wall-clock (shipped) | Cite |
|---|---|---|---|
| Master NMI tick | every 4 ms | **250 Hz** | `RBGRND.MAC:102` |
| VG display refresh (`FRMECNT`) | ÷4 NMIs | **16 ms / 62.5 Hz** | `RBGRND.MAC:61,231-235` |
| **Game-logic / calc frame (`CALCNT`)** | ÷24 NMIs | **96 ms / ~10.42 Hz** | `RBARON.MAC:620`; `RBGRND.MAC:221-229` |
| Calc frame, attract (`BNRCNT`) | ÷12 NMIs | 48 ms / ~20.83 Hz | `RBARON.MAC:621` |
| Enemy/ground shell launch (`SHLAUN`) | ÷4 calc-frames (`FRAME&3`) | ~384 ms | `RBARON.MAC:4022-4025` |
| Plane fires shells (`PLNSHL`) | ÷2 calc-frames (`FRAME&1`) | ~192 ms | `RBARON.MAC:4803-4806` |
| Player shell sub-stepping (`SHLMOT`) | **4×** per calc-frame | — | `RBARON.MAC:5186-5198` |
| Shot-sound modulation | ÷8 NMIs (`INTCNT&8`) | 32 ms half-cycle | `RBGRND.MAC:171-174` |
| POKEY self-check (`PKYCNT`) | ÷10 calc-frames | ~960 ms | `RBARON.MAC:847-848` |
| Pot/spinner read (`P.COUNT`) | ÷2 NMIs | 8 ms | `RBINT.MAC:66` |

**One-line port rule:** tick the sim at **one step per calculation frame ≈ 96 ms (~10.4 Hz
gameplay, ~20.8 Hz attract)**; gate enemy-shell spawns ÷4 and plane fire ÷2 off a per-step `FRAME`
counter; sub-step player shells 4× per calc-frame; redraw at 62.5 Hz. Ticking motion every display
frame runs the sim **~6× too fast** (62.5 / 10.42). *Caveat:* 96 ms is the designed **minimum**
period — if 6502 compute overran it the loop slowed (watchdog only trips after `CALFLG ≥ 0x40` ≈
64 missed frames, `RBGRND.MAC:196-202`); treat 96 ms as the fixed timestep unless MAME playtest
says otherwise. [ROM-verified constants; wall-clock rate inferred]

---

## 2 · Player flight model (seeds rb1-3)

**Source:** `R2BRON.MAC` (`POT.X`, `POTSCL`, `PFMOTN`, `DISCHK`, `PFTRIG`); `R2GRND.MAC` (`NMI`,
`POSITP`). Label anchors are identical in `RBARON.MAC`/`RBGRND.MAC`; line numbers cited from the
`R2` read but the code is the same.

**Controls: two analog pots (a flight yoke) + fire + start. No throttle.** `FIRE=$1802` D7=fire,
D6=start (`R2BRON.MAC:520`). A single pot line `POTIN` is multiplexed between the two yoke axes by
the **POT SELECT** bit (`PS.BIT`, `CRSHSN=$1808` D0); the NMI (`R2GRND.MAC:104-161`) alternates
axes via `POTFLG`, noise-filters ±3, and **auto-calibrates** `POTMIN`/`PTRNGE` (self-ranging pot).
Forward motion is **implicit and constant** — the pilot commands only turn and pitch. [ROM-verified]

**The player is the universe center; the world moves around it.** State lives in zero page
(`R2BRON.MAC:88-167`): `UNIV4X` (universe X ×4), `I4YPOS` (eye/horizon Y ×4), `PFROTN` (horizon
roll angle), `PFXSCR` (horizon X scroll). [ROM-verified]

- **Turn / roll → `PLDELX`, a rate with inertia.** `POT.X` (`R2BRON.MAC:5890-5919`) eases `PLDELX`
  toward the commanded pot with 2 counts of hysteresis and step-limited acceleration — the yoke
  sets a *target turn-rate* the plane ramps into, not an instant heading. [ROM-verified]
- **Pitch / climb-dive → `PLDELY`, 11 discrete steps.** `POTSCL` (`R2BRON.MAC:5831-5864`) maps the
  pitch pot to index 0–10 into `POTDLY: .4WORD -32,-23,-17,-10,-5,0,4,8,13,18,25`
  (`R2BRON.MAC:5923`). Center = 0; **asymmetric — dive (−32) is faster than climb (+25)**. [ROM-verified]
- **`PFMOTN` — "update center of screen" (the flight-camera pipeline)** (`R2BRON.MAC:3149-3262`):
  - `PLDELX` (×`DISCHK` scale) adds to **both** `UNIV4X` and `PFXSCR` → turning **yaws/pans the
    whole world horizontally**.
  - **Horizon bank:** `PFROTN = PLDELX × 8`, sign-extended, clamped to magnitude ≤ `0x0100` → the
    roll angle fed to the rotation matrix, so **banking tilts the entire horizon/scene**.
  - **Altitude:** `PLDELY` (×`DISCHK`) adds to `I4YPOS`, **hard-clamped `PLYMIN=8*4 … PLYMAX=180*4`**
    (`RBARON.MAC:445-455`). Because altitude is clamped, you can't crash by pitching into the ground
    in a normal dogfight — terrain only bites in the ground wave (§4). [ROM-verified]
- **Distance-scaled control feel (`DISCHK`, `R2BRON.MAC:3463-3491`):** player deltas scale by
  proximity of the nearest object (close ×1.0 / mid ×0.625 / far ×0.375); ground mode is forced to
  the slow band. Apparent agility rises when something is near. [ROM-verified]
- **Rotation math (`PFTRIG`/`TRIG`, `R2BRON.MAC:5973-6045`):** turns `PFROTN` (bit format
  `XXX XQQA AAAA AA.FF` = quadrant+angle+fraction) into sine/cosine → Math Box matrix regs
  `MM.A`(cos)/`MM.B`(sin). Projector `POSITP`/`POSITH` (`R2GRND.MAC:261-322`) translates by
  `−UNIV4X`,`−I4YPOS`, rotates via the Math Box, perspective-divides by Z depth, adds `HORIZN=$40`.
  **→ direct seed for the rb1-3 flight camera.** [ROM-verified]

---

## 3 · Enemy behavior — planes, drones, the returning ace, the blimp

**Source:** `R2BRON.MAC` (`NWPLNE`/`STPLNE`, `UPDPLN`, `PLNDEL`/`P.WINDW`, `P.UPD0`, `PLNSHL`,
`UPPLEX`, `BLMOTN`).

- **Object budget: 3 motion objects = 1 lead plane + 2 "drones" (wingmen)**; a blimp can borrow a
  slot. `N.MOB` "3 MOTION OBJECTS (1 PLANE, 2 DRONES)" (`R2BRON.MAC:461-462`). Per-object status
  byte `A E C R @ ED P F`: D7 active, D6 explosion, **D3 shoots**, D1/D0 drone flags
  (`R2BRON.MAC:273-275`). [ROM-verified]
- **Spawn cadence & count scale with score** (`NWPLNE`/`STPLNE`, `R2BRON.MAC:2237-2386`): enemy
  enters from a screen side banked 90°, random X/Y, depth `P.INDP=1080`. **Score ≥ 1000 → up to 3
  planes (2 drones); ≥ 300 → ≥ 2 planes (1 drone)**; a `RANDOM` roll gives **25 % chance of a lone
  plane**. Drones fly formation offsets `PLANE1 -100,+100` / `PLANE2 -100,-100`. [ROM-verified]
- **Steering AI is a weaving window-follower, NOT a beeline seeker** (`UPDPLN`/`PLNDEL`/`P.WINDW`,
  `R2BRON.MAC:2566-2870`): the plane accelerates its ΔX (`ACCEL=30`) toward window limits and
  **reverses at inner/outer boundaries**, weaving across screen center; it **banks proportional to
  turn-rate** (`X/Y rotation = −4·ΔX`, clamped `P.MAXR=0x1FF` = 90°). Limit/delta tables are
  `GMLEVL`-indexed (`P.OLIM 40,80,120,1A0,200` / `P.ILIM 20,30,80,120,160`, `R2BRON.MAC:2935-2952`)
  → higher level = larger, more aggressive deltas. *(This mirrors the Battlezone finding that
  authentic Atari enemy AI is a state machine, not a seeker — see the sibling notes.)* [ROM-verified]
- **The "Red Baron" pass: fly-by → returning attack from behind** (`P.UPD0`,
  `R2BRON.MAC:2723-2738`): when a plane closes past `P.MNDP=140` it enables returning-plane shells,
  fires the **"BEHIND YOU"** message, records `ENSIDE` (which side), and re-enters as a **returning
  plane** (`NWENME`) that intercepts the player. Deeper levels close faster (`PLPOSZ`
  `GMLEVL`-indexed). This is the signature get-on-your-six mechanic. [ROM-verified]
- **Firing: only aggressive/high-level planes shoot, every other frame** (`PLNSHL`,
  `R2BRON.MAC:4798-4807`): fires only if status D3 set; `FRAME` LSB gates ÷2. The D3 "@ PLAYER" bit
  is granted by level (`NWPLNE:2345-2355`): **level < 4 never shoots (`0B0`); level 4 = 50 %; level
  5 = always (`0B8`)**. Level ramps with kills via `PLNLVL: 0,0,0,0,1,2,2,2,3,3,3,4,4,4,4,4,5`
  indexed by `OBJKLD`. [ROM-verified]
- **Killed enemy = falling/spinning wreck; a wingman is promoted to lead** (`UPPLEX`,
  `R2BRON.MAC:2957-3030`): gravity `EX.ACY=-20` per frame, spins about Z; `.EXPL1=6` frames fall →
  `.EXPL2=12` explosion; then `PLNXCG` **promotes an airborne drone into the next lead plane**. So
  shooting the leader hands the fight to a wingman. [ROM-verified]
- **Blimp/Zeppelin** (`BLMOTN`, `R2BRON.MAC:4165+`): ~25 % random spawn, drifts across, **also fires
  at the player**, worth 200 pts. There is **no separate "barrage balloon"** — the airship is the
  blimp. [ROM-verified]

---

## 4 · Ground / mission sequence

**Source:** `R2BRON.MAC` (`NWPLNE`/`MODECT`, `INITGR`, `PFOBMN`, `GRDISP`); `R2GRND.MAC`
(`SCAPE0..3`, `PFOCOL`).

- **Play alternates PLANE waves and GROUND (strafing) waves.** A `NEWCT` countdown steps `MODECT`,
  whose LSB selects plane wave (`STPLNE`) vs ground wave (`INITGR`) (`R2BRON.MAC:2254-2269`).
  Inter-wave counts `MCOUNT: .BYTE 4,2,3,2,1,3,4,2` (`R2BRON.MAC:1296-1297`). `.LEVLS=5` is the
  difficulty *ceiling* reached via kills (§3), not discrete stages. [ROM-verified]
- **Ground wave = low-altitude run over a scrolling landscape** (`INITGR`, `R2BRON.MAC:1401-1407`):
  sets `GRMODE=0C0` (D7 ground + D6 plane-disable), so the main loop skips new-plane generation and
  slows control. Landscape = four mountain-range silhouettes `SCAPE0..SCAPE3` (`R2GRND.MAC:725-798`,
  each a `PFPNTS x,height,intensity` list); up to 4 `PFOBJ` mountain slots scroll toward the player
  and "fall" from the horizon (`PFOBMN`). [ROM-verified]
- **Ground targets** displayed by `GRDISP` (`R2BRON.MAC:3550-3706`) using `PFOCOL` collision
  outlines: objects with type index **≥ 4 are active gun emplacements that shoot at the player**
  (`JSR SHLAUN`); type < 4 are passive. Targets explode with expanding circles (`EXCRCL`). The
  *taxonomy* of each object (tank/tent/gun) is not labeled in source — only geometry + active/passive.
  [ROM-verified split; taxonomy inferred]
- **Scoring tied to mechanics** (`PLNSCR`/`DRNSCR`, `R2BRON.MAC:3034-3046`): a lit/close plane scores
  `PLVALU = depth × VALFRC` (score fraction, starts 7/10) — **closer kills are worth more**; drones
  and dim/far planes are a flat **300 pts** (`DRNPNT=30.`); blimp = **200 pts**. Kills bump `OBJKLD`
  → drive `GMLEVL`. A time-based "percentaging" (`PRPDEL`/`PERCENT`) also speeds approach over time.
  [ROM-verified]

---

## 5 · Collision / damage / lives / respawn

**Source:** `R2BRON.MAC` (`NEWSHL`/`SETSHL`, `CDSSET`/`SHCDCK`, `EOLSEQ`/`ENDLFE`, `GMINIT`/`INITIAL`).

- **Player shells vs enemies (air):** fire while held, **alternating L/R guns**, with a **gun-overheat
  model** — `GUN.ST` +1 per shot, cools ×3 when not firing; overheated guns lock out and show a
  warning (`NEWSHL`/`NWSHL1`, `R2BRON.MAC:2149-2233`). 13 shell slots; shells advance in Z, expire at
  `S.MAXZ=19`. Hit test: `CDSSET` builds rotated/projected min-max collision windows; `SHCDCK`/`COLSTP`
  test each **player** shell against them (enemy shells skipped). [ROM-verified]
- **Enemy fire vs player is NOT a per-pixel hit test.** Two distinct death channels:
  - **(a) The returning ace — an evade check, not a projectile collision** (`EOLSEQ`,
    `R2BRON.MAC:1070-1102`): during the ace's pass, at `PLSTAT+7==0C` the game checks the player's
    bank — `ENSIDE EOR PLDELX` must show banking to the correct side **and** `|PLDELX| ≥ 0x1C` (a
    hard-enough turn) to evade, else the player dies. **First attack is a free dodge** (`BEFLAG`
    "FIRST TIME FREE"); every subsequent one is **50/50** (`RANDOM`). This is the core "bank hard to
    shake him" mechanic. [ROM-verified]
  - **(b) The ground:** *ground fire* (`SHLAUN`, `R2BRON.MAC:4022-4110`) leads/aims at the player,
    only 1 of 4 frames and **only at `GMLEVL ≥ 2`** ("NO GROUND SHELLS @ LOWER LEVELS"); count grows
    with level (`GRSLVL: 0,14,42,70`). *Terrain crash*: when a mountain reaches min depth, `SCENE2`
    runs `PLYCOL` (window `PCDX=0C1`,`PCDY=60`) and on contact sets `GREND` D6 "GROUND COLLISION"; the
    main loop aborts the frame ("PLAYER RAN INTO GROUND", `R2BRON.MAC:781-782`). [ROM-verified]
- **Lives & respawn** (`EOLSEQ→ENDLFE`, `R2BRON.MAC:1055-1210`): on death the windshield **bullet-hole**
  graphics step in (side = `ENSIDE`), the horizon scrolls down and the playfield spins with a spiral
  sound, then a starfield + plane-explosion; `ENDLFE` does `DEC LIVES` → `INITIAL` respawn if any
  remain, else high-score entry. Initial lives from options `INITLF: .BYTE 2,3,4,5`. [ROM-verified]
- **Respawn spawn-grace** (`GMINIT`/`INITIAL`, `R2BRON.MAC:1215-1291`): on (re)spawn,
  `PLSTAT+7 = WO.CNT(5)` **disables enemy planes for 5 frames**, clears shells/mountains/drones,
  resets eye altitude `I4YPOS=0x0210`. (Analogous to Battlezone's `rez_protect` spawn grace.) [ROM-verified]

---

## 6 · Sound — POKEY envelope driver + analog board

**Source:** `RBSOUN.MAC` (POKEY driver, credited **Rich Adam**; `.TITLE RBSOUN-(WAS T2SOUN)` —
ported from an earlier game); `RBARON.MAC` (`SOUNDS:`, triggers, `CRSHSN` latch); `RBGRND.MAC` (4 ms
latch composition + `MODSND` call). Red Baron uses **two independent sound subsystems**; a faithful
port needs both.

**(A) POKEY envelope-table driver — 5 digital/reward tones.** [ROM-verified]

| Effect | Label | Trigger | POKEY ch | One-shot/loop |
|---|---|---|---|---|
| Score tick (small) | `TK` | `SOUND 0` (`RBARON.MAC:1575`) | ch1 | one-shot, fades |
| Score tick (larger) | `TP` | `SOUND 4` (`RBARON.MAC:1578`) | ch1 | one-shot, fades |
| Bonus life | `BN` | `SOUND 2` (`RBARON.MAC:1594`) | ch1 | rising warble ×6 |
| Enemy plane announce | `WP` | `SOUND 1` (`RBARON.MAC:2313,3017`) | ch3 | descending ×3 |
| 300-point jingle | `TH` | `SOUND 3` (`RBARON.MAC:3038`) | ch2 | 6-note melody |

**Table format = variable-length envelope stepper, NOT the ALSOUN 6-byte format.** The in-source
"6 BYTES PER SOUND" comment (`RBSOUN.MAC:124`) is **stale** — the `OFFSET` macro emits **8 bytes/sound**
(one offset per POKEY register; the caller uses `.X*8+7`). A `0` offset = "leave that channel
untouched." Each channel's data is a chain of **4-byte sequences**: `STVAL` (start value), `FRCNT`
(frames to hold each step, at 4 ms), `CHANGE` (signed step delta), `NUMBER` (# changes − 1),
terminated by a 2-byte `X,0` idle sentinel (`RBSOUN.MAC:85-92,146-160`). Example — score tick `TK`
(`RBSOUN.MAC:157-160`): `AUDF1=$30` held; `AUDC1` starts `$A4` (high nibble `A`=pure tone, low nibble
= volume 4) and decays −1 each 7 frames → a pure tone fading 4→0. POKEY setup: `AUDCTL=0` (4
independent channels, 64 kHz, no joins), `SKCTL=7` (`RBINT.MAC:300-307`). Driver: `SNDON` starts (play
mode only), `MODSND` steps every 4 ms (`RBGRND.MAC:237`). [ROM-verified]

**(B) Discrete analog board — gun, explosion, spiral, engine hum.** Control latch `CRSHSN=$1808`
composed and written every 4 ms (`RBGRND.MAC:168-186`): **D2** machine gun (strobed by `INTCNT&8` for
the rat-a-tat, gated by shell timer `S.VAL`), **D4-D7** explosion level (`EXPVAL=$F0` ramps down over
`.EXPL1..2` frames), **D1** spiral/dive. Background **engine "hum"** = direct POKEY writes of detuned
oscillators `$F8/$F7` on ch3/ch4 (`RBARON.MAC:1037-1040`, `AUDC=$A1`); an **enemy-approach whine**
ramps `ATGVAL` on ch3/ch4 by distance (`RBARON.MAC:999-1035,2447-2460`). The analog *timbre* (noise
filtering) lives on the discrete `036…` sound PCB, **not** in this source — a port must synthesize
plausible noise from the bit-level control (gun = white noise gated every ~8×4 ms; crash = noise burst
decaying `$F→0`). **No coin or start jingle** exists (coin = mechanical `TCN65`; "start" is a lamp on
`CRSHSN` D3). [ROM-verified control; analog timbre inferred/off-CPU]

---

## 7 · Object / vector data — plane points, connect-lists, picture-ROM inventory, ground objects

**Source:** `RBARON.MAC` (`PLANE POINTS DB`, macros, equate chains); `RBGRND.MAC` (decode engine,
`SCAPE*`, `PFOCOL`); `037006.MAP`/`037007.MAP`/`RBARON.DOC` (picture-ROM layout).

**The critical source split (read first):** raw 3-D **vertices** live in the program ROM and **their
source is present** (`RBARON.MAC`). The **connect-lists + finished pictures** (the plane's face/line
lists `DB.MAP`/`DB.MAR`/`DB.LNS`, the blimp, explosion pieces, prop, glyphs) live in the **picture/vector
ROMs** `037007`/`037006` — **and their source is present too, merely misnamed by ROM part number**:
`037007.XXX` **is** `RBPICS.MAC` (its header reads `.TITLE RBPICS - RED BARON PICTURES`) and `037006.XXX`
**is** `RBCHAR.MAC`. The full connect-lists are therefore enumerable, and were transcribed byte-for-byte
into `red-baron/src/core/topology.ts` (rb2-2); gap #1 in §9 is **closed**. [ROM-verified: layout AND contents]

**Point-encoding macros** (`RBARON.MAC:15-35`): each scales args so 8-bit bytes hold sub-unit precision.
`POINTP .X,.Y,.Z → .BYTE .Z, .X*2, .Y*4` — **one model vertex = 3 bytes, byte order Z, 2·X, 4·Y**, each a
signed 8-bit coordinate (`RBARON.MAC:4873-4875`: `DB.PLN = Z (S7654321), +1 = X, +2 = Y`). `.4WORD/.3WORD/.2WORD`
scale word tables ×4/×3/×2; `PFPNTS` = a **2-D** playfield point (`X/2, Y*2`, Z discarded); `VV/BV/ENDDB` =
connect-list opcodes (`byte = pointindex*6 + visible`; `$FF` = end). **Decoded example** — biplane vertex 12
(`RBARON.MAC:6225`): `POINTP -40,20,-40 ;12 TOP WING` → model coord **(X=−40, Y=+20, Z=−40)** = the left tip
of the upper wing. [ROM-verified]

**Biplane 3-D model ("PLANE POINTS DB", `RBARON.MAC:6207-6279`):** 42 vertices total. **Built-in
distance LOD:** the *full* plane = 42 pts (`.PLPNT`); the *drone / distant* plane = **29 pts** (`.DRPNT`,
points 0-28 only, no back faces). Near player-visible plane draws all 42 + back-face list `DB.MAP` + wing
struts `DB.LNS`; far drones draw 29 + front list `DB.MAR`. `BLCOLL` = the 8-vertex ±16,±16,±40 collision
cube (hit tests, not display). Root pointer table `PLNDB` (`@ 709E`) indexes every drawable point-set
(plane, prop, collision box, explosion pieces, blimp, stars). [ROM-verified vertices & counts; LOD reading inferred]

**Decode engine** (`RBGRND.MAC:658-720`): walks the transformed-point scratch buffer `DB.TRP` (6-byte
records Z,X,Y lo/hi), emits AVG `VCTR`s. Worked example present in-source: `BULLDE` (bullet-hole "X",
`RBGRND.MAC:814-822`). The plane's own face/line topology is in `RBPICS.MAC` = `037007.XXX`
(`DB.MAP`/`DB.MAR`/`DB.LNS`), transcribed in rb2-2 → `src/core/topology.ts`. [ROM-verified engine AND plane topology]

**Picture-ROM object inventory** (addresses from `RBARON.MAC:378-437` equate chains, anchored by
`MSGS=$31BE`/`HATCH=$32FC` matching `037001.MAP` and `SINE=$3800` matching `RBARON.DOC`):
`037006` (glyph/message ROM, base `VGMSGA=$316E`): `MSGS`, multilingual attract text `ENGMSG/FRNMSG/SPNMSG/GRMMSG`,
`CIRCLE`, `HATCH` (cockpit cross-hatch). Actual letter/digit **glyph vectors** are `VGAN.MAC` (present!,
`CHAR.A..Z`, `CHAR.0..9`, 37 labels — the HUD/score font).
`037007` (picture ROM, base `SINE=$3800`): `PROPS`/`DBPROP` (prop blades), `H.MAP`/`SCMAP` (mountain decode
ptrs), `DB.MAP`/`DB.MAR`/`DB.LNS` (plane back-face/front-face/wing-strut connect-lists), `COLLD`, `PIECE0..3`
(4 explosion-debris models), `STAR0`/`STAR1` (starburst debris), `BLIMP`/`DBLIMP` (the Zeppelin). [addresses ROM-verified via
anchored chain AND contents transcribed from `037007.XXX` = `RBPICS.MAC` in rb2-2 → `src/core/topology.ts`]

**Ground/landscape objects** (`RBGRND.MAC`): mountain silhouettes `SCAPE0..3` (21/16/18/15 pts, `PFPNTS`
2-D format); the **blimp** (`BLOBJ`, the only airship — no separate balloon); bullet holes (`BULLT0/1` +
`BULLDE`); 24 `PFCOL` collision boxes (`PFOCOL`). Horizon/altitude constants `HORZ=1000`, `HORIZN=$40`,
`PFPLOW=80*4` (min altitude), `PLYMIN/PLYMAX` (§2). [ROM-verified]

---

## 8 · Math Box / coordinate system (consume `@arcade/shared/math3d`)

**Source:** `MBUDOC.DOC`, `RBARON.DOC` (memory map), `RBGRND.MAC` (`ZAXIS`/`YAXIS`/`XAXIS`, `D.LOOP`).
**Decision (epic ruling):** the port **consumes `@arcade/shared/math3d`** and does **NOT** re-port the
Math Box — porting from Battlezone would reintroduce the exact duplication the SH epic eliminated. This
section only records the conventions needed to feed the shared module correctly.

The transform coprocessor is the **Math Box** (AMD 2901 bit-slice), mapped `$1860-187F` (inputs), results
at `$1804/$1806`, busy/done `$1800 D7` (`RBARON.DOC:287-323`, `MBUDOC.DOC:51-131`). Primitives: rotate/
matrix-multiply `output=(x−e)*a−(y−f)*b`; perspective projection `output=(x*b+y*a+f)/(x*a−y*b+e)`; dedicated
per-vertex divides `Z/X'` and `Y'/X'`. Conventions to feed `math3d`:
- **Model vertex order in memory: Z, X, Y** (signed 8-bit; `POINTP` stores `Z, 2X, 4Y`). [ROM-verified]
- **Axis handedness (source-space):** X = +right/−left, Y = +up, **Z = +behind / −forward** (nose at −Z:
  fuselage-front pts at Z=−36 vs tail at Z=+40). [inferred from vertex data]
- **Rotation order (`RBGRND.MAC:469-576`):** Z-axis (roll) **first, always**, then **either** Y-axis (yaw)
  **or** X-axis (pitch) depending on flight mode (`PLTEST`). Angles from the `SINE` table. [ROM-verified]
- **Projection (`D.LOOP`, `RBGRND.MAC:624-656`):** add per-object depth to rotated Z, divide rotated X,Y
  by that depth → screen X,Y, plus `HORIZN=$40` offset. The AVG (`VGAN.MAC`) consumes the resulting screen
  deltas as `VCTR dx,dy,brightness`. [ROM-verified]

---

## 9 · What's ROM-verified vs inferred / open gaps

**ROM-verified (portable today):** the frame cadence (§1), the flight-camera pipeline + all its constants
(§2), the enemy AI structure and level tables (§3), the wave alternation + scoring (§4), the two death
channels + lives/grace (§5), the full POKEY sound model + inventory + the corrected 8-byte table format
(§6), the biplane's **42 authentic vertices** + point/connect encoding + Math Box conventions (§7-8).

**Open gaps / deferred (candidate follow-up stories):**
1. **~~Picture-ROM source is absent.~~ CLOSED (rb2-2).** The picture-ROM *source* shipped in the quarry all
   along — misnamed by ROM part number: **`037007.XXX` IS `RBPICS.MAC`** (`.TITLE RBPICS - RED BARON PICTURES`)
   and **`037006.XXX` IS `RBCHAR.MAC`**. The biplane connect-lists (`DB.MAP` back-face, `DB.MAR` front-face,
   `DB.LNS` wing struts) plus `BLIMP`/`DBLIMP`, the explosion pieces (`PIECE0-3` + `PCDEC0-2`), the prop
   (`DBPROP` + `PPROPA-C`), the star-burst debris (`STAR0/1` + `DESTR0/1`) and `COLLD` were transcribed
   byte-for-byte from `037007.XXX` into `red-baron/src/core/topology.ts` (rb2-2), with the `BLANKV`/`VSBLEV`
   = `pointIndex*6 + pen` opcode arithmetic. **The plane's full face/line topology is now enumerable** (the 42
   program-ROM vertices from `RBARON.MAC` + these connect-lists). `RBCHAR.MAC` (`037006.XXX`, the glyph/message
   ROM) remains on hand for a future font/HUD story. **Consequence: rb2-3 (render), rb2-6 (explosions) and
   rb2-10 (blimp) draw authentic geometry, not stand-ins.**
2. **Analog sound timbre is off-CPU** — gun/explosion/spiral noise character lives on the discrete sound PCB,
   not this source; must be synthesized to taste from the bit-level control (§6).
3. **Exact wall-clock game rate** depends on 6502 compute time; 96 ms is the designed minimum, not a guaranteed
   constant — confirm against MAME if it matters (§1).
4. **Ground-target taxonomy** (what each `PFOBJ` represents) is unlabeled — only geometry + active/passive (§4).
5. **Deep-level (`GMLEVL` 4-5) delta tables** confirmed level-indexed and escalating but not exhaustively traced
   (per the "don't gold-plate" guardrail).

---

## 10 · What this seeds (rb1-3 + rb2–rb5)

- **rb1-3 (flight-camera foundation):** §2 (the `PFMOTN` pipeline: `PLDELX`→world pan, `PFROTN=PLDELX×8`→horizon
  bank clamped ≤`0x100`, `PLDELY`→`I4YPOS` clamped `8*4..180*4`) + §8 (Z,X,Y order, Z-then-Y|X rotation,
  divide-by-depth, `HORIZN=$40`) fed through `@arcade/shared/math3d`; tick at the §1 calc-frame cadence.
- **rb2+ (enemies/combat):** §3 (weaving window-follower AI, score-scaled spawn counts, the returning-ace pass,
  level-gated firing) + §5 (evade-check death, gun-overheat, spawn grace).
- **ground wave:** §4 (`MODECT` wave alternation, `SCAPE*` mountains, active/passive ground targets).
- **sound story:** §6 (5 POKEY envelope tables in the corrected 8-byte format + the analog latch model).
- **render/objects:** §7 (42-vertex biplane + LOD split, picture-ROM inventory) + the transcribed
  `src/core/topology.ts` (rb2-2) — **gap #1 is closed**, so rb2-3/rb2-6/rb2-10 render authentic
  plane / explosion / blimp topology, not stand-ins.

---

## 11 · Provenance / changelog

- **2026-07-09 — rb1-2 (initial).** Quarried `github.com/historicalsource/red-baron` into the gitignored
  `reference/red-baron/`; distilled by four parallel read-only passes (mechanics, timing, sound, object data),
  each citing `file:label`/`file ~line`. The one cross-pass conflict — which build shipped, and therefore
  62.5 Hz vs 50 Hz — was adjudicated against the `RBARON.COM`/`R2BRON.COM` LINK recipes and the release part
  numbers: **canonical = `RBARON`/`RBGRND`, `FRMECNT=4`, 62.5 Hz** (see the header note). The committed doc is
  self-contained; the `reference/` quarry it was pulled from is gitignored and not required for any fact here.
- **2026-07-10 — rb2-2 (picture-ROM correction + topology transcription).** Closed gap #1. The picture-ROM
  *source* was present in the quarry all along, misnamed by ROM part number (`037007.XXX` = `RBPICS.MAC`,
  `037006.XXX` = `RBCHAR.MAC`). Transcribed the biplane connect-lists (`DB.MAP`/`DB.MAR`/`DB.LNS`) and the
  prop / explosion / blimp / star picture-lists — 287 connect opcodes across 12 lists — from `037007.XXX`
  into `red-baron/src/core/topology.ts`, and corrected the four stale "absent" claims here (the header note,
  §7, §9 gap #1, §10). Encoding: `BLANKV`/`BV` = `point*6` (dark move), `VSBLEV`/`VV` = `point*6+1` (draw),
  `ENDDB` = `$FF`.

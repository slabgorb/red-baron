// The modules that actually shipped in the 14-SEP-81 Red Baron build. This is NOT
// the directory listing — the source tree contains a complete, plausible-looking
// SECOND build that did not ship, and citing it silently poisons a finding.
//
// 1. Linked objects, from RBARON.MAP's link string (and RBARON.COM's LINKM recipe):
//      BIN:RBARON,RBARON.XX=OBJ:RBARON,RBCOIN,RBSOUN,RBGRND,VGUT,RBROM/C
//      RBINT
//    RBARON.COM's IMGFIL step then splits that binary into the seven release ROM
//    images — 036995.01, 036996.01, 036997.01, 036998.01, 036999.01, 037000.01,
//    037001.01 — which is what makes this the shipping build and not a prototype.
//
// 2. Modules those objects `.INCLUDE`, therefore also shipped (verified by grepping
//    every linked module for `.INCLUDE`):
//      TCN65   — RBCOIN.MAC:27
//      VGMC    — RBINT.MAC:119 (also 037007.XXX:42, same module)
//    Three more are `.INCLUDE`d by shipped modules but are ABSENT from the quarry
//    entirely — COND65 (RBSOUN.MAC:3), ASCVG (RBINT.MAC:120), MBDIAG (RBINT.MAC:557).
//    They shipped, but we do not have their text, so nothing can be cited against
//    them and they stay off this list: a citation to a file we cannot open is not
//    evidence. Record them as an audit limitation instead.
//
// 3. The picture / character ROMs. These are separate LINKM builds (037007.MAP,
//    037006.MAP), not part of the RBARON link string — but they are real ROMs in the
//    real cabinet, and src/core/topology.ts is transcribed directly from 037007. So
//    they are citable, under their on-disk names:
//      037007  — `.TITLE RBPICS - RED BARON PICTURES` (the vector picture ROM)
//      037006  — `.TITLE RBCHAR - RED BARON CHAR SET` (the glyph / message ROM)
//
// REJECTED as never-shipped:
//   R2BRON, R2GRND — an EARLIER build (R2BRON.MAP, 10-SEP-81) that emits only one
//     ROM image (036996.02). These are the decoys, and they are vicious: R2BRON.MAC
//     is byte-identical to RBARON.MAC but for 14 lines, and R2GRND.MAC differs from
//     RBGRND.MAC in exactly TWO places — `FRMECNT=5` instead of `FRMECNT=4` (line 61)
//     and `CMP I,40` instead of `CMP I,3` (line 197). Cite the wrong one and the
//     display rate comes out 50 Hz instead of 62.5 Hz, with nothing to warn you.
//     R2BRON's object module is even *identified* as "RBARON" in its own load map.
//   036464 — RBDEC, the auxiliary decode PROM. Not game code.
//   MBUCOD — the Math Box microcode (builds 03617X.SAV). Real silicon, but it is the
//     coordinate hardware, ported in @arcade/shared/math3d, and out of this repo's
//     scope. Out of scope is not the same as never shipped; kept off the list so that
//     nothing in THIS audit rests on it.
//   VGAN — no shipped module `.INCLUDE`s it. Only 037006 (RBCHAR) does, and RBCHAR is
//     the glyph ROM, which nothing in our clone draws from yet.
//   STATE2 — a standalone utility, absent from every link string.
//
// Before adding anything here: it must be on the RBARON.MAP link line, `.INCLUDE`d
// (directly or transitively) by something that is, or one of the two picture ROMs
// above. Anything else, however plausibly named, never assembled into the game.
export const LINKED_MODULES = [
  // linked objects (RBARON.MAP)
  'RBARON', 'RBCOIN', 'RBSOUN', 'RBGRND', 'VGUT', 'RBROM', 'RBINT',
  // .INCLUDEd by one of the above, and present in the quarry
  'TCN65', 'VGMC',
  // the picture / character ROMs (separate builds, real silicon)
  '037007', '037006',
]

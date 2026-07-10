# Red Baron

A faithful, browser-based clone of Atari's 1980 vector arcade game *Red Baron*
— the first-person WWI biplane dogfight over a vector landscape.

**▶ Play it live: [red-baron.slabgorb.com](https://red-baron.slabgorb.com)**

Banking flight, a tilting horizon, mountains, balloons, and ground targets —
glowing vector lines on black, rendered with HTML5 Canvas 2D. No 3D engine, no
physics engine, no backend. Battlezone's hardware twin (same Math Box / AVG
lineage), built as a **deterministic pure simulation core** wrapped by a thin
input/render shell — the same architecture as its siblings
[battlezone](https://github.com/slabgorb/battlezone),
[star-wars](https://github.com/slabgorb/star-wars), and
[tempest](https://github.com/slabgorb/tempest).

> **Status:** Early. The flight-camera foundation and the ROM-faithful flight
> model (pot-yoke turn rate, 11-step pitch table, bank coupling) are in place
> (epic rb1); the aerial-combat slice — enemy biplanes, dogfight AI, machine-gun
> fire, waves, sound — is in progress (epic rb2).

## Quick start

```bash
npm install
npm run dev
```

Then open **http://localhost:5277**.

## Architecture

```
src/
├── core/    # PURE, deterministic, unit-tested — no DOM/canvas (flight sim + Math Box)
├── shell/   # IO: render / input / loop / audio
└── main.ts  # bootstrap: canvas + wire shell ↔ core
```

**The core is pure and deterministic.** It never imports from `shell/`, never
touches the DOM/`window`/`canvas`, and never calls `Date.now()`,
`performance.now()`, `Math.random()`, or `requestAnimationFrame`. All time
enters as `dt`; all randomness comes from a seeded RNG carried in the state.

Authentic behavior is ported from the commented disassembly of the original
cabinet (historicalsource/red-baron); the quarry is kept locally under
`reference/` (gitignored) — never committed.

## Tech stack

- **Language:** TypeScript (ES modules, strict mode)
- **Build tool:** [Vite](https://vitejs.dev/) — dev server pinned to port 5277
- **Tests:** [Vitest](https://vitest.dev/) — TDD on the pure core
- **Rendering:** HTML5 Canvas 2D (`shadowBlur` for the vector-CRT glow)

## Development

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the Vite dev server on port 5277 |
| `npm run build` | Type-check (`tsc --noEmit`) and build to `dist/` |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Run Vitest in watch mode |

Sprint/epics are managed at the
[arcade orchestrator](https://github.com/slabgorb/arcade), not here.

## Releasing

This repo ships from the [arcade orchestrator](https://github.com/slabgorb/arcade):
`just release red-baron` gates on tests + build, merges `develop` → `main`, tags
`vX.Y.Z`, and pushes. Every push to `main` auto-deploys to Cloudflare R2 via
GitHub Actions (`.github/workflows/deploy.yml`) — **`main` is production; never
push it by hand.** A red CI run deploys nothing.

## License

Private project, for personal/educational use. *Red Baron* and *Atari* are
trademarks of their respective owners; this is an educational clone built to
learn how the original worked.

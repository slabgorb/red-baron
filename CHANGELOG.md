# Changelog

All notable changes to **Red Baron** — a faithful browser clone of Atari's 1980 vector classic.

Play it at **[red-baron.slabgorb.com](https://red-baron.slabgorb.com)**.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries describe what changed
for the player. Purely internal work is summarised under *Internal*.

Red Baron is still in active development — it is the newest cabinet in the arcade, and
not yet feature-complete against the 1980 original.

## [Unreleased]

### Fixed
- **The planes fly the way they look.** Roughly thirty gameplay constants were read out of
  the 1980 source as decimal when the source declares them **hexadecimal**. One
  transcription error, about thirty casualties: enemy weave was 37% too slow, aircraft
  spawned nearly **four times too close**, the fly-by trigger fired 2.3× too late, your guns
  lost a fifth of their range, and the horizon sat four times too near. The vector shapes
  were never wrong — the picture data really is decimal, and it was transcribed correctly.
  That is exactly why the game *looked* right and *behaved* wrong.
- A tracer is now drawn at the depth it actually kills at, and a blimp disappears when it
  truly leaves the screen rather than at a fixed distance.

## [0.0.13] - 2026-07-13

Version bump only.

## [0.0.12] - 2026-07-13

### Internal
- Red Baron's audio moved onto the arcade's shared synth. No sound changes — the same
  voices and the same tunings.
- An audit of this clone against the original 1980 Atari source, kept honest by a gate that
  re-opens every citation on both sides. It found that the ROM's gameplay constants are
  hexadecimal and that we had transcribed about thirty of them as decimal — the reason the
  aircraft look right and fly wrong. **This release contains the audit only; no gameplay
  code changed.** The correction itself is above, in *Unreleased*.

## [0.0.11] - 2026-07-12

No player-visible changes. Documentation only.

## [0.0.10] - 2026-07-12

### Internal
- A ROM-versus-port vector-picture contact sheet, for verifying the hand-transcribed
  shapes against the 1980 cabinet's own picture data.

## [0.0.9] - 2026-07-12

### Added
- **Sound.** The cabinet's POKEY and analog audio — engine hum, machine guns, the
  approach whine, and explosions — arrives at last. Red Baron has been silent until now.
  The sound is synthesised locally, as Battlezone's is: these are oscillator voices, not
  samples, so they can't come from the arcade's shared sample engine.

## [0.0.8] - 2026-07-12

### Added
- **The Zeppelin flies.** The blimp is now wired into the game properly: it spawns,
  drifts, shoots back, collides, scores, and departs.
- **Esc** pauses the game, consistent with the rest of the arcade.

## [0.0.7] - 2026-07-11

No player-visible changes. Version bump only, published as part of a fleet-wide release.

## [0.0.6] - 2026-07-11

### Added
- **A landscape that scrolls past you** — four mountain ranges drawn from the cabinet's
  original terrain slots.
- The blimp / Zeppelin joins the roster of things in the sky.

## [0.0.5] - 2026-07-11

### Added
- **Lives, death and respawn.** You can now be shot down, with a death sequence and a
  grace period when you return.
- **Ground-attack waves**, which force you to slow down as you come in.
- The returning ace: enemy pilots evade and come back for another pass.
- The ground and its landscape data, transcribed from the original ROM.

### Fixed
- Corrected the altitude ceiling — the sim had been reading the cabinet's maximum height
  in the wrong number base, capping you at less than half the real altitude.

## [0.0.4] - 2026-07-10

### Added
- **Guns.** Machine-gun fire with hit detection.
- **Kills, explosions and scoring**, with a wreck animation and a score ramp by level.
- **Multi-plane waves** and drones, with enemy firing gated by level as the cabinet did.

## [0.0.3] - 2026-07-10

### Added
- **An enemy to fight.** The enemy biplane — modelled, banking, and drawn with
  distance-based detail — plus the dogfight AI that flies it and closes on you.

## [0.0.2] - 2026-07-10

### Internal
- Transcribed the cabinet's picture-ROM topology, closing the first fidelity gap.

## [0.0.1] - 2026-07-10

**Initial release** — the cockpit and the flight model. This is the foundation of the
game rather than a playable dogfight; there is no enemy yet.

### Added
- The **pot-yoke flight model** from the 1980 cabinet: bank, climb and dive with the
  original's own control response.
- First-person flight camera with a tilting horizon — fly the cockpit and the world
  rolls around you.

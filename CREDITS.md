# Credits

The code is under the MIT licence (`LICENSE`). This file lists where the art
came from. Art not listed under a third party below is the project's own and
falls under the same MIT licence.

## Third-party art (CC0, public domain)

| What ships in the game | Source | Author | Licence |
|---|---|---|---|
| `renderer/assets/tiles/tile_*.png` (dungeon tiles, hero, items, weapons); also `road_*.png`, derived from `tile_0042` | [Tiny Dungeon](https://kenney.nl/assets/tiny-dungeon) 1.0, kept in `assets/kenney_tiny-dungeon/` | Kenney ([kenney.nl](https://www.kenney.nl)) | CC0 1.0 |
| `renderer/assets/tiles/ow_*.png` except `ow_mtn_*` (the open-map tiles), cut by `tools/static-overworld/extract-tiles.mjs` | [Tiny Town](https://kenney.nl/assets/tiny-town) and [Roguelike/RPG Pack](https://kenney.nl/assets/roguelike-rpg-pack) | Kenney | CC0 1.0 |
| `renderer/assets/tiles/npc_*.png`, `creature_dragon.png`, cut by `tools/extract-npc-sprites.mjs` | [Tiny Creatures](https://clintbellanger.net) 1.0, kept in `assets/tiny-creatures/` | Clint Bellanger | CC0 1.0 |
| `renderer/assets/monsters/manticore-parts.png` | [DnD Manticore](https://commons.wikimedia.org/wiki/File:DnD_Manticore.png), Wikimedia Commons | LadyofHats | CC0 1.0 |

The monster cutter's test images are credited in
`tools/monster-cutter/fixtures/CREDITS.md`; all of them are CC0.

## AI-generated art

These concept sheets are AI-generated. All but the wolf carry OpenAI's C2PA
provenance metadata; the wolf's source was a re-saved JPEG, which strips it.
AI-generated images may not be protected by copyright at all; whatever rights
the project holds in them are offered under the MIT licence.

| What ships in the game | Source sheet |
|---|---|
| `renderer/assets/monsters/serpent.png` (the Näkki) | `assets/serpent.png` |
| `renderer/assets/monsters/wraith.png` (the Sammunut) | `assets/wraith.png` |
| `renderer/assets/monsters/ogre-parts.png` | `assets/cuts/ogre.png` |
| `renderer/assets/npcs/wolf.png` | `assets/wolf.png` |
| `renderer/assets/tiles/ow_mtn_*.png` (Mountain Pass and Wadi Canyon mountains), built by `tools/extract-mountain-tiles.mjs` | `assets/mountainpass2.png` (`assets/mountain pass.png` is the first, unused sheet) |

## The project's own art (MIT)

- `renderer/assets/monsters/monsteri-parts.png` comes from a crayon drawing
  (`assets/cuts/monsteri.png`), and `renderer/assets/tiles/weapon_maunonmiekka.png`
  was pixelized from a hand drawing. Both drawings were supplied by the project
  owner, and their authors agreed to release them under the MIT licence.
- Sprites drawn by the project's scripts: items, props and floors
  (`tools/npc-placeholders.mjs`), bows, wands and ammo (`tools/make-ranged-tiles.mjs`,
  `make-firewand-tile.mjs`, `make-ukonvasara-tile.mjs`), the dragon boss sheet
  (`tools/bake-dragon-parts.mjs`), and the app icons `renderer/assets/icon-*.png`.
- `custom_moss_floor_*.png` were drawn in the in-game tile editor.

## Sound and type

Every sound is synthesized at runtime with the Web Audio API (`renderer/render/audio.js`);
there are no recordings. Text uses the system monospace font.

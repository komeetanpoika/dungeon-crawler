# Credits

The code is under the MIT licence (`LICENSE`). This file lists where the art
came from. Art not listed under a third party below is the project's own and
falls under the same MIT licence.

## Third-party art (CC0, public domain)

| What ships in the game | Source | Author | Licence |
|---|---|---|---|
| `renderer/assets/tiles/tile_*.png` (dungeon tiles, hero, items, weapons); also `road_*.png`, derived from `tile_0042` | [Tiny Dungeon](https://kenney.nl/assets/tiny-dungeon) 1.0, kept in `assets/kenney_tiny-dungeon/` | Kenney ([kenney.nl](https://www.kenney.nl)) | CC0 1.0 |
| `renderer/assets/tiles/ow_*.png` (the open-map tiles) except `ow_mtn_*` and the Kalevanlinna tiles the project draws (below), cut by `tools/static-overworld/extract-tiles.mjs`; among them the city's anvil, forge, produce crates and wall turret (`ow_prop_city_anvil`, `ow_city_forge`, `ow_prop_city_produce_*`, `ow_city_wall_turret`) | [Tiny Town](https://kenney.nl/assets/tiny-town) and [Roguelike/RPG Pack](https://kenney.nl/assets/roguelike-rpg-pack) | Kenney | CC0 1.0 |
| `renderer/assets/tiles/in_*.png` (house interiors), cut by `tools/interiors/extract-tiles.mjs`; the few pieces drawn there from pixel maps (cobwebs, the puzzle mirrors and sun-seed, the alcove, the doormat) are the project's own | [Roguelike/RPG Pack](https://kenney.nl/assets/roguelike-rpg-pack) | Kenney | CC0 1.0 |
| `renderer/assets/tiles/npc_*.png`, `creature_dragon.png`, cut by `tools/extract-npc-sprites.mjs`; Kalevanlinna's horse `tf_horse_*.png` (tile 51), cut by `tools/city/make-townsfolk.mjs` | [Tiny Creatures](https://clintbellanger.net) 1.0, kept in `assets/tiny-creatures/` | Clint Bellanger | CC0 1.0 |
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
  (`tools/bake-dragon-parts.mjs`), the Wilds' bridge decks `ow_pier_deck_*.png`, the
  planked fillets in the corners of their steps `ow_prop_fillet_*.png` and
  its paths over sand `ow_path_sand_*.png`, which are Tiny Town's dirt tiles repainted
  (`tools/make-wilds-path-tiles.mjs`), the Wilds' shores `ow_*_k_*.png` and
  `ow_bank_*.png`, which are Tiny Town's pond rim redrawn along a slant and round
  the corners it has no tile for (`tools/make-wilds-shore-tiles.mjs`), and the app icons
  `renderer/assets/icon-*.png`.
- Kalevanlinna, the walled city: its tiles `ow_city_*.png`, `ow_prop_city_*.png` and
  `ow_deco_city_*.png` (all but those cut from the Kenney packs, named above) and
  the sprites drawn over the town `fx_city_*.png` (smoke, steam, sparks, birds in
  flight, the cart, the crier's bell, the busker's notes, turnip splats), drawn by
  `tools/city/make-city-tiles.mjs` and its modules `fort.mjs`, `town.mjs`, `street.mjs`
  and `fx.mjs`; some are built on Tiny Town's brick, red roof, door and windows and
  the RPG pack's stall (CC0), recoloured and redrawn. Its people and town animals
  `tf_*.png` (all but the horse, above) are drawn by `tools/city/make-townsfolk.mjs`
  in the manner of Tiny Dungeon's people and Tiny Creatures' animals.
- `custom_moss_floor_*.png` were drawn in the in-game tile editor.

## Sound and type

Every sound is synthesized at runtime with the Web Audio API (`renderer/render/audio.js`);
there are no recordings. Text uses the system monospace font.

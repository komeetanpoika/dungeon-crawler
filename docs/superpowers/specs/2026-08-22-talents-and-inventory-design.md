# Talents & Inventory — Design

**Date:** 2026-08-22
**Status:** Approved design, pending implementation plan

## Summary

Ranged and magic stances stop being innate: they become **talents** — learned
abilities unlocked through events in the world. Melee stays innate (though still
weaponless until a weapon is found). A third launch talent, **Might**, gates the
use of heavy weapons. To support carrying weapons you cannot yet wield, the
player's existing pouch grows into a full **loot sack**: a slot-capped,
stacking inventory with a pause-overlay panel, holding weapons, potions, keys,
and mushrooms.

**Delivery order:** Phase 1 — inventory (sack, panel UI, pickup rework);
Phase 2 — talents (registry, gates, rites, boss/clear grants, heavy-weapon
rule on top of the sack). Inventory first because the heavy-weapons talent
needs somewhere for an unusable weapon to live.

## 1. Talent system

New pure module `renderer/systems/talents.js` (no game.js imports).

### Registry

```js
export const TALENTS = {
  ranged_stance: { name: 'Marksmanship', desc: 'Use bows and wands in the ranged stance.' },
  magic_stance:  { name: 'Gust of Wind', desc: 'Channel mana in the magic stance.' },
  heavy_weapons: { name: 'Might',        desc: 'Wield heavy weapons.' },
}
```

Future talents (e.g. `shield_use`) are additional registry rows; no structural
change needed.

### API

- `hasTalent(player, id)` — checks `player.talents` (initialized empty by
  `makePlayer`).
- `grantTalent(state, id)` — idempotent. Adds to `player.talents`, fires a
  celebration (thought bubble + short HUD flash: *"Talent learned — Gust of
  Wind!"*), returns whether the talent was newly learned so callers can
  persist. Every grant source — rite, dungeon clear, boss kill, future NPC
  dialogue — funnels through this one function.

### Behavior when a talent is missing

- **Stance cycling (Shift / touch stance button) skips locked stances.** With
  nothing learned, Shift does nothing except a throttled *"I know no other ways
  to fight."* bubble. Learn Marksmanship → melee↔ranged. Learn Gust of Wind →
  full three-way cycle.
- **Magic is no longer innate.** `tryGust` gains a `not_learned` refusal reason
  ahead of the mana check; `tryFire` likewise. In practice unreachable once
  cycling skips locked stances, but the gates keep the systems safe standalone
  and are asserted by tests.
- **No spoilers in the HUD.** The ranged and magic HUD slots are absent until
  their talent is learned — no lock icons, no teaser text. The slot appears for
  the first time at the moment of learning.
- Existing behavior stays: melee is innate but swinging still requires a weapon
  in hand.

### Grant sources at launch

| Talent | Adventure | Dungeon Rush |
|---|---|---|
| Marksmanship (ranged) | Dungeon-clear reward on the first overworld map *(interim; may later become a rite)* | Depth-1 boss kill |
| Gust of Wind (magic) | **Mushroom-circle rite** on the first overworld map (§2) | Depth-2 boss kill |
| Might (heavy weapons) | Boss kill deeper in the map chain *(interim; may later become a rite)* | Depth-3 boss kill |

Dungeon/boss rewards are declared in map data as `talentReward: '<id>'` and
fire when the dungeon is marked cleared (existing `markCleared` flow). The
Dungeon Rush ladder is a small table mapping rush depth → talent, applied when
the boss dies and drops its key.

## 2. Rites — ambiguous world triggers

Talent unlocks in the world are **rites**: secret ceremonies the player
discovers through observation and experimentation. **No prompts, no hints, no
HUD breadcrumbs** — the world itself is the clue.

Map data marks a trigger tile:

```js
{ kind: 'talent_trigger', x, y, talent: 'magic_stance', rite: 'mushroom_circle' }
```

Each named rite is a small coded condition + ceremony. The pattern supports any
future ceremony (new rite id + condition + animation); nothing ties rites to
dungeons or any generic puzzle framework.

### First rite: the mushroom circle (magic, first overworld map)

- The trigger tile sits at the center of the existing mushroom circle on the
  first overworld map.
- Scattered in the world: **color-shifting mushrooms** — hue slowly cycling,
  visually distinct from ordinary mushrooms. Walk onto one to pick it up
  (stackable inventory item, 🍄).
- **Eating one** (from the inventory panel) starts a **trance**: a hidden
  ~60-second timer with a faint screen wobble — the player senses something
  changed, but no text explains it. Trance state is not saved; quitting
  mid-trance loses it.
- **Walking into the circle center while tranced** triggers the rite: the
  screen goes blurry and swervy (sinusoidal canvas offset + blur ramp over a
  few seconds), the character takes a sickly greenish tint, controls lock
  briefly — then it clears and the magic stance is learned, its HUD slot
  appearing for the first time.
- Walking in un-tranced: nothing happens. Eating a mushroom far from the
  circle: the trance wears off, mushroom wasted.

### Editor support

The tile editor palette gains `talent_trigger` (talent + rite dropdowns) and
the pickable color-shifting mushroom object. `buildEntities` learns the new
kinds (game.js switch + arena allowlist — unknown kinds are silently dropped
today, so both lists must be updated).

## 3. Inventory — the loot sack

New pure module `renderer/systems/inventory.js`.

- **Item shape:** `{ kind, name, emoji, stackable, count, ...payload }`.
  Weapons carry their existing stat payloads, plus `heavy: true` on big
  weapons. Stackable kinds at launch: potions, keys, mushrooms (one slot each,
  `count` grows). Gems and future stackables join the registry when they
  exist.
- **Slot cap:** base **10** + one per `extra_slot` meta bonus (replaces
  today's 5 + extras; the sack now holds weapons too). A full sack refuses
  pickups: the item stays on the ground with *"My pack is full."* — nothing is
  silently lost.
- **Equipping:** `player.weapon` and `player.ranged` remain the equipped
  references — combat code untouched. Equipped items live in those slots, not
  in the sack. Picking up a weapon auto-equips only if the matching hand is
  empty *and* the player may use it; otherwise it goes into the sack.
  Equipping from the panel swaps: the current weapon returns to the sack.
- **Heavy gate:** equipping a `heavy` weapon without Might refuses with *"Too
  heavy — I lack the strength."* (same refusal on auto-equip). The weapon sits
  in the sack as a visible promise.
- **Dropping:** from the panel, drop to an adjacent free tile as a
  `floating_item` (reusing the chest-pop arc) so drops can be picked back up.
- **Pickup rework:** chest and floating-item pickups route through
  `inventory.add` (with stack merge) instead of overwriting
  `player.weapon`/`player.ranged`.

## 4. Inventory panel UI

- **Open:** `I` key or a new sack touch button (🎒). Pauses the game, opens an
  overlay panel over the dimmed world (same pattern as the pause menu). `I` or
  `Esc` closes and resumes.
- **Layout:** two equip slots on top — melee hand and ranged hand, the ranged
  slot rendered only once Marksmanship is learned (no-spoilers rule) — then
  the sack as a slot grid. Stackables show a count badge (🗝 ×3). The selected
  item shows a detail line: name, damage/effect, and any refusal reason
  (*"Too heavy — requires Might"*).
- **Controls:** arrow keys + Enter, mouse click, and tap — desktop, web, and
  touch all supported. Contextual actions per kind: **Equip/Unequip**
  (weapons), **Drink** (potion), **Eat** (mushroom — where the trance begins),
  **Drop** (anything).
- **Style:** matches the existing HUD/menu treatment. The HUD emoji strip
  stays as the at-a-glance summary; the panel is the interaction surface.
- Consuming an item closes the panel so the effect is seen landing on the
  character.

## 5. Persistence

- **Adventure save v3** (`normalizeAdventureSave` migration v2 → v3):

  ```js
  { caves, progress, talents: [], body: { weapon, ranged, inventory } }
  ```

  Additive migration — old saves load with empty talents and a fresh body.
  Saves are written on talent grant, on inventory changes (pickup / drop /
  equip / consume), and at the existing map-transition save points.
- **Talents always persist** in Adventure — across death, app restarts, and in
  the web release via the existing localStorage-backed `saveAPI` shim
  (`renderer/web-shim.js`). Items persist the same way for now (see future
  tasks for death-drop).
- **Dungeon Rush:** `player.talents` starts empty each run, granted by the
  boss ladder, never saved. Meta-milestone system untouched.
- **Arena/dev:** arena config can pre-grant talents
  (`talents: ['magic_stance']`) so combat testing needn't earn them.
- **Trance is never saved.**

## 6. Testing

- **New `node:test` files:**
  - `talents.test.js` — registry integrity, idempotent grant, stance-cycle
    skipping, `not_learned` gate reasons, rush boss ladder.
  - `inventory.test.js` — stacking, cap refusal, equip/swap, heavy-weapon
    refusal, drop.
  - Rites logic — trance timer countdown, mushroom-circle trigger condition as
    a pure check.
- **Updated tests:** `magic.test.js`, `ranged.test.js` (new gates),
  `hud.test.js` (locked slots hidden), adventure save migration v2 → v3.
- **Runtime checks, time-boxed:** short arena-test run for trance/rite visuals
  and the panel; one editor session verifying `talent_trigger`/mushroom
  placement (restore `renderer/data/` git status afterward — editor autosave
  hazard).

## Future tasks (noted, not in this build)

- **Death drop & retrieval:** on death, the character's items drop where they
  fell and must be retrieved; talents are never lost. (For now, death keeps
  items.)
- **Consumable quick-slot:** equip a consumable for one-press field use
  without opening the inventory panel.
- **Rites for ranged and heavy:** upgrade the interim dungeon-clear / boss-kill
  sources to bespoke rites.
- **Shield:** `shield_use` talent + shield equipment, building on the heavy
  gate and equip-slot patterns.
- **NPC dialogue as a grant source:** NPCs call `grantTalent` like any other
  source.
- **Gems:** stackable treasure item.

## Explicitly out of scope

- No generic puzzle/`group` framework (gargoyle fountains etc.) — rites are
  bespoke by design.
- No changes to loot tables beyond routing pickups through the sack.
- No cross-device save sync (localStorage is per-browser).

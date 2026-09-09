# Coldhearth Marsh — dusk fires (hermit episode rework)

Reworks §3.3 of `2026-08-29-leap-episodes-design.md`. The player no longer
lights the hermit's own hearth; the village does the lighting and the player
supplies the wood.

## The beats

1. **Dusk.** The episode's clock starts in the late afternoon (`ARRIVAL_CLOCK`,
   0.58 of the day) so the first dusk is under a minute away. From dusk
   (0.70) to dawn (0.20) every cold village hearth (`hearth 1..3` POIs)
   without a fire gets the nearest free villager or elder, who walks to a
   walkable cell beside it (`standSpot`, orthogonal first, untried cells on a
   give-up) and lights an ordinary **hearth fire** — `makeCampfire(x, y,
   { hearth: true })`: never burns out, but snuffable. One lighting per hearth
   per night; a villager that never gets there lights it after
   `CHORE_TIMEOUT` (20 s). At dawn the ordinary hearth fires go out and
   unfinished dusk chores are dropped.
2. **The dark.** The Sammunut drifts to the nearest fire and puts it out, as
   before; it is visible only in firelight. A hearth fire vanishing at night
   within `SNUFF_SEEN_RANGE` (12 tiles) of the player sets `seen_snuff` once
   and the player thinks "It ate the fire."
3. **Grey wood.** Standing beside a villager or elder with three `deadwood`
   in the sack hands it over (one hearth per handover, `DELIVERY_COOLDOWN`
   2 s apart). The villager says a take line, walks to the first cold hearth
   and lights it **blue** — an eternal deadwood fire on the hearth cell,
   replacing any ordinary fire. Flags `wood_1..3`; an ordinary chore for a
   hearth that has gone blue is dropped. Blue fires re-derive from the flags
   on every arrival.
4. **Doom.** With all three blue (`allBlue`) the wraith is stamped `doomed`
   (`systems/monsters/sammunut.js`): no shun, no flee — it drifts into the
   village light, burns at `BURN_DPS`, and dies. The kill still resolves
   the episode through `wraith_dead` (`rule` unchanged); the hearth props
   switch to `prop_hearth_lit`, the blue fires stay.

Flags: `arrived`, `sammunut_spawned`, `seen_snuff`, `wood_1..3`,
`wraith_dead`. `hearth_lit` is no longer set or read.

## Art

- `deadwood` drops draw `item_deadwood` in the world (they were a `?`);
  the icon is the lumber log recoloured cold blue-grey
  (`tools/npc-placeholders.mjs`).
- A deadwood campfire draws with a blue hue filter and its night glow is
  blue (`render/canvas.js`, `render/weather.js`).

## Echo and villagers

`ruleCtx` now carries `night`, so an echo line can differ in the dark. Lines
stay vague observations. Villagers keep the persona lines; the elder hints
at the grey wood; resolved lines for hermit, villager and elder.

## Shared fix

`act.js` path smoothing checked tile-centre line of sight; a walker whose
body straddled a tile edge beside the 2-tall well "saw" the next waypoint,
clipped the well on the diagonal and deadlocked. Smoothing now samples the
body along the real pixel segment (`segmentWalkable`).

// What a registry monster leaves where it dies. A def with
// behavior.drops 'chest' (the antlion: what its earlier visitors carried)
// leaves one chest's roll, at the loot depth it was built with
// (game.js buildEntities stamps `lootDepth`), once. Pure: the roll is passed in.
export function deathDrop(e, def, rollLoot) {
  if (!e || e.dropped || !(e.hp <= 0) || def?.behavior?.drops !== 'chest') return null
  e.dropped = true
  return { kind: 'floating_pickup', contents: rollLoot(e.lootDepth ?? 1), x: e.x, y: e.y }
}

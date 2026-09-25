// Every PvP tuning number (spec 2026-09-25-pvp-multi-hero-core-design.md).
// Sub-project 2 balances these; nothing else in renderer/pvp/ hard-codes one.
export const PVP = {
  tick: 1 / 30,          // s — the fixed simulation step (the server will run the same)
  maxFrame: 0.25,        // s — a longer frame is clamped, so a hitch never fast-forwards the match
  matchLength: 240,      // s
  respawnDelay: 3,       // s dead before respawning
  spawnProtect: 1.5,     // s untargetable after a respawn; attacking ends it early
  creditWindow: 5,       // s — the last hero to hurt you within this gets the kill
  ccMul: 0.5,            // every stun/slow/root on a hero lasts this fraction
  hp: 10,
  arrowSpeed: 280,       // px/s, as game.js PROJECTILE_SPEED
  blinkTrailDur: 0.2,    // s, as canvas.js BLINK_DUR
  localBots: 3,
}

export const CLASSES = ['warrior', 'archer', 'mage']

// One outfit per kit, so one loadout per life. `loadout` is applyLoadout's shape.
export const KITS = {
  warrior: { stance: 'melee',  loadout: { weaponType: 'sword', outfits: ['plate'], offhand: { type: 'shield', weaponType: 'buckler' } } },
  archer:  { stance: 'ranged', loadout: { rangedType: 'shortbow', outfits: ['ranger'], ammo: { arrow: 24 } } },
  mage:    { stance: 'magic',  loadout: { wandType: 'sparkwand', outfits: ['robe'], offhand: { type: 'wand', weaponType: 'blinkwand' } } },
}

// Plate's protect 2 would make every 1-2 damage weapon near-useless on the
// Warrior; in a match it is 1. Single-player's OUTFIT_TYPES stays as it is.
export const OUTFIT_OVERRIDES = { plate: { protect: 1 } }

export const PICKUPS = {
  flask:  { heal: 4, respawn: 20 },
  quiver: { arrows: 12, respawn: 15 },
  rune:   { firstSpawn: 45, respawn: 60, duration: 30 },
}

// What the rune turns each class's main hand into, for its duration.
export const RUNE_POWER = {
  warrior: { weaponType: 'ukonvasara' },
  archer:  { rangedType: 'crossbow', bolts: 10 },
  mage:    { wandType: 'stormwand' },
}

// Bot AI tuning (renderer/pvp/bots.js). Geometry constants (TILE, STEPS) stay
// local to bots.js; these are the numbers that shape bot behaviour.
export const BOTS = {
  meleeRange: 1.3,  // tiles — a warrior bot faces and swings once a foe is this close
  shootRange: 9,     // tiles — an archer/mage bot will line up and fire out to this range
  keepAway: 3,       // tiles — the distance a caster/archer bot tries to hold from its foe
  alignSlack: 10,    // px — off-axis slop still counted as "lined up" on a row/column
  hurt: 0.4,         // hp fraction — below this, a bot breaks off to head for a flask
}

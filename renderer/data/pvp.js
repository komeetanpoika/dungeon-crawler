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
  hp: 8,                 // 2a: fights end sooner (a sword kills anyone in 4)
  arrowSpeed: 280,       // px/s, as game.js PROJECTILE_SPEED
  blinkTrailDur: 0.2,    // s, as canvas.js BLINK_DUR
  localBots: 3,
  minHeroes: 2,   // the match clock runs only with at least this many heroes
}

export const CLASSES = ['warrior', 'archer', 'mage']

// One outfit per kit, so one loadout per life. `loadout` is applyLoadout's shape.
export const KITS = {
  warrior: { stance: 'melee',  loadout: { weaponType: 'sword', outfits: ['plate'], offhand: { type: 'shield', weaponType: 'buckler' } } },
  archer:  { stance: 'ranged', loadout: { rangedType: 'shortbow', outfits: ['ranger'], ammo: { arrow: 24 } } },
  mage:    { stance: 'magic',  loadout: { wandType: 'stormwand', outfits: ['robe'], offhand: { type: 'wand', weaponType: 'blinkwand' } } },
}

// Plate's protect 2 would make every 1-2 damage weapon near-useless on the
// Warrior; in a match it is 0 (2a: the buckler is the Warrior's defence).
// Single-player's OUTFIT_TYPES stays as it is.
export const OUTFIT_OVERRIDES = { plate: { protect: 0 } }

export const PICKUPS = {
  flask:  { heal: 4, respawn: 20 },
  quiver: { arrows: 12, respawn: 15 },
  rune:   { firstSpawn: 45, respawn: 60, duration: 30 },
}

// What the rune turns each class's main hand into, for its duration.
export const RUNE_POWER = {
  warrior: { weaponType: 'ukonvasara' },
  archer:  { rangedType: 'crossbow', bolts: 10 },
  mage:    { wandType: 'firewand' },
}

// Bot AI tuning (renderer/pvp/bots.js). Geometry constants (TILE, STEPS) stay
// local to bots.js; these are the numbers that shape bot behaviour.
export const BOTS = {
  meleeRange: 1.3,  // tiles — a warrior bot faces and swings once a foe is this close
  shootRange: 9,     // tiles — an archer/mage bot will line up and fire out to this range
  keepAway: 3,       // tiles — the distance a caster/archer bot tries to hold from its foe
  alignSlack: 10,    // px — off-axis slop still counted as "lined up" on a row/column
  hurt: 0.4,         // hp fraction — below this, a bot breaks off to head for a flask
  // 2a signature moves
  lungeMin: 2,       // tiles — a warrior bot lunges at a foe lined up this far…
  lungeMax: 3,       // …to this far
  whirlRange: 1.5,   // tiles — foes this close count toward a whirlwind…
  whirlFoes: 2,      // …and it whirls (with a full tank) at this many
  doubleMin: 5,      // tiles — an archer bot draws the double shot at a lined-up foe this far or further
}

// Sub-project 2a (spec 2026-09-26-pvp-2a-class-rework-design.md) — each
// class's signature move.

// The Warrior's gesture combos: moves entered with the stick while the attack
// is held, fired on release (renderer/pvp/combos.js recognises them, hero.js
// runs the hold, attacks.js the effects). px unless named otherwise.
export const WARRIOR_COMBOS = {
  weapon: 'sword',     // the one combo weapon; the rune's hammer keeps its own charge tiers
  holdMoveMul: 0.5,    // walk speed while the attack is held, along lockDir
  moveCost: 25,        // stamina per recorded move (STAMINA_MAX is 100)
  maxMoves: 4,         // later moves are ignored, and free
  fxDur: 0.35,         // s a combo effect (hero.move) lives: the dash, the thrusts, and what is drawn
  lunge: { tiles: 2.5, dur: 0.15, reach: 20, damage: 3 },
  fence: { times: [0, 0.12, 0.24], reach: 40, damage: 1 },   // each thrust a snap-style wedge
  whirl: { reach: 44, damage: 2, knockback: 40, cooldownMul: 1.5 },
}

// The Archer's double shot on Q: a draw of `full` s; below `min` of it a
// release fires nothing. Two arrows `gap` px apart across the facing, each
// dealing its band's damage (bands by draw fraction, highest first), trails
// tinted white → gold.
export const DOUBLE_SHOT = {
  full: 1.2, min: 0.3, moveMul: 0.6, gap: 12, cooldown: 0.8,
  bands: [
    { from: 0.85, damage: 5, color: '#facc15' },
    { from: 0.70, damage: 4, color: '#fcd34d' },
    { from: 0.55, damage: 3, color: '#fde68a' },
    { from: 0.40, damage: 2, color: '#fef3c7' },
    { from: 0.30, damage: 1, color: '#ffffff' },
  ],
}
export const drawFrac = t => Math.min(Math.max(t, 0) / DOUBLE_SHOT.full, 1)
// The band a draw fraction falls in, or null below DOUBLE_SHOT.min.
export const doubleShotBand = frac => DOUBLE_SHOT.bands.find(b => frac >= b.from - 1e-9) ?? null

// PvP numbers for shared spells, passed to tryCast as its `override`
// (single-player's SPELLS rows stay as they are). The fireball's `burst` is
// read by the sim's detonate hook.
export const SPELL_OVERRIDES = {
  lightning: { cooldown: 1.5, delay: 0.4, damage: 3, stun: 0.6 },
  fireball: { burst: 2 },
}

// The class picker's line under each class button.
export const CLASS_HINTS = {
  warrior: 'Hold attack + stick: combos',
  archer: 'Hold Q: double shot',
  mage: 'Storm Wand · Q: blink',
}

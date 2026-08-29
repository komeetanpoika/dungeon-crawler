// Friendly-creature species (data, not code). Consumed by systems/npc.js.
//   faction     'village' shares wrath: hurt one, every fight-capable villager on
//               the map turns hostile. 'wild' animals are each for themselves.
//   onHit       'fight' -> hostile; 'flee' -> timed flee.
//   fleeHp      hp fraction at/below which flee_hurt may take over (1 = any hit).
//   roam        tiles from the home tile that wander may pick points in.
//   startle     px radius at which a wild animal bolts even if untouched.
//   react       what the interact button does to an animal (villagers speak).
//   walker      draw through drawWalker + tickWalk (humanoids).
//   hostile     true = hostile on sight: spawns as an enemy (wolf, bear).
//   weapon      enemy-attack.js WEAPONS id used once hostile (npc default: fists).
//   drop        chance an animal leaves meat when it dies (villagers: none).
//   priorities  ordered goal names; first goal whose `when` holds runs.
export const NPC_SPECIES = {
  villager: {
    faction: 'village', sprite: 'npc_villager', walker: true,
    hp: 3, onHit: 'fight', fleeHp: 0.3,
    speed: 70, wanderSpeed: 40, roam: 6,
    priorities: ['flee_hurt', 'attack_hostile', 'go_to', 'wander'],
    lines: ['Fine weather for it.', 'Mind the caves, stranger.', 'Aspengrove keeps to itself.', 'Lost something? Check the caches.'],
  },
  elder: {
    faction: 'village', sprite: 'npc_elder', walker: true,
    hp: 2, onHit: 'flee', fleeHp: 1,
    speed: 50, wanderSpeed: 25, roam: 3,
    priorities: ['flee_hurt', 'go_to', 'wander'],
    lines: ['These woods were older than the village once.', 'Rest a while, traveller.', 'The mushrooms hum at dusk.'],
  },
  // Livestock: village faction, so hurting them provokes the villagers.
  sheep: {
    faction: 'village', sprite: 'npc_sheep',
    hp: 2, onHit: 'flee', fleeHp: 1, startle: 40, react: 'hop', drop: 0.6,
    speed: 70, wanderSpeed: 20, roam: 4,
    priorities: ['flee_hurt', 'startle', 'go_to', 'wander'],
  },
  goat: {
    faction: 'village', sprite: 'npc_goat',
    hp: 2, onHit: 'flee', fleeHp: 1, startle: 40, react: 'hop', drop: 0.6,
    speed: 85, wanderSpeed: 30, roam: 5,
    priorities: ['flee_hurt', 'startle', 'go_to', 'wander'],
  },
  chicken: {
    faction: 'wild', sprite: 'npc_chicken',
    hp: 1, onHit: 'flee', fleeHp: 1, startle: 48, react: 'hop', drop: 0.5,
    speed: 90, wanderSpeed: 30, roam: 3,
    priorities: ['flee_hurt', 'startle', 'go_to', 'wander'],
  },
  deer: {
    faction: 'wild', sprite: 'npc_deer',
    hp: 2, onHit: 'flee', fleeHp: 1, startle: 96, react: 'bolt', drop: 0.7,
    speed: 130, wanderSpeed: 35, roam: 8,
    priorities: ['flee_hurt', 'startle', 'go_to', 'wander'],
  },
  mouse: {
    faction: 'wild', sprite: 'npc_mouse',
    hp: 1, onHit: 'flee', fleeHp: 1, startle: 40, react: 'scurry', drop: 0.2,
    speed: 110, wanderSpeed: 40, roam: 4,
    priorities: ['flee_hurt', 'startle', 'go_to', 'wander'],
  },
  // Peaceful until struck, then it turns on you (only that boar).
  boar: {
    faction: 'wild', sprite: 'npc_boar', weapon: 'claw',
    hp: 4, onHit: 'fight', fleeHp: 0, drop: 0.8,
    speed: 95, wanderSpeed: 30, roam: 5,
    priorities: ['flee_hurt', 'attack_hostile', 'go_to', 'wander'],
  },
  // Hostile on sight: the enemy brain runs from the first frame.
  wolf: {
    faction: 'wild', sprite: 'npc_wolf', hostile: true, weapon: 'claw',
    hp: 3, onHit: 'fight', fleeHp: 0.25, drop: 0.4,
    speed: 110, wanderSpeed: 40, roam: 7,
    priorities: ['flee_hurt', 'attack_hostile', 'go_to', 'wander'],
  },
  bear: {
    faction: 'wild', sprite: 'npc_bear', hostile: true, weapon: 'maul',
    hp: 6, onHit: 'fight', fleeHp: 0, drop: 1,
    speed: 60, wanderSpeed: 25, roam: 6,
    priorities: ['flee_hurt', 'attack_hostile', 'go_to', 'wander'],
  },
}

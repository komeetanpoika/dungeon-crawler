const SPRITES = {
  // tiles
  floor:        'tile_0000',
  floor_wood:   'tile_0075',
  wall:         'tile_0040',
  door:         'tile_0021',
  stairs_dn:    'tile_0056',
  stairs_up:    'tile_0057',
  treasure:     'tile_0063',
  shrine:       'tile_0064',
  column:       'tile_0077',
  // characters
  dragon:       'creature_dragon',
  player:       'tile_0084',
  guard:        'tile_0085',
  guard_alert:  'tile_0087',
  monster_weak:   'tile_0120',
  monster_medium: 'tile_0121',
  monster_strong: 'tile_0122',
  monster_boss:   'tile_0123',
  trap:         'tile_0073',
  puzzle:       'tile_0072',
  // items
  weapon_dagger:    'tile_0103',
  weapon_sword:     'tile_0104',
  weapon_longsword: 'tile_0106',
  weapon_axe:       'tile_0118',
  potion:           'tile_0116',
  // door animation frames (0 = closed … 3 = open)
  door_0: 'tile_0009',
  door_1: 'tile_0021',
  door_2: 'tile_0033',
  door_3: 'tile_0045',
  // chest animation frames (0 = closed … 4 = open)
  chest_0: 'tile_0089',
  chest_1: 'tile_0090',
  chest_2: 'tile_0091',
  chest_3: 'tile_0092',
  chest_4: 'tile_0093',
}

export async function loadSprites() {
  const loaded = {}
  await Promise.all(
    Object.entries(SPRITES).map(([key, name]) => new Promise(resolve => {
      const img = new Image()
      img.onload = () => { loaded[key] = img; resolve() }
      img.onerror = () => { console.warn(`Missing sprite: ${name}`); resolve() }
      img.src = `./assets/tiles/${name}.png`
    }))
  )
  return loaded
}

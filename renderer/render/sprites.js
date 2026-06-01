export const SPRITES = {
  // tiles
  floor:        'tile_0000',
  floor_wood:   'tile_0075',
  wall:         'tile_0040',
  door:         'tile_0021',
  stairs_dn:    'tile_0056',
  stairs_up:    'tile_0057',
  treasure:     'tile_0063',
  shrine:       'tile_0064',
  column:       'tile_0075',  // crate — no pillar exists in tileset
  // characters
  dragon:       'creature_dragon',
  player:       'tile_0084',
  guard:        'tile_0085',
  guard_alert:  'tile_0087',
  monster_weak:   'tile_0120',
  monster_medium: 'tile_0121',
  monster_strong: 'tile_0122',
  monster_boss:   'tile_0123',
  cyclops:      'tile_0109',
  wizard:       'tile_0111',
  crab:         'tile_0110',
  // floor variants
  sand:                'tile_0048',
  // props — civilisation gradient
  prop_table:          'tile_0072',
  prop_chair:          'tile_0073',
  prop_anvil:          'tile_0074',
  prop_barrel:         'tile_0082',
  prop_pipe_dry:       'tile_0007',
  prop_pipe_flow:      'tile_0008',
  prop_gargoyle_dry:   'tile_0019',
  prop_gargoyle_flow:  'tile_0020',
  prop_fountain_empty: 'tile_0031',
  prop_fountain_full:  'tile_0032',
  prop_gravestone:     'tile_0065',
  prop_grave:          'tile_0066',
  prop_drain_empty:    'tile_0043',
  prop_drain_liquid:   'tile_0044',
  // staircase passages
  stair:       'tile_0039',
  stair_left:  'tile_0036',
  stair_mid:   'tile_0037',
  stair_right: 'tile_0038',
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
  // chest animation frames (0 = closed, 1 = half-open, 2 = fully open)
  chest_0: 'tile_0089',
  chest_1: 'tile_0090',
  chest_2: 'tile_0091',
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

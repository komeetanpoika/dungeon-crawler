// Readable signposts per open map. Where the map art already bakes an
// ow_sign prop (Aspengrove) the entry sits on it; elsewhere buildOpenMap
// stamps the sign overlay onto the tile and makes it solid. The sign art is
// the only in-world clue; F beside one opens the panel (systems/signs.js
// finds it, ui/sign-panel.js shows it).
export const MAP_SIGNS = {
  'forest-1-clearings': [
    {
      x: 32, y: 31,
      title: 'Aspengrove',
      lines: [
        'East, beyond the pines — the forest shrine.',
        'Southeast — the mushroom ring. Eat nothing you find there.',
        'The caves below are no place for the unarmed.',
      ],
    },
  ],
  'sea-2-fishing-village': [
    {
      x: 65, y: 37,
      title: 'Seagrave',
      lines: [
        'Fish fresh daily, sailors’ tales free of charge.',
        'Southeast lies the sea cave. Mind the tide.',
      ],
    },
  ],
}

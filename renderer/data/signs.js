// Readable signposts per open map, keyed to the baked ow_sign prop tiles.
// The sign art is the only in-world clue; F beside one opens the panel
// (systems/signs.js finds it, ui/sign-panel.js shows it).
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
}

// The three tribes of the Wilds (data, not code). Consumed by
// systems/tribes.js (membership, peace and wrath, speech), systems/trade.js
// (the vendor's wares) and wilds/tribes-cast.js (where they are dealt).
//
// A tribe's members are registry monsters whose def carries
// behavior.tribe (a key below) and behavior.role.
//
//   nature   'hostile'  its members are enemies from the first frame
//            'friendly' its members are peaceful until one is struck; then
//                       the whole tribe holds a grudge for a while
//                       (systems/tribes.js WRATH_TIME)
//   country  the Wilds country it is dealt in (wilds/layout.js BIOMES)
//   lines    what a peaceful member says when the hero comes near, by
//            monster name
export const TRIBES = {
  // Vuorenpeikot, the mountain trolls: a war band heard before it is seen.
  peikot: { name: 'Vuorenpeikot', nature: 'hostile', country: 'mountain' },
  // Noitasuon akat, the coven of the witch-marsh: they rob and curse more
  // than they wound.
  noidat: { name: 'Noitasuon akat', nature: 'hostile', country: 'marsh' },
  // Norppaväki, the ringed-seal folk of the shores: a haven with a trader, a
  // singer, guards, and a walrus who fights for sport.
  norpat: {
    name: 'Norppaväki', nature: 'friendly', country: 'sea',
    lines: {
      norppakauppias: [
        'Fresh from the cold water. Step on what you fancy.',
        'We take cooked food, mushrooms and wood. We can\'t cook. Flippers.',
        'No coin, two-legs. What would a seal do with coin?',
      ],
      norppalaulaja: [
        'Sit by me if something hurts. A song mends more than you would think.',
        'Stung? Bitten? Stay close and listen.',
      ],
      norppavahti: [
        'Anything with teeth that follows you in here stays here.',
        'Mind the wares. Mind your manners.',
      ],
      mursu: [
        'Strike the gong if you want a bout, little two-legs. Nobody dies in my ring.',
        'I have sat on this rock since the ice went out. Come and move me.',
      ],
    },
    // said by the vendor when the hero steps on a ware he cannot pay for
    priceLine: (count, name) => `That one is ${count} ${name}. Bring it and it is yours.`,
    // said by the vendor while the tribe holds a grudge
    grudgeLine: 'Not to you. Not today.',
  },
}

// What the seals' trader may lay out: three of these per camp
// (wilds/tribes-cast.js picks). `contents` is a floating item's contents
// (systems/inventory.js itemFromContents); a ware with `loot` instead holds
// one chest's roll, made when it is built. `price` is paid in one kind of
// stackable sack item.
export const WARES = [
  { id: 'potion',  contents: { type: 'potion', amount: 4 },               price: { item: 'cooked_meat', count: 2 } },
  { id: 'herring', contents: { type: 'herring', count: 3 },               price: { item: 'mushroom', count: 1 } },
  { id: 'arrows',  contents: { type: 'ammo', ammoKind: 'arrow', count: 12 }, price: { item: 'lumber', count: 2 } },
  { id: 'bolts',   contents: { type: 'ammo', ammoKind: 'bolt', count: 8 },   price: { item: 'lumber', count: 3 } },
  { id: 'stones',  contents: { type: 'ammo', ammoKind: 'stone', count: 15 }, price: { item: 'lumber', count: 1 } },
  { id: 'seachest', loot: true,                                            price: { item: 'cooked_meat', count: 4 } },
]

// Every member, by tribe: the registry names the Wilds deals.
export const MEMBERS = {
  peikot: ['mohkale', 'louhija', 'rumpali', 'vuorenkuningas'],
  noidat: ['para', 'noita', 'kuppari', 'kyy', 'syojatar'],
  norpat: ['norppakauppias', 'norppalaulaja', 'norppavahti', 'mursu', 'kumistin'],
}

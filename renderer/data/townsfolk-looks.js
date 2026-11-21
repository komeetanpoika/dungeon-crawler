// Kalevanlinna's people and town animals: their looks. Written by
// tools/city/make-townsfolk.mjs, which draws the tiles; change that and run it
// again rather than editing this. Data only.
//
// A look `id` has two tiles: tf_<id> standing and tf_<id>_step, a step. An npc
// carrying `look: id` is drawn with them (systems/npc.js spriteKeyFor).
//   age     child | adult | elder
//   sex     f | m: which first names fit
//   wear    tunic | smock | dress | blouse | coat (and the named ones' own)
//   apron   bib | waist | null;  carry: basket | bread | fish | bucket | cane | null
// The tiles are loaded with the Wilds' (wilds/terrain.js WILDS_SKINS).

export const LOOKS = [
  { id: 'a01', age: 'adult', sex: 'f', wear: 'dress', apron: 'bib', carry: 'basket' },
  { id: 'a02', age: 'adult', sex: 'm', wear: 'coat', apron: null, carry: 'fish' },
  { id: 'a03', age: 'adult', sex: 'f', wear: 'dress', apron: null, carry: null },
  { id: 'a04', age: 'adult', sex: 'm', wear: 'tunic', apron: null, carry: null },
  { id: 'a05', age: 'adult', sex: 'f', wear: 'blouse', apron: 'waist', carry: 'bread' },
  { id: 'a06', age: 'adult', sex: 'm', wear: 'smock', apron: null, carry: 'bucket' },
  { id: 'a07', age: 'adult', sex: 'f', wear: 'smock', apron: 'waist', carry: null },
  { id: 'a08', age: 'adult', sex: 'm', wear: 'tunic', apron: null, carry: 'bread' },
  { id: 'a09', age: 'adult', sex: 'f', wear: 'smock', apron: 'bib', carry: 'basket' },
  { id: 'a10', age: 'adult', sex: 'm', wear: 'tunic', apron: null, carry: null },
  { id: 'a11', age: 'adult', sex: 'f', wear: 'dress', apron: 'bib', carry: null },
  { id: 'a12', age: 'adult', sex: 'm', wear: 'smock', apron: null, carry: 'bucket' },
  { id: 'a13', age: 'adult', sex: 'f', wear: 'dress', apron: null, carry: 'fish' },
  { id: 'a14', age: 'adult', sex: 'm', wear: 'coat', apron: 'waist', carry: null },
  { id: 'a15', age: 'adult', sex: 'f', wear: 'blouse', apron: null, carry: 'fish' },
  { id: 'a16', age: 'adult', sex: 'm', wear: 'tunic', apron: 'bib', carry: 'bucket' },
  { id: 'a17', age: 'adult', sex: 'f', wear: 'smock', apron: null, carry: null },
  { id: 'a18', age: 'adult', sex: 'm', wear: 'tunic', apron: null, carry: 'bread' },
  { id: 'a19', age: 'adult', sex: 'f', wear: 'dress', apron: null, carry: 'basket' },
  { id: 'a20', age: 'adult', sex: 'm', wear: 'coat', apron: 'waist', carry: null },
  { id: 'a21', age: 'adult', sex: 'f', wear: 'dress', apron: null, carry: null },
  { id: 'a22', age: 'adult', sex: 'm', wear: 'smock', apron: null, carry: 'fish' },
  { id: 'a23', age: 'adult', sex: 'f', wear: 'blouse', apron: null, carry: 'bread' },
  { id: 'a24', age: 'adult', sex: 'm', wear: 'tunic', apron: 'waist', carry: null },
  { id: 'a25', age: 'adult', sex: 'f', wear: 'dress', apron: 'bib', carry: 'basket' },
  { id: 'a26', age: 'adult', sex: 'm', wear: 'smock', apron: 'bib', carry: null },
  { id: 'a27', age: 'adult', sex: 'f', wear: 'dress', apron: null, carry: null },
  { id: 'a28', age: 'adult', sex: 'm', wear: 'tunic', apron: null, carry: 'bucket' },
  { id: 'a29', age: 'adult', sex: 'f', wear: 'blouse', apron: 'waist', carry: null },
  { id: 'a30', age: 'adult', sex: 'm', wear: 'coat', apron: null, carry: null },
  { id: 'a31', age: 'adult', sex: 'f', wear: 'smock', apron: 'waist', carry: 'bucket' },
  { id: 'a32', age: 'adult', sex: 'm', wear: 'tunic', apron: null, carry: 'fish' },
  { id: 'a33', age: 'adult', sex: 'f', wear: 'smock', apron: null, carry: null },
  { id: 'a34', age: 'adult', sex: 'm', wear: 'coat', apron: 'bib', carry: 'bread' },
  { id: 'a35', age: 'adult', sex: 'f', wear: 'dress', apron: null, carry: 'basket' },
  { id: 'a36', age: 'adult', sex: 'm', wear: 'tunic', apron: 'waist', carry: null },
  { id: 'a37', age: 'adult', sex: 'f', wear: 'blouse', apron: null, carry: null },
  { id: 'a38', age: 'adult', sex: 'm', wear: 'smock', apron: null, carry: 'bread' },
  { id: 'a39', age: 'adult', sex: 'f', wear: 'dress', apron: 'bib', carry: 'basket' },
  { id: 'a40', age: 'adult', sex: 'm', wear: 'tunic', apron: null, carry: 'fish' },
  { id: 'c01', age: 'child', sex: 'f', wear: 'dress', apron: null, carry: null },
  { id: 'c02', age: 'child', sex: 'm', wear: 'tunic', apron: null, carry: null },
  { id: 'c03', age: 'child', sex: 'f', wear: 'dress', apron: null, carry: null },
  { id: 'c04', age: 'child', sex: 'm', wear: 'tunic', apron: null, carry: null },
  { id: 'c05', age: 'child', sex: 'f', wear: 'dress', apron: null, carry: null },
  { id: 'c06', age: 'child', sex: 'm', wear: 'tunic', apron: null, carry: null },
  { id: 'c07', age: 'child', sex: 'f', wear: 'dress', apron: null, carry: null },
  { id: 'c08', age: 'child', sex: 'm', wear: 'tunic', apron: null, carry: null },
  { id: 'c09', age: 'child', sex: 'f', wear: 'dress', apron: null, carry: null },
  { id: 'c10', age: 'child', sex: 'm', wear: 'tunic', apron: null, carry: null },
  { id: 'c11', age: 'child', sex: 'f', wear: 'dress', apron: null, carry: null },
  { id: 'c12', age: 'child', sex: 'm', wear: 'tunic', apron: null, carry: null },
  { id: 'e01', age: 'elder', sex: 'f', wear: 'dress', apron: null, carry: 'basket' },
  { id: 'e02', age: 'elder', sex: 'm', wear: 'tunic', apron: null, carry: 'cane' },
  { id: 'e03', age: 'elder', sex: 'f', wear: 'dress', apron: 'bib', carry: 'cane' },
  { id: 'e04', age: 'elder', sex: 'm', wear: 'tunic', apron: null, carry: 'basket' },
  { id: 'e05', age: 'elder', sex: 'f', wear: 'dress', apron: 'bib', carry: 'basket' },
  { id: 'e06', age: 'elder', sex: 'm', wear: 'tunic', apron: null, carry: null },
  { id: 'e07', age: 'elder', sex: 'f', wear: 'dress', apron: 'bib', carry: 'cane' },
  { id: 'e08', age: 'elder', sex: 'm', wear: 'coat', apron: 'waist', carry: 'cane' },
  { id: 'e09', age: 'elder', sex: 'f', wear: 'dress', apron: null, carry: 'cane' },
  { id: 'e10', age: 'elder', sex: 'm', wear: 'coat', apron: null, carry: null },
  { id: 'e11', age: 'elder', sex: 'f', wear: 'dress', apron: 'bib', carry: 'cane' },
  { id: 'e12', age: 'elder', sex: 'm', wear: 'coat', apron: 'waist', carry: null },
]

export const NAMED_LOOKS = {
  seppo: { id: 'seppo', age: 'adult', sex: 'm', wear: 'tunic', apron: 'bib', carry: 'hammer' },
  vaino: { id: 'vaino', age: 'elder', sex: 'm', wear: 'coat', apron: null, carry: null },
  pohjanen: { id: 'pohjanen', age: 'elder', sex: 'f', wear: 'dress', apron: null, carry: null },
  vicar: { id: 'vicar', age: 'adult', sex: 'm', wear: 'coat', apron: null, carry: null },
  crier: { id: 'crier', age: 'adult', sex: 'm', wear: 'coat', apron: null, carry: 'bell' },
  innkeeper: { id: 'innkeeper', age: 'adult', sex: 'm', wear: 'round', apron: 'round', carry: null },
  captain: { id: 'captain', age: 'adult', sex: 'm', wear: 'tabard', apron: null, carry: 'sword' },
  count: { id: 'count', age: 'adult', sex: 'm', wear: 'coat', apron: null, carry: null },
}

// the city watch, in the city's blue and yellow, with a spear
export const WATCH_LOOKS = [
  { id: 'w01', age: 'adult', sex: 'm', wear: 'tabard', apron: null, carry: 'spear' },
  { id: 'w02', age: 'adult', sex: 'm', wear: 'tabard', apron: null, carry: 'spear' },
  { id: 'w03', age: 'adult', sex: 'm', wear: 'tabard', apron: null, carry: 'spear' },
  { id: 'w04', age: 'adult', sex: 'm', wear: 'tabard', apron: null, carry: 'spear' },
]

export const ANIMAL_LOOKS = {
  dog: [
    { id: 'dog_1', breed: 'spitz' },
    { id: 'dog_2', breed: 'hound' },
    { id: 'dog_3', breed: 'terrier' },
    { id: 'dog_4', breed: 'lapphund' },
  ],
  cat: [
    { id: 'cat_1', coat: 'grey tabby' },
    { id: 'cat_2', coat: 'ginger' },
    { id: 'cat_3', coat: 'black and white' },
    { id: 'cat_4', coat: 'calico' },
  ],
  horse: [
    { id: 'horse_1' },
  ],
}

// Flock birds are sprites, not npcs: _a on the ground with the wings folded,
// _b with the wings up (a flock in the air shows the two in turn).
export const FLOCK_SKINS = ['tf_pigeon_a', 'tf_pigeon_b', 'tf_gull_a', 'tf_gull_b']

const frames = l => [`tf_${l.id}`, `tf_${l.id}_step`]
export const TOWNSFOLK_SKINS = [
  ...[...LOOKS, ...Object.values(NAMED_LOOKS), ...WATCH_LOOKS, ...Object.values(ANIMAL_LOOKS).flat()].flatMap(frames),
  ...FLOCK_SKINS,
]

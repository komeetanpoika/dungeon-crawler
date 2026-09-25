// Hand-curated stems for acceptableName (server/names.js): slurs and hard
// profanity in Finnish and English. This is deliberately offensive content —
// it exists only so the server can refuse it in player names — and is kept
// out of the client: it lives in server/, which server/static.js never
// serves to a browser (only renderer/ is served).
//
// Each stem is stored in normalizeName form (lowercase a-z, no digits, no
// doubled letters: "vittu" is stored as "vitu"), is at least 4 letters, and
// must not occur inside any name in test/net-names.test.js's INNOCENT list.
// Mild everyday oaths (perkele, saatana, helvetti, hitto, damn, hell, crap)
// are deliberately absent.
//
// To extend: add the new stem's ordinary spelling, run it through
// normalizeName (server/names.js) and store exactly that output; keep it
// alphabetised within its heading; then run `node --test
// test/net-names.test.js` — the "no stem sits inside an ordinary name" case
// will name any collision with the INNOCENT list, and the stem must be
// lengthened or dropped rather than the test changed. Prefer the shortest
// stem that is still unambiguous, but avoid short generic fragments (ass,
// anal, arse, rape, cock, dick, spic, paki, homo, …) that hide inside
// harmless words or names — use a longer, specific compound instead (e.g.
// "cocksucker", "asshole", "rapist").
//
// ALLOWLIST — some stems that must stay short/unambiguous still collide with
// real places or words (the Scunthorpe problem in the other direction):
// "cunt" sits inside Scunthorpe, "rapist" inside therapist, "negro" inside
// Montenegro/Negroni, "niger" inside Nigeria/Nigerian. acceptableName
// (server/names.js) removes every ALLOWLIST entry, as a substring, from the
// normalised name before running the stem check — so "Scunthorpe" passes,
// but "ScunthorpeVittu" still doesn't, since only the allowlisted substring
// is stripped. Every ALLOWLIST entry is stored in normalizeName form too.
//
// The bare country name "Niger" is deliberately NOT allowlisted:
// normalizeName collapses doubled letters, so normalizeName('Niger') and
// normalizeName('nigger') are both exactly "niger" — identical strings, not
// merely one containing the other. Allowlisting "niger" would strip the
// slur itself wherever it's typed, silently reopening the exact case this
// file exists to block. "Niger" alone stays refused; only the longer,
// unambiguous derivatives (Nigeria, Nigerian) are allowlisted.
export const ALLOWLIST = Object.freeze([
  'montenegro',
  'negroni',
  'nigeria',
  'nigerian',
  'scunthorpe',
  'therapist',
])

export const BLOCKLIST = Object.freeze([
  // — Finnish: slurs —
  'hintari',
  'hinti',
  'hintuli',
  'homotelu',
  'hompeli',
  'huri',
  'japsi',
  'mustalainen',
  'nekeri',
  'rajariko',
  'rampa',
  'retardi',
  'rysa',
  'tsigani',
  'vajalyinen',
  'vajamielinen',

  // — Finnish: hard profanity and sexual terms —
  'huora',
  'kuseta',
  'kusiainen',
  'kusipa',
  'kyrpa',
  'kyrvanimija',
  'lutka',
  'mulkero',
  'mulku',
  'nartu',
  'nusia',
  'paska',
  'paskiainen',
  'perse',
  'persreika',
  'pilu',
  'runkari',
  'vitu',

  // — English: slurs —
  'beaner',
  'chinaman',
  'chink',
  'cretin',
  'criple',
  'dago',
  'darkie',
  'fagot',
  'gimp',
  'goliwog',
  'hitler',
  'honky',
  'imbecile',
  'injun',
  'jigabo',
  'kike',
  'kraut',
  'ladyboy',
  'midget',
  'mongoloid',
  'negro',
  'niga',
  'niger',
  'pickaniny',
  'pofter',
  'polack',
  'raghead',
  'redskin',
  'retard',
  'shemale',
  'sisy',
  'slanteye',
  'spastic',
  'squaw',
  'towelhead',
  'trany',
  'wetback',

  // — English: hard profanity and sexual terms —
  'arsehole',
  'arsewipe',
  'ashat',
  'ashole',
  'aslicker',
  'aswipe',
  'bastard',
  'bestiality',
  'bitch',
  'blowjob',
  'bolocks',
  'bulshit',
  'butlicker',
  'butmunch',
  'butplug',
  'childporn',
  'cockgobler',
  'cocksucker',
  'cocktease',
  'cuckold',
  'cumdumpster',
  'cumguzler',
  'cumshot',
  'cunt',
  'depthroat',
  'dickhead',
  'dildo',
  'dipshit',
  'douchebag',
  'fatas',
  'fisting',
  'fuck',
  'gangbang',
  'handjob',
  'horseshit',
  'incest',
  'jackas',
  'jackof',
  'jerkof',
  'knobhead',
  'lolicon',
  'necrophilia',
  'orgy',
  'paedophile',
  'pedophile',
  'rapist',
  'rentboy',
  'rimjob',
  'shager',
  'shitbag',
  'shitface',
  'shithead',
  'shiter',
  'shity',
  'skank',
  'slut',
  'thot',
  'toser',
  'twat',
  'wanker',
  'wankstain',
  'whore',
])

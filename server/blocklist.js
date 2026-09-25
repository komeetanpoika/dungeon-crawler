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
// (server/names.js) forgives a stem occurrence only when it sits ENTIRELY
// inside a single occurrence of an allowlisted word in the normalised name
// (span containment, not string stripping — stripping the allowlisted word
// out first is bypassable when a stem's tail overlaps the word's head, e.g.
// "cunt" + "herapist" contains "therapist" using the stem's own trailing
// "t", so stripping it would eat the "t" the "cunt" stem needed; see the
// comment in server/names.js for the full example). So "Scunthorpe" passes,
// "ScunthorpeVittu" still doesn't (the "vitu" occurrence has no covering
// allowlist span), and neither does "cuntherapist" (the "cunt" occurrence
// starts before "therapist" does, so it isn't entirely inside that span).
// Every ALLOWLIST entry is stored in normalizeName form too.
//
// The bare country name "Niger" is deliberately NOT allowlisted:
// normalizeName collapses doubled letters, so normalizeName('Niger') and
// normalizeName('nigger') are both exactly "niger" — identical strings, not
// merely one containing the other. Allowlisting "niger" would strip the
// slur itself wherever it's typed, silently reopening the exact case this
// file exists to block. "Niger" alone stays refused; only the longer,
// unambiguous derivatives (Nigeria, Nigerian) are allowlisted.
// 2026-09-25 (final-review fix wave, item 6): 'georgy', 'huricane' and
// 'sisyphus' forgive false positives on stems that must stay (orgy, huri,
// sisy — each catches a real word/slur on its own and can't be lengthened
// without losing that); 'chrysalis'/'dagobah'/'minigames'/'tanigawa' do the
// same for 'rysa'/'dago'/'niga'. 'hinti', 'rampa', 'perse' and 'thot'
// collided with real names/words too (Hintikka, Rampage, Perseus/
// Persephone, Thoth) but were dropped from BLOCKLIST outright instead —
// 'perse' in particular is exactly the kind of short, generic fragment
// (bare "ass") the guidance above says to avoid; 'hinti'/'rampa' have
// longer, unambiguous BLOCKLIST compounds already covering the real insults
// ('hintari'/'hintuli', 'retardi'); 'thot' could not be allowlisted the same
// way as the others — "thot" is itself a strict prefix of "thoth", so
// forgiving "Thoth" also forgives any "thot" immediately followed by an "h"
// from something else entirely (e.g. "ThotHerapist", caught by the
// boundary-sharing check below) — so it was dropped instead.
export const ALLOWLIST = Object.freeze([
  'chrysalis',
  'dagobah',
  'georgy',
  'huricane',
  'minigames',
  'montenegro',
  'negroni',
  'nigeria',
  'nigerian',
  'scunthorpe',
  'shuri',
  'sisyphus',
  'tanigawa',
  'therapist',
])

export const BLOCKLIST = Object.freeze([
  // — Finnish: slurs —
  'hintari',
  'hintuli',
  'homotelu',
  'hompeli',
  'huri',
  'japsi',
  'mustalainen',
  'nekeri',
  'rajariko',
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
  'toser',
  'twat',
  'wanker',
  'wankstain',
  'whore',
])

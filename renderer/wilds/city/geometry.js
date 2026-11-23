// Where Kalevanlinna stands: four fixed pieces south of Koivula, and the bay
// south of its harbour. Pure constants and conversions; everything else of the
// city builds on these. City tile (cx, cy) is 0..159 each way; world tile
// (X, Y) = (cx, cy + 160).
export const CITY = { wx0: 0, wy0: 2, pieces: 2, size: 160, name: 'Kalevanlinna' }

export const isCityPiece = (wx, wy) =>
  wx >= CITY.wx0 && wx < CITY.wx0 + CITY.pieces && wy >= CITY.wy0 && wy < CITY.wy0 + CITY.pieces

export const CITY_KEYS = ['0,2', '1,2', '0,3', '1,3']

export const toCity = (X, Y) => ({ cx: X - CITY.wx0 * 80, cy: Y - CITY.wy0 * 80 })
export const fromCity = (cx, cy) => ({ X: cx + CITY.wx0 * 80, Y: cy + CITY.wy0 * 80 })

// The bay: an ellipse of open water, in world tiles.
export const BAY = { X: 80, Y: 310, rx: 34, ry: 20 }

// scale > 1 grows the ellipse (the sandy shore round it)
export const inBay = (X, Y, scale = 1) =>
  ((X - BAY.X) / (BAY.rx * scale)) ** 2 + ((Y - BAY.Y) / (BAY.ry * scale)) ** 2 <= 1

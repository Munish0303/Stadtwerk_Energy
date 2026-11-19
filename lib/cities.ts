export type City = { name: string; lat: number; lon: number };

// Utility locations — NRW-heavy, plus a few reference sites for wind/solar contrast.
export const CITIES: City[] = [
  { name: "Dortmund", lat: 51.514, lon: 7.468 },
  { name: "Bochum", lat: 51.481, lon: 7.216 },
  { name: "Essen", lat: 51.456, lon: 7.012 },
  { name: "Duisburg", lat: 51.435, lon: 6.763 },
  { name: "Düsseldorf", lat: 51.227, lon: 6.773 },
  { name: "Köln", lat: 50.938, lon: 6.96 },
  { name: "Münster", lat: 51.961, lon: 7.626 },
  { name: "Bielefeld", lat: 52.03, lon: 8.532 },
  { name: "Aachen", lat: 50.776, lon: 6.084 },
  { name: "Paderborn", lat: 51.718, lon: 8.754 },
  { name: "Husum (North Sea coast)", lat: 54.474, lon: 9.051 },
  { name: "Freiburg (high solar)", lat: 47.999, lon: 7.842 },
];

export const cityByName = (name: string) => CITIES.find((c) => c.name === name) ?? CITIES[0];

/**
 * Straight-line distance for the Deno side (resolve-and-add's proximity sort
 * and 60-mile gate). The browser has its own copy in public/js/spots.js — the
 * two runtimes can't share a module, so this is a deliberate small duplicate.
 *
 * Runtime-agnostic: no Deno or Node globals.
 */

const EARTH_RADIUS_MILES = 3958.8;

const toRadians = (deg: number) => (deg * Math.PI) / 180;

export interface LatLng {
  lat: number;
  lng: number;
}

export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

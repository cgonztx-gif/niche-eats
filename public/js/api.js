/**
 * Read side of the app. Public reads only — every write goes through the
 * resolve-and-add Edge Function.
 *
 * Uses plain fetch against PostgREST rather than @supabase/supabase-js: the
 * read is a single `select *`, and a CDN import would add a network dependency
 * and a failure mode to a page whose whole point is launching instantly.
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const AUTH_HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

/** @returns {Promise<Array>} every spot in the shared list. */
export async function fetchSpots() {
  const url = `${SUPABASE_URL}/rest/v1/spots?select=id,place_id,name,category,lat,lng,hours`;
  const response = await fetch(url, { headers: AUTH_HEADERS });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Could not load spots (${response.status}): ${detail.slice(0, 120)}`);
  }
  return response.json();
}

/**
 * Current position, or null if the user declines or the lookup fails.
 *
 * Resolves rather than rejects on denial: no location is a normal state the
 * dashboard handles by falling back to alphabetical order.
 */
export function getLocation({ timeout = 10000, maxAge = 300000 } = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout, maximumAge: maxAge },
    );
  });
}

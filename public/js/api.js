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

/** The function caps a single request; larger pastes are sent in chunks. */
export const BATCH_SIZE = 25;

/**
 * Resolve names to spots and add them to the shared list.
 *
 * @param {Array<string|{query:string,placeId:string}>} queries
 *   A bare string, or `{ query, placeId }` to confirm a specific candidate
 *   from an earlier ambiguous result.
 * @returns {Promise<Array>} one result per query: resolved / ambiguous /
 *   not_found / error. Partial failure is normal — the caller renders each.
 */
export async function resolveAndAdd(queries) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/resolve-and-add`, {
    method: 'POST',
    headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries }),
  });

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Server returned ${response.status}`);
  }

  // A 502 still carries per-query results (places resolved, the write failed),
  // so surface the message rather than discarding what we know.
  if (!response.ok && !body.results) {
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  if (body.error) throw new Error(body.error);

  return body.results ?? [];
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

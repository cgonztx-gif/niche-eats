/**
 * resolve-and-add — the one writer for user actions.
 *
 * Input:  { "queries": ["Franklin Barbecue Austin TX", ...] }
 *         An item may also be { query, placeId } to confirm one specific
 *         candidate returned by an earlier "ambiguous" result. Two branches of
 *         a chain can share a name AND have no distinguishing address token,
 *         which no amount of retyping can separate — this is the way out.
 * Output: { "results": [{ query, status, ... }] }
 *
 * An array handles both batch seeding and a single add (an array of one).
 * Holds the Google key and the service-role key; neither reaches the browser.
 */

import { transformHours } from "../_shared/hours.ts";
import { classifyCandidates, type Candidate } from "../_shared/match.ts";
import { haversineMiles, type LatLng } from "../_shared/geo.ts";

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

/** A match this far from the reference is treated as the wrong place. */
const MAX_REFERENCE_MILES = 60;

/**
 * Places locationBias circles cap at 50 km, short of the 60-mile gate. That's
 * fine: the bias only nudges Google's ranking toward nearby matches — the
 * authoritative distance check is the Haversine gate below.
 */
const BIAS_RADIUS_METERS = 50000;

/**
 * regularOpeningHours already puts this call in the top Text Search SKU, and
 * billing is set by the highest tier requested — so formattedAddress rides
 * along at no extra cost and gives the retry UI something to show.
 */
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.regularOpeningHours",
  "places.primaryTypeDisplayName",
  "places.formattedAddress",
].join(",");

/** Every query is a billed call, so cap what one request can spend. */
const MAX_QUERIES = 25;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

interface SpotRow {
  place_id: string;
  name: string;
  category: string | null;
  formatted_address: string | null;
  lat: number;
  lng: number;
  hours: ReturnType<typeof transformHours>;
  hours_updated_at: string;
}

async function searchPlaces(
  query: string,
  apiKey: string,
  reference: LatLng | null,
): Promise<Candidate[]> {
  const requestBody: Record<string, unknown> = { textQuery: query };
  if (reference) {
    requestBody.locationBias = {
      circle: {
        center: { latitude: reference.lat, longitude: reference.lng },
        radius: BIAS_RADIUS_METERS,
      },
    };
  }

  const response = await fetch(PLACES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Places API ${response.status}: ${detail.slice(0, 200)}`);
  }

  const body = await response.json();
  return body.places ?? [];
}

/** Miles from the reference to a candidate, or null if either lacks coords. */
function candidateMiles(candidate: Candidate, reference: LatLng | null): number | null {
  if (!reference) return null;
  const lat = candidate.location?.latitude;
  const lng = candidate.location?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return haversineMiles(reference, { lat, lng });
}

/** Pull a usable `{ lat, lng }` reference out of the request body, if present. */
function parseReference(raw: unknown): LatLng | null {
  if (!raw || typeof raw !== "object") return null;
  const { lat, lng } = raw as { lat?: unknown; lng?: unknown };
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function toRow(candidate: Candidate): SpotRow | null {
  const placeId = candidate.id;
  const name = candidate.displayName?.text;
  const lat = candidate.location?.latitude;
  const lng = candidate.location?.longitude;

  // place_id is NOT NULL and coordinates drive the whole distance sort, so a
  // candidate missing any of them is unusable rather than partially useful.
  if (!placeId || !name || typeof lat !== "number" || typeof lng !== "number") {
    return null;
  }

  return {
    place_id: placeId,
    name,
    category: candidate.primaryTypeDisplayName?.text ?? null,
    // Always present (null when absent): merge-duplicates upsert requires a
    // uniform key set across the batch. Already in the field mask, so free.
    formatted_address: candidate.formattedAddress ?? null,
    lat,
    lng,
    hours: transformHours(candidate.regularOpeningHours as never),
    hours_updated_at: new Date().toISOString(),
  };
}

/** Batch upsert via PostgREST. on_conflict makes re-seeding idempotent. */
async function upsertSpots(rows: SpotRow[], url: string, serviceKey: string) {
  const response = await fetch(`${url}/rest/v1/spots?on_conflict=place_id`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Upsert failed ${response.status}: ${detail.slice(0, 200)}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const googleKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!googleKey || !supabaseUrl || !serviceKey) {
    return json({ error: "Function is missing required secrets" }, 500);
  }

  let body: { queries?: unknown; reference?: unknown };
  try {
    body = (await req.json()) ?? {};
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  const queries = body.queries;
  const reference = parseReference(body.reference);

  if (!Array.isArray(queries) || queries.length === 0) {
    return json({ error: "Expected { queries: string[] } with at least one entry" }, 400);
  }
  if (queries.length > MAX_QUERIES) {
    return json({ error: `Too many queries (max ${MAX_QUERIES})` }, 400);
  }

  /** A bare string, or { query, placeId } to confirm a specific candidate. */
  const cleaned = queries
    .map((item) => {
      if (typeof item === "string") return { query: item.trim(), placeId: null };
      if (item && typeof item === "object" && typeof (item as { query?: unknown }).query === "string") {
        const { query, placeId } = item as { query: string; placeId?: unknown };
        return { query: query.trim(), placeId: typeof placeId === "string" ? placeId : null };
      }
      return null;
    })
    .filter((item): item is { query: string; placeId: string | null } => Boolean(item?.query));
  if (cleaned.length === 0) return json({ error: "No usable queries" }, 400);

  const results: Record<string, unknown>[] = [];
  const rows = new Map<string, SpotRow>(); // keyed by place_id: dedupes within a batch

  for (const { query, placeId } of cleaned) {
    try {
      const candidates = await searchPlaces(query, googleKey, reference);

      // An explicit placeId is a user confirming one of the options we already
      // showed them, so it overrides scoring entirely. Same search call, no
      // extra endpoint — we just pick by id instead of by score.
      const verdict = placeId
        ? (() => {
            const chosen = candidates.find((c) => c.id === placeId);
            return chosen
              ? ({ status: "resolved", match: chosen } as const)
              : ({ status: "not_found" } as const);
          })()
        : classifyCandidates(query, candidates);

      // The reference gate applies to the "first match found" — the resolved
      // match, or the top-scored option when ambiguous. If that primary
      // candidate is farther than the cap from the reference, the whole match
      // set is in the wrong region (a typo or wrong city), so reject it. A
      // confirm-by-placeId is a deliberate user choice and bypasses the gate.
      if (reference && !placeId && verdict.status !== "not_found") {
        const primary = verdict.status === "resolved" ? verdict.match : verdict.options?.[0]?.candidate;
        const miles = primary ? candidateMiles(primary, reference) : null;
        if (miles !== null && miles > MAX_REFERENCE_MILES) {
          results.push({
            query,
            status: "too_far",
            name: primary?.displayName?.text ?? null,
            address: primary?.formattedAddress ?? null,
            distance_mi: Math.round(miles),
          });
          continue;
        }
      }

      if (verdict.status === "resolved" && verdict.match) {
        const row = toRow(verdict.match);
        if (!row) {
          results.push({ query, status: "not_found", reason: "incomplete place data" });
          continue;
        }
        rows.set(row.place_id, row);
        results.push({
          query,
          status: "resolved",
          name: row.name,
          address: verdict.match.formattedAddress ?? null,
          place_id: row.place_id,
        });
      } else if (verdict.status === "ambiguous") {
        // Not written on purpose: a wrong row is worse than a missing one, so
        // the user picks a candidate or retries with a more specific string.
        // With a reference, order candidates nearest-first and tag each with
        // its distance so the picker can show and rank by it.
        const options = (verdict.options ?? []).map(({ candidate }) => {
          const miles = candidateMiles(candidate, reference);
          return {
            place_id: candidate.id, // sent back as { query, placeId } to confirm
            name: candidate.displayName?.text ?? null,
            address: candidate.formattedAddress ?? null,
            distance_mi: miles === null ? null : Math.round(miles * 10) / 10,
          };
        });
        if (reference) {
          options.sort((a, b) => (a.distance_mi ?? Infinity) - (b.distance_mi ?? Infinity));
        }
        results.push({ query, status: "ambiguous", candidates: options });
      } else {
        results.push({ query, status: "not_found" });
      }
    } catch (error) {
      results.push({ query, status: "error", message: String((error as Error).message) });
    }
  }

  // One write for the whole batch. If it fails, say so rather than reporting
  // rows as resolved when nothing landed.
  if (rows.size > 0) {
    try {
      await upsertSpots([...rows.values()], supabaseUrl, serviceKey);
    } catch (error) {
      return json(
        { error: "Places resolved but the database write failed", message: String((error as Error).message), results },
        502,
      );
    }
  }

  return json({ added: rows.size, results });
});

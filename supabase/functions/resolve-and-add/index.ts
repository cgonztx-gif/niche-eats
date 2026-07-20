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

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

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

async function searchPlaces(query: string, apiKey: string): Promise<Candidate[]> {
  const response = await fetch(PLACES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: query }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Places API ${response.status}: ${detail.slice(0, 200)}`);
  }

  const body = await response.json();
  return body.places ?? [];
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

  let queries: unknown;
  try {
    queries = (await req.json())?.queries;
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

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
      const candidates = await searchPlaces(query, googleKey);

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
        results.push({
          query,
          status: "ambiguous",
          candidates: verdict.options?.map(({ candidate }) => ({
            place_id: candidate.id, // sent back as { query, placeId } to confirm
            name: candidate.displayName?.text ?? null,
            address: candidate.formattedAddress ?? null,
          })),
        });
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

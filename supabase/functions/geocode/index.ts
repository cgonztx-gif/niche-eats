/**
 * geocode — resolve a typed address to coordinates for the add-flow reference.
 *
 * A separate, cheap sibling of resolve-and-add: it reuses the Places Text
 * Search endpoint but with a MINIMAL field mask (no regularOpeningHours), which
 * keeps the call in a lower-cost SKU. Only called when the user changes their
 * reference point, which is rare. Needs the Google key only — no DB, no
 * service-role key.
 */

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

// No opening hours — this is a location lookup, not a spot. Cheaper SKU.
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.formattedAddress",
].join(",");

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const googleKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!googleKey) return json({ error: "Function is missing required secrets" }, 500);

  let query: unknown;
  try {
    query = (await req.json())?.query;
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  if (typeof query !== "string" || query.trim() === "") {
    return json({ error: "An address is required" }, 400);
  }

  let response: Response;
  try {
    response = await fetch(PLACES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": googleKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: query.trim() }),
    });
  } catch (error) {
    return json({ error: "Lookup failed", message: String((error as Error).message) }, 502);
  }

  if (!response.ok) {
    const detail = await response.text();
    return json({ error: "Lookup failed", message: detail.slice(0, 200) }, 502);
  }

  const places = (await response.json()).places ?? [];
  const top = places[0];
  const lat = top?.location?.latitude;
  const lng = top?.location?.longitude;
  if (!top || typeof lat !== "number" || typeof lng !== "number") {
    return json({ error: "Couldn't find that address" }, 200);
  }

  return json({
    lat,
    lng,
    label: top.formattedAddress ?? top.displayName?.text ?? query.trim(),
  });
});

/**
 * remove-spot — deletes one spot from the shared list.
 *
 * A separate function from resolve-and-add on purpose: it needs no Google key,
 * and a delete has none of the per-query resolve/ambiguous/not_found shape that
 * function's contract is built around. Independent deploy, independent failure
 * surface — a bad remove can't break adding, the primary flow.
 *
 * Holds only the service-role key; the browser never gets write access to
 * Postgres directly.
 */

import { parseRemoveRequest } from "../_shared/remove-request.ts";

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Function is missing required secrets" }, 500);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  const parsed = parseRemoveRequest(body);
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  const { placeId } = parsed;

  // The single most dangerous request in the system: a DELETE that reached
  // PostgREST without this filter would empty the table. placeId is already
  // validated non-empty above, and the filter is never conditional.
  // encodeURIComponent is mandatory — PostgREST reads , . ( ) as filter syntax.
  const response = await fetch(
    `${supabaseUrl}/rest/v1/spots?place_id=eq.${encodeURIComponent(placeId)}`,
    {
      method: "DELETE",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        // Return the deleted rows so we can report how many matched.
        Prefer: "return=representation",
      },
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    return json({ error: "Delete failed", message: detail.slice(0, 200) }, 502);
  }

  // removed:0 (nothing matched) is a success — the spot is gone either way, and
  // two people removing the same one concurrently should both see it worked.
  const deleted = await response.json();
  return json({ removed: Array.isArray(deleted) ? deleted.length : 0, place_id: placeId });
});

/**
 * Validates a remove-spot request body.
 *
 * Kept pure and separate from index.ts (which calls Deno.serve at top level and
 * so can't be imported by the test runner). This guards the most dangerous code
 * path in the repo: the DELETE URL is built from `placeId`, and an empty or
 * malformed value must never reach it — a DELETE without a filter wipes the
 * table. Rejecting bad input here means index.ts only ever builds the URL from
 * a validated, non-empty string.
 *
 * Runtime-agnostic: no Deno or Node globals.
 */

/** Google place IDs are well under this; the cap just bounds a hostile value. */
const MAX_PLACE_ID_LENGTH = 255;

export type RemoveRequest = { placeId: string } | { error: string };

export function parseRemoveRequest(body: unknown): RemoveRequest {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Body must be an object with a place_id" };
  }

  const placeId = (body as { place_id?: unknown }).place_id;
  if (typeof placeId !== "string") {
    return { error: "place_id must be a string" };
  }

  const trimmed = placeId.trim();
  if (trimmed === "") {
    return { error: "place_id is required" };
  }
  if (trimmed.length > MAX_PLACE_ID_LENGTH) {
    return { error: "place_id is too long" };
  }

  return { placeId: trimmed };
}

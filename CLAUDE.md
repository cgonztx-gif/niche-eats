# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

**Niche Eats Locator** — a mobile-first PWA answering "where can I eat right now?" from **one shared global list**. You seed the list by pasting restaurant names; the app auto-resolves each to coordinates + opening hours via Google Places, then anyone opening the app sees a dashboard sorted by open-now status and distance from *their own* location.

The authoritative spec is `docs/local-food-finder-brief-v2.md`. Read it before making architectural decisions. Progress is tracked in `tasks.md`.

## Architecture

```
PWA (static, no framework)  --read-->   Supabase Postgres: one `spots` table (RLS: public read)
                            --invoke--> Edge Functions: resolve-and-add, refresh-hours
                                                  |
                                                  v  (server-side, key never shipped to client)
                                        Google Places API (New) Text Search
```

There is exactly one global list. No accounts, no share codes, no `list_id` — everyone reading the same table *is* the sharing model.

## Non-negotiable constraints

These are the design decisions that make the project cheap and safe. Don't relax them without asking.

- **No API keys in the browser** except the Supabase anon key. The Google Places key lives only in Edge Function secrets.
- **No client write access to Postgres.** Every insert/update goes through an Edge Function using the service-role key.
- **Google Places is called only on seed/add/refresh** — never on page load. A user browsing the list makes zero billed calls.
- **Keep the Places field mask tight**: `places.id,places.displayName,places.location,places.regularOpeningHours,places.primaryTypeDisplayName`. Requesting `regularOpeningHours` puts the call in a higher-cost SKU; adding more fields costs more for no gain.
- **No framework, no bundler, no build step** on the frontend. Plain HTML + vanilla ES6 + Tailwind Play CDN.
- **No embedded map tiles** — that's the one thing billed per view. Directions are deep links to the native maps app.
- Distance is **Haversine, client-side** only. No routing/drive-time.

## Data model

One table, `spots`. Full DDL in brief §3. Key points:

- `place_id text unique` — Google's ID. The uniqueness constraint makes re-seeding an idempotent no-op via upsert-on-conflict rather than a duplicate card.
- `hours jsonb` — `{ "Monday": [["11:00","22:00"]], ... }`. Array of `[open, close]` pairs per weekday; `[]` means closed that day.

### The two subtle bits of logic

Most of the bug surface in this app lives here. Treat both as worth unit-testing.

**Google `periods[]` → `hours` transform** (brief §4): group each period under its **open** day, so a Friday-night `["22:00","02:00"]` stays on Friday. `close.day != open.day` signals overnight. An `open` with no `close` means 24-hour → `[["00:00","24:00"]]`. Weekday with no period → `[]`.

**Open-status check**: when `close < open` lexically, the range spans midnight — a spot open `["22:00","02:00"]` on Friday is still open at 00:30 Saturday. Naive string comparison gets this wrong.

## Conventions

- Vanilla ES6 modules, no transpilation. Target evergreen mobile browsers.
- Edge Functions are Deno/TypeScript (Supabase runtime).
- `resolve-and-add` always takes an **array** of queries — a single add is an array of one. Its response is per-query status (`resolved` / `ambiguous` / `not_found`) so the UI can surface and retry misses rather than silently dropping them.
- Secrets go in Edge Function secrets / `.env` (gitignored) — never committed, never in client source.

## Deployment

Frontend: GitHub Pages or Cloudflare Pages (HTTPS is required for geolocation and PWA). Backend: `supabase functions deploy`. Google Cloud needs a billing account attached with a low budget alert.

# Tasks — Niche Eats Locator

Tracking against the build order in `docs/local-food-finder-brief-v2.md` §8. Phases are ordered so the app is **fully usable at the end of Phase 4** — everything after that is polish.

Status: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` skipped

---

## Feature — UI revisions round 2 (shipped)

- [x] Remove colored divider line under section headers (dot + label stay)
- [x] Three-way dessert filter (All/Desserts/No-desserts), `isDessert()` on category, persisted in localStorage
- [x] Card: drop category, `8.3 mi` (no "away"), add `statusLine()` closing/opening time
- [x] Add-flow reference point (default UT Austin, editable via new `geocode` Edge Function), persisted per-device
- [x] `resolve-and-add` reference support: proximity-sorts ambiguous candidates, rejects best match >60 mi as `too_far`
- [x] `_shared/geo.ts` Deno-side Haversine (+ tests)
- [x] Multi-select ambiguous candidates (checkboxes + "Add selected")
- [x] Travel time (drive/walk): scrapped — routing breaks zero-cost browsing
- [x] `sw.js` → v5; 67 tests (12 new: isDessert, statusLine, geo)
- [x] Verified live: no divider; card shows "Closes 10 PM · 0.3 mi"; filter partitions 21 = 4 desserts + 17, persists; geocode resolves UT/Seattle; Seattle reference makes an Austin query `too_far` (reference ≠ geolocation); multi-select added 2 branches (cleaned up)

---

## Feature — Manage: spot list + remove (shipped)

- [x] Migration `0002_add_formatted_address.sql` — nullable address column (applied to prod)
- [x] `resolve-and-add` persists `formatted_address` (always emitted, null when absent)
- [x] New `remove-spot` Edge Function — `POST { place_id } → { removed }`, deployed
- [x] Pure `_shared/remove-request.ts` validator guarding the DELETE (10 tests)
- [x] `api.js` — `fetchSpots` selects address; new `removeSpot()`
- [x] Manage list section with two-tap confirm remove; disjoint state from paste-results
- [x] Dashboard cards show address as a tertiary line (omitted when null)
- [x] `sw.js` → v4
- [x] Verified live: add stores address, add refreshes list, two-tap remove deletes (persists on reload), ambiguous-paste picker still works, dashboard null case shows no empty line
- [x] Backfilled all 21 existing rows via place_id confirm — 0 nulls, no dupes, Veracruz branches now distinguishable

---

## Phase 0 — Repo setup

- [x] `git init`, first commit
- [x] `.gitignore` — `.env`, `node_modules/`, `supabase/.temp/`, OS/editor cruft
- [x] Directory skeleton: `public/` (frontend), `supabase/functions/` (Edge Functions)
- [x] `.env.example` documenting the four keys (two secret, two client-safe)

## Phase 1 — Supabase project

*Manual console work — needs the user's account.*

- [x] Create Supabase project — verified live, anon key authenticates
- [x] Write `spots` migration → `supabase/migrations/0001_create_spots.sql`
- [ ] **Apply the migration** (paste into Supabase SQL editor — blocked on user)
- [ ] Re-run the curl checks: anon `select` succeeds, anon `insert` is denied
- [x] Record anon key (client-safe) and service-role key (secret) in gitignored `.env`

## Phase 2 — Google Cloud

*Manual console work — needs the user's account and a card on file.*

- [x] Create GCP project — `460393979096`, key is valid
- [ ] Attach billing account (not yet confirmed — the API-disabled error masks billing state)
- [ ] **Enable Places API (New)** — blocked on user; returns `SERVICE_DISABLED`
- [x] Create API key
- [ ] Restrict key to Places API only
- [ ] Set a low budget alert (~$1) as a tripwire
- [ ] Re-run the `places:searchText` smoke test with the field mask from brief §4

## Phase 3 — `resolve-and-add` Edge Function

The one writer for user actions. This is where the tricky logic lives.

- [x] Write function → `supabase/functions/resolve-and-add/index.ts`
- [x] Set secret `GOOGLE_PLACES_API_KEY` (`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are auto-injected)
- [x] Call Text Search per query with the field mask
- [x] **Match scoring** → `_shared/match.ts` — reject junk results (see Notes)
- [x] **Hours transform** — Google `periods[]` → `{ Weekday: [[open, close]] }` (`supabase/functions/_shared/hours.ts`)
  - [x] Group periods under their **open** day (overnight ranges stay on the opening day)
  - [x] 24-hour venues (`open` with no `close`) → `[["00:00","24:00"]]`
  - [x] Weekdays with no period → `[]`
  - [x] Unit tests covering: normal day, overnight, 24h, closed day, malformed input
- [x] Upsert into `spots` on conflict with `place_id` — verified idempotent (two upserts → one row)
- [x] Per-query response status: `resolved` (with matched name + address) / `ambiguous` / `not_found`
- [x] CORS headers so the browser can invoke it
- [x] Pipeline verified end-to-end against live Google + Supabase (resolved / ambiguous / not_found all correct; rows cleaned up after)
- [x] **Deployed** to project `ebozpvpszregjuhkucas`
- [x] Live endpoint tested: batch (mixed outcomes) + single add
- [x] Validation paths verified: empty array/malformed body/over-cap → 400, GET → 405, no auth → 401
- [x] **Address tiebreak** — chains share one identical `displayName`, so name scoring alone left them permanently unresolvable

## Phase 4 — Frontend read + dashboard

**App is fully usable when this phase closes.**

- [x] `index.html` shell — Tailwind Play CDN, mobile-first, viewport meta
- [x] Supabase read (anon key) — plain `fetch` against PostgREST, not `supabase-js` (see Notes)
- [x] `navigator.geolocation` with permission-denied and error states handled
- [x] Haversine distance helper (`public/js/spots.js`)
- [x] **Open-status function** — current local time vs `hours`
  - [x] Overnight handling: `close <= open` spans midnight (a Fri `["22:00","02:00"]` spot is open Sat 00:30)
  - [x] Unit tests for the boundary cases
- [x] Render **Open Now** (primary) and **Closed** (secondary, de-emphasized) buckets, each nearest-first
- [x] Distance label — `"0.4 mi away"` (`formatDistance`)
- [x] Maps deep link per card (`maps.apple.com/?daddr=` / `google.com/maps/dir/?api=1&destination=`)
- [x] Refresh control (re-reads the list and re-locates)
- [x] Empty state, no-location state, and load-failure state — all three verified in-browser
- [x] 60s auto-re-render, plus a re-render on `visibilitychange` (a PWA resumed from background can be hours stale)

## Phase 5 — Manage UI

- [x] Manage view → `public/manage.html` + `public/js/manage.js`
- [x] Paste-to-seed textarea, split on newline → `resolve-and-add` with the array
- [x] Single add — same box with one line (an array of one); no separate control needed
- [x] Per-line result feedback with inline edit-and-retry for `ambiguous` / `not_found`
- [x] **Pick-a-candidate escape hatch** — `{ query, placeId }` items confirm one of the returned options. Reuses the same Text Search call, matching on candidate id; a bogus id falls back to `not_found` and writes nothing.
- [x] Resolved rows show matched name + address, so a wrong match is visible immediately
- [x] Requests chunked at 25/request to stay under the function cap
- [x] Verified in-browser: batch of 3 → resolved / ambiguous / not_found rows; tap-to-confirm collapsed the ambiguous row; edit-and-retry resolved in place; new spot appeared on the dashboard

## Phase 6 — PWA layer

- [x] `manifest.json` — standalone display, name, theme color, icons
- [x] App icons (192, 512, 512-maskable, 180 apple-touch) — generated by `npm run icons`
- [x] Cache-first service worker (`public/sw.js`) with versioned cache + old-cache cleanup
- [x] Supabase requests bypass the cache entirely — stale open/closed data is worse than none
- [x] iOS meta tags: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-touch-icon`
- [x] `viewport-fit=cover` + safe-area-inset padding for a flush home-screen app
- [x] Verified: worker activates, 13 assets cached (shell + Tailwind CDN), Supabase excluded, and the app launches fully styled **with the origin server killed**
- [ ] Verify install-to-Home-Screen on a real iOS and Android device (needs hardware — can't be done from here)

## Phase 7 — `refresh-hours` cron *(recommended but optional)*

Keeps hours fresh and sidesteps Google's Content caching limit. The app works without it; data just goes stale slowly.

- [ ] Scaffold `refresh-hours` function — re-fetch hours per stored `place_id`, update `hours` + `hours_updated_at`
- [ ] Schedule weekly (Supabase cron or GitHub Actions cron)
- [ ] Confirm it's not exposed to unauthenticated callers

## Phase 8 — Deploy

- [x] Push to GitHub → **https://github.com/cgonztx-gif/niche-eats** (public)
- [x] Pages enabled via Actions workflow; tests gate the deploy
- [x] **Live: https://cgonztx-gif.github.io/niche-eats/** — HTTPS confirmed, http redirects 301
- [x] Service worker scopes correctly under the `/niche-eats/` subpath (relative paths); 12 assets cached, Supabase excluded
- [ ] Grant location on the live site once (HTTPS requirement is met; the prompt needs a real tap)
- [ ] Seed the real list — your call on which spots
- [ ] Share URL; verify a second device sees the same spots
- [ ] **Confirm the Google $1 budget alert is actually set** — with the manage UI public, this is now the only guard on quota spend

---

## Notes & known rough edges

- **Read path uses plain `fetch`, not `@supabase/supabase-js`.** Brief §7 names the client library, but the read is a single `select *`. A CDN import would add a network dependency and a failure mode to a page whose entire selling point is launching instantly. The anon key + PostgREST URL do the same job in ~10 lines.
- **Chains are visually identical in the list.** Two `Veracruz All Natural` rows render with the same name and category; only distance separates them, and that's absent until location is granted. `spots` has no address column (brief §3), so there's nothing else to show. Options: add a `formatted_address` column and a subtitle, or accept it. Not fixed — needs a call.
- **Refresh stays disabled while geolocation resolves** (up to 10s if the user ignores the prompt). The list is already rendered underneath, so it reads as "still working" rather than broken. Left as-is.

## Open questions

- **Timezone**: open-status compares against the *device's* local clock. Fine while all spots are in one metro; would need per-spot timezone if the list ever spans regions. Assuming single-metro for now.
- **`place_id` nullability**: brief §3 declares it `text unique` (nullable). Postgres allows multiple NULLs, so a resolve that somehow lacks a `place_id` could duplicate. Consider `not null` unless there's a reason to store unresolved spots.
- **Manage UI access**: it's unauthenticated by design, so anyone with the URL can add spots. Acceptable for a friend-group app; worth a shared secret in the function if the URL ever leaks wider.

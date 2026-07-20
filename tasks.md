# Tasks — Niche Eats Locator

Tracking against the build order in `docs/local-food-finder-brief-v2.md` §8. Phases are ordered so the app is **fully usable at the end of Phase 4** — everything after that is polish.

Status: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` skipped

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

- [ ] Scaffold function (`supabase functions new resolve-and-add`)
- [ ] Set secrets: Google Places key, Supabase service-role key
- [ ] Call Text Search per query with the tight field mask
- [x] **Hours transform** — Google `periods[]` → `{ Weekday: [[open, close]] }` (`supabase/functions/_shared/hours.ts`)
  - [x] Group periods under their **open** day (overnight ranges stay on the opening day)
  - [x] 24-hour venues (`open` with no `close`) → `[["00:00","24:00"]]`
  - [x] Weekdays with no period → `[]`
  - [x] Unit tests covering: normal day, overnight, 24h, closed day, malformed input
- [ ] Upsert into `spots` on conflict with `place_id` (re-seeding must be a harmless no-op)
- [ ] Per-query response status: `resolved` (with matched name + address) / `ambiguous` / `not_found`
- [ ] CORS headers so the browser can invoke it
- [ ] Deploy; test via curl with a batch **and** a single-item array

## Phase 4 — Frontend read + dashboard

**App is fully usable when this phase closes.**

- [ ] `index.html` shell — Tailwind Play CDN, mobile-first, viewport meta
- [ ] Supabase client (anon key) — `select * from spots`
- [ ] `navigator.geolocation` with permission-denied and error states handled
- [x] Haversine distance helper (`public/js/spots.js`)
- [x] **Open-status function** — current local time vs `hours`
  - [x] Overnight handling: `close <= open` spans midnight (a Fri `["22:00","02:00"]` spot is open Sat 00:30)
  - [x] Unit tests for the boundary cases
- [ ] Render **Open Now** (primary) and **Closed** (secondary, de-emphasized) buckets, each nearest-first
- [x] Distance label — `"0.4 mi away"` (`formatDistance`)
- [ ] Maps deep link per card (`maps.apple.com/?daddr=` / `google.com/maps/dir/?api=1&destination=`)
- [ ] Refresh-location control
- [ ] Empty state (no spots seeded yet) and no-location state
- [ ] Optional: 60s auto-re-render so open/closed flips with the clock

## Phase 5 — Manage UI

- [ ] Manage view (separate route or toggled panel)
- [ ] Paste-to-seed textarea, split on newline → `resolve-and-add` with the array
- [ ] Single-add input box → array of one
- [ ] Per-line result feedback with inline edit-and-retry for `ambiguous` / `not_found`
- [ ] Low-confidence matches show the resolved name/address for a one-tap confirm

## Phase 6 — PWA layer

- [ ] `manifest.json` — standalone display, name, theme color, icons
- [ ] App icons (192, 512, maskable)
- [ ] Cache-first service worker for instant launch
- [ ] iOS meta tags: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`
- [ ] `viewport-fit=cover` + safe-area-inset padding for a flush home-screen app
- [ ] Verify install-to-Home-Screen on iOS and Android

## Phase 7 — `refresh-hours` cron *(recommended but optional)*

Keeps hours fresh and sidesteps Google's Content caching limit. The app works without it; data just goes stale slowly.

- [ ] Scaffold `refresh-hours` function — re-fetch hours per stored `place_id`, update `hours` + `hours_updated_at`
- [ ] Schedule weekly (Supabase cron or GitHub Actions cron)
- [ ] Confirm it's not exposed to unauthenticated callers

## Phase 8 — Deploy

- [ ] Push to GitHub → enable Pages (or Cloudflare Pages); confirm HTTPS
- [ ] Confirm geolocation works on the deployed origin (it will not over plain HTTP)
- [ ] Seed the real list
- [ ] Share URL; verify a second device sees the same spots

---

## Open questions

- **Timezone**: open-status compares against the *device's* local clock. Fine while all spots are in one metro; would need per-spot timezone if the list ever spans regions. Assuming single-metro for now.
- **`place_id` nullability**: brief §3 declares it `text unique` (nullable). Postgres allows multiple NULLs, so a resolve that somehow lacks a `place_id` could duplicate. Consider `not null` unless there's a reason to store unresolved spots.
- **Manage UI access**: it's unauthenticated by design, so anyone with the URL can add spots. Acceptable for a friend-group app; worth a shared secret in the function if the URL ever leaks wider.

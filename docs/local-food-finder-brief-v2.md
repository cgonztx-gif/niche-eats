# Local Food Finder — PWA Project Brief (v2: Shared Global List, Auto-Resolving)

> A mobile-first Progressive Web App that answers **"where can I eat right now?"** from **one shared list everyone sees**. You seed the list by pasting restaurant names — the app auto-resolves each to real coordinates and opening hours — then anyone who opens the app sees a live dashboard sorted by open-now status and distance from *their own* location.
>
> This supersedes v1. The big change: the spot list is no longer a hand-edited static file. It's a single shared database table, populated automatically from pasted names via the Google Places API, and readable from any device.

---

## 0. Build Philosophy & Cost Model

Two cost dimensions to keep low: **build cost** (tokens/iterations for whoever implements it) and **running cost** (recurring $).

- **Running cost ≈ $0.** Frontend hosting is free (GitHub/Cloudflare Pages). Supabase free tier covers the database. The only metered thing is the Google Places API — and it's called **only when you seed or add a spot**, never when someone opens the app. A user browsing the sorted list makes **zero** billed calls. Seeding the list once plus a few adds a month is a few dozen lookups total — pennies, well inside free credit.
- **Build cost stays low** by keeping the frontend framework-free and the backend to a single table plus two small Edge Functions. No bundler, no heavy ORM, no custom auth server, no list/sharing plumbing.

**The one non-free requirement:** Google Places needs a Google Cloud billing account with a card on file (mandatory even inside the free tier). That's the accepted trade for reliable, auto-fetched opening hours.

---

## 1. Architecture Overview

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  PWA (static, framework-free)│  read  │  Supabase                    │
│  - geolocation + Haversine   │ ─────► │  - Postgres: one spots table │
│  - render sorted dashboard   │        │  - RLS: public read          │
│  - seed/add admin UI         │  call  │  - Edge Functions (writers)  │
└─────────────────────────────┘ ─────► │      resolve-and-add         │
                                         │      refresh-hours (cron)    │
                                         └──────────────┬───────────────┘
                                                        │ server-side call
                                                        ▼
                                              ┌────────────────────┐
                                              │ Google Places API  │
                                              │ (New) Text Search  │
                                              └────────────────────┘
```

**Sharing model:** there's exactly one global list. Everyone opens the same app URL and reads the same `spots` table — that *is* the sharing. No lists, no share codes, no accounts.

**Key security principle:** the Google Places key and all database *writes* live server-side in Edge Functions. The browser only ever does public **reads** and calls the functions. The key is never shipped to the client.

---

## 2. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| **Frontend** | Plain HTML + vanilla ES6 + Tailwind Play CDN | Zero-build, cheap to construct and load |
| **DB / backend** | Supabase (Postgres + REST + Edge Functions) | Free tier; one shared table = cross-device sharing for free |
| **Place resolution** | Google Places API (New) — Text Search | Reliable coordinates **and** opening hours from a name string |
| **Serverless glue** | Supabase Edge Functions (Deno/TypeScript) | Hides API key + service-role writes; free tier |
| **Location** | Native `navigator.geolocation` | Free, native permission popup |
| **Distance** | Haversine, client-side | Free, keyless straight-line distance |
| **Directions** | Apple/Google Maps deep links | Free, opens native maps app |
| **Hosting** | GitHub Pages / Cloudflare Pages | $0, HTTPS (required for geolocation + PWA) |

> Supabase free-tier caveat: free projects pause after ~1 week of **inactivity**. A shared app in regular use stays awake; if you ever want guaranteed always-on, that's the $25/mo Pro tier — not needed for a personal/friend-group app.

---

## 3. Data Model (Supabase / Postgres)

One table. No lists, no `list_id`, no `share_code`.

```sql
create table spots (
  id               uuid primary key default gen_random_uuid(),
  place_id         text unique,               -- Google place ID (safe to store indefinitely); unique prevents dupes
  name             text not null,
  category         text,                      -- e.g. "Food Truck", from Google primary type
  lat              double precision not null,
  lng              double precision not null,
  hours            jsonb not null,            -- { "Monday": [["11:00","22:00"]], ... }
  hours_updated_at timestamptz default now(),
  created_at       timestamptz default now()
);
```

The `unique` on `place_id` means re-seeding or adding the same place twice is a harmless no-op (upsert on conflict) instead of a duplicate card.

**The `hours` JSONB** uses the same schema as v1 — an array of `[open, close]` pairs per weekday, `[]` for closed days, and overnight ranges expressed as `["22:00","02:00"]` (the open-status function detects `close < open` and treats it as spanning midnight). This is populated automatically (see §5), not typed by hand.

**Row Level Security:**
- `spots`: public **read** allowed — anyone who opens the app sees the whole list.
- **No client write access at all.** Every insert/update goes through an Edge Function using the service-role key. The browser never needs write permissions, and all mutations are mediated by the same function that does the Google lookup — clean and safe.

---

## 4. Google Places Integration (server-side only)

Use the **Places API (New) Text Search** endpoint. One call resolves a name string to everything you need.

```
POST https://places.googleapis.com/v1/places:searchText
Headers:
  X-Goog-Api-Key: <key from Edge Function env — never client-side>
  X-Goog-FieldMask: places.id,places.displayName,places.location,
                    places.regularOpeningHours,places.primaryTypeDisplayName
Body:
  { "textQuery": "Spicy Boys Fried Chicken Austin TX" }
```

- **Field masking controls cost.** Requesting `regularOpeningHours` bumps the call into a higher (Pro/Enterprise) SKU tier — that's the metered part. At seed/add volume it's negligible, but keep the mask tight: only request the five fields above.
- **Disambiguation:** append a city/area to each query to avoid wrong matches ("Spicy Boys" alone may hit several). The function should return the top candidate plus enough info (address/displayName) for the UI to flag low-confidence matches for a one-tap confirm.

### Transforming Google hours → the app schema

Google returns `regularOpeningHours.periods[]`, each with `open`/`close` objects (`day` 0=Sunday…6=Saturday, `hour`, `minute`). A transform function must:
1. Map `day` number → weekday name.
2. Format `hour`/`minute` → `"HH:MM"`.
3. Group periods under their **open** day (so a Friday-night `["22:00","02:00"]` overnight range stays on Friday; `close.day` differing from `open.day` signals overnight).
4. Handle **24-hour** venues (an `open` with no `close`) → `[["00:00","24:00"]]`.
5. Any weekday with no period → `[]` (closed).

Store the result in the `hours` column. Store `place_id` and `lat`/`lng` too.

### ToS compliance note (worth doing properly)

Google's terms let you store **place IDs and coordinates indefinitely**, but most other Content — including opening hours — is subject to a caching limit and expected to be refreshed periodically. For a private app this is unlikely to matter, but the clean, compliant pattern is cheap:

- Store `place_id` permanently.
- Add a **`refresh-hours` Edge Function on a schedule** (Supabase cron, or a GitHub Actions cron — the same pattern you'd use elsewhere) that re-fetches `regularOpeningHours` for stored `place_id`s and updates `hours` + `hours_updated_at`. Weekly is plenty.

This keeps hours fresh (venues change schedules anyway) and sidesteps the caching concern for a few cents a month. Mark it **recommended but optional** — the app works without it; it just goes stale slowly.

---

## 5. Edge Functions

**`resolve-and-add`** — the one writer for user actions.
- Input: `{ queries: string[] }` — an array handles both **batch seeding** from a pasted list and **single adds** (an array of one).
- For each query: call Google Text Search → transform hours → **upsert** into `spots` (on conflict with `place_id`, do nothing/update).
- Output: per-query status — `resolved` (with the matched name/address), `ambiguous` (multiple candidates), or `not_found` — so the UI can show results and let the user fix or retry the misses. This graceful degradation is what keeps "paste a list" from silently dropping spots it couldn't match.

**`refresh-hours`** — scheduled (optional, see §4).
- For each spot with a `place_id`: re-fetch hours, update row. No user input.

Both run with the Supabase **service-role key** (server-side only) and hold the **Google Places key** in function secrets. Restrict the Google key to the Places API in Cloud Console.

---

## 6. User Flows

**Seed the list (paste):**
1. Open the app's manage view.
2. Paste names into a textarea, one per line (optionally `Name, City` to disambiguate).
3. Client splits by newline → calls `resolve-and-add` with the array.
4. UI shows each line's result; ambiguous/not-found lines get an inline edit-and-retry. Everything resolved lands in the shared table for everyone.

**Add one spot later:** single input box → `resolve-and-add` with a one-item array → appears for everyone.

**Use the app (fully automatic, zero manual):**
1. Open the app. Client reads all spots from Supabase.
2. Native geolocation popup → save the user's lat/lng.
3. Compute open-status (current time vs `hours`) and Haversine distance for each spot.
4. Render **Open Now** and **Closed** buckets, each sorted nearest-first, with a maps deep-link per card.

**Share:** send the app URL. Any device that opens it reads the same global list. No accounts, no codes.

---

## 7. Frontend (PWA)

Structurally the same lightweight PWA as v1, with two changes: it reads spots from Supabase (via the `@supabase/supabase-js` client with the anon key — a plain `select * from spots`) instead of a local file, and it has a small **manage** surface for seeding/adding.

Unchanged from v1: mobile-first dashboard, Open-Now (primary) vs Closed (secondary, de-emphasized) sections, distance like `"0.4 mi away"`, maps deep links (`maps.apple.com/?daddr=<lat>,<lng>` / `google.com/maps/dir/?api=1&destination=<lat>,<lng>`), a refresh-location control, and optional 60s auto-re-render so open/closed flips with the clock.

**PWA assets:** `manifest.json` (standalone display, icons, theme color) and a cache-first service worker for instant launch. Include the iOS meta tags — `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `viewport-fit=cover` with safe-area-inset padding — for a flush home-screen app.

---

## 8. Build Order

1. **Supabase project** — create the single `spots` table, RLS (public read, no client write), get anon + service-role keys.
2. **Google Cloud** — enable Places API (New), create + restrict a key, attach billing account.
3. **`resolve-and-add` Edge Function** — Google call + hours transform + upsert. Test with a pasted batch and a single add via `curl`.
4. **Frontend read + dashboard** — Supabase `select * from spots`, geolocation, Haversine, open-status (with overnight handling), sorted card render. App is fully usable here.
5. **Manage UI** — paste-to-seed textarea and single-add box wired to the function, with per-line result feedback.
6. **PWA layer** — manifest, service worker, iOS meta tags, icons.
7. **`refresh-hours` cron** — optional ToS-compliant hours refresh.

---

## 9. Deployment ($0 + Google pennies)

- **Frontend:** push to GitHub → Pages (or Cloudflare Pages). HTTPS auto (required for geolocation + PWA).
- **Backend:** Supabase project + `supabase functions deploy`. Store Google key + service-role key as function secrets.
- **Google:** billing account attached; set a low budget alert (e.g. $1) — you'll never hit it, but it's a cheap tripwire.
- **Share:** send the app URL; each person adds it to their Home Screen.

---

## 10. Non-Goals (keep it lean)

- ❌ No user accounts / login / share codes — one public global list.
- ❌ No client-side write access or client-side API keys.
- ❌ No embedded interactive map tiles (that's the one thing that costs per-view) — the UI is a sorted card list; directions open the native maps app.
- ❌ No routing/drive-time distance — straight-line Haversine only.
- ❌ No framework/bundler on the frontend.

---

## Appendix: What changed from v1

| | v1 (static) | v2 (this brief) |
|---|---|---|
| Spot data | Hand-typed `data.js` | Auto-resolved from pasted names |
| Coordinates & hours | Manually looked up | Google Places API |
| Storage | Local file | Supabase (one shared table) |
| Sharing | None (single device) | One global list, any device |
| Writes | Edit file + redeploy | `resolve-and-add` Edge Function |
| Running cost | $0 | $0 + a few Google cents |
| Requires billing card | No | Yes (Google Cloud) |

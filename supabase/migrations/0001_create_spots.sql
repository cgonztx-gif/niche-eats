-- Local Food Finder — the single shared spots table.
-- One global list: no list_id, no share_code, no accounts.

create table if not exists spots (
  id               uuid primary key default gen_random_uuid(),
  place_id         text not null unique,      -- Google place ID; unique makes re-seeding a no-op
  name             text not null,
  category         text,                      -- from Google primaryTypeDisplayName, e.g. "Food Truck"
  lat              double precision not null,
  lng              double precision not null,
  hours            jsonb not null default '{}'::jsonb,
  hours_updated_at timestamptz default now(),
  created_at       timestamptz default now()
);

-- Brief §3 leaves place_id nullable, but Postgres allows multiple NULLs in a
-- unique column, which would let unresolved rows duplicate freely. Every row
-- reaches this table via resolve-and-add, which only writes places Google
-- actually matched, so a place_id is always available. NOT NULL makes the
-- dedupe guarantee real.

alter table spots enable row level security;

-- Public read: anyone who opens the app sees the whole list. This *is* the
-- sharing model.
drop policy if exists "spots are publicly readable" on spots;
create policy "spots are publicly readable"
  on spots for select
  to anon, authenticated
  using (true);

-- Deliberately NO insert/update/delete policies. With RLS enabled, anything
-- without a matching policy is denied, so the anon key cannot write. All
-- mutations go through Edge Functions using the service-role key, which
-- bypasses RLS entirely.

-- Sorting is done client-side after distance is computed, so the only index
-- worth having is the one the unique constraint already creates on place_id.

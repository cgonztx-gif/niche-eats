-- Store Google's formatted address so chain branches with identical names
-- (e.g. two "Veracruz All Natural" rows) are distinguishable in the UI.
--
-- Nullable, no backfill: the value only exists in Google's response, so there's
-- no SQL expression that could populate existing rows. They fill in on the next
-- re-add through resolve-and-add (upsert on place_id). Adding a nullable column
-- is backward-compatible — the live function and frontend keep working untouched
-- until they're redeployed to use it.

alter table spots add column if not exists formatted_address text;

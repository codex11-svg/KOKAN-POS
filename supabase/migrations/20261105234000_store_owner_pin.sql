alter table public.stores
  add column if not exists owner_pin_hash text;

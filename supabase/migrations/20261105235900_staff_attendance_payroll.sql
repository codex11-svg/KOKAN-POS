alter table public.staff
  add column if not exists hourly_rate numeric(10, 2) not null default 0
  check (hourly_rate >= 0);

create table if not exists public.staff_shifts (
  id uuid primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  staff_name text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  hourly_rate numeric(10, 2) not null default 0 check (hourly_rate >= 0),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create index if not exists staff_shifts_store_started_at_idx
  on public.staff_shifts (store_id, started_at desc);

alter table public.staff_shifts enable row level security;

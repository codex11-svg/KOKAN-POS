create table if not exists public.operations_events (
  id uuid primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists operations_events_store_created_at_idx
  on public.operations_events (store_id, created_at desc);

create table if not exists public.developer_store_notes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  note text not null check (length(trim(note)) between 1 and 2000),
  author_email text not null,
  created_at timestamptz not null default now()
);

create index if not exists developer_store_notes_store_created_at_idx
  on public.developer_store_notes (store_id, created_at desc);

create table if not exists public.platform_audit_log (
  id bigint generated always as identity primary key,
  developer_email text not null,
  action text not null,
  store_id uuid references public.stores(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_audit_log_created_at_idx
  on public.platform_audit_log (created_at desc);

alter table public.operations_events enable row level security;
alter table public.developer_store_notes enable row level security;
alter table public.platform_audit_log enable row level security;

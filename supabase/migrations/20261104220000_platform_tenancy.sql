create extension if not exists pgcrypto;

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_name text not null,
  email text not null,
  phone text not null default '',
  area text not null default '',
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.store_memberships (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin')),
  created_at timestamptz not null default now(),
  primary key (store_id, user_id),
  unique (user_id)
);

create table public.signup_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  shop_name text not null,
  owner_name text not null,
  phone text not null default '',
  area text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (user_id, status)
);

create index signup_requests_status_created_at_idx on public.signup_requests(status, created_at);

create table public.platform_features (
  key text primary key,
  label text not null,
  description text not null,
  default_enabled boolean not null default true
);

insert into public.platform_features (key, label, description) values
  ('enable_khata', 'Khata ledger', 'Allow trusted customers to buy now and settle later.'),
  ('enable_gst', 'GST tools', 'Show GST-ready sales summaries and receipt fields.'),
  ('enable_thermal_print', 'Thermal printing', 'Connect an ESC/POS Bluetooth receipt printer.'),
  ('enable_camera_scan', 'Camera scanner', 'Use a device camera to read product barcodes.')
on conflict (key) do nothing;

create table public.store_features (
  store_id uuid not null references public.stores(id) on delete cascade,
  feature_key text not null references public.platform_features(key) on delete cascade,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (store_id, feature_key)
);

create table public.shop_profiles (
  store_id uuid not null references public.stores(id) on delete cascade,
  id text not null default 'current_shop',
  shop_name text not null,
  owner_name text not null,
  area text not null default '',
  phone text not null default '',
  upi_id text not null default '',
  updated_at timestamptz not null default now(),
  primary key (store_id, id)
);

create table public.products (
  id uuid primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  barcode text,
  category text not null,
  unit text not null default 'unit',
  selling_price double precision not null,
  cost_price double precision not null,
  stock_qty double precision not null default 0,
  updated_at timestamptz not null default now(),
  unique (store_id, barcode)
);

create index products_store_updated_at_idx on public.products(store_id, updated_at);

create table public.customers (
  id uuid primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  phone text not null default '',
  current_balance double precision not null default 0,
  updated_at timestamptz not null default now()
);

create index customers_store_updated_at_idx on public.customers(store_id, updated_at);

create table public.invoices (
  id uuid primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id uuid,
  customer_name text,
  items_json jsonb not null default '[]'::jsonb,
  subtotal double precision not null default 0,
  discount double precision not null default 0,
  total_amount double precision not null,
  payment_mode text not null check (payment_mode in ('cash', 'upi', 'khata')),
  created_at timestamptz not null default now()
);

create index invoices_store_created_at_idx on public.invoices(store_id, created_at);

create table public.feature_flags (
  store_id uuid not null references public.stores(id) on delete cascade,
  id text not null,
  key text not null,
  label text not null,
  description text not null default '',
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (store_id, id),
  unique (store_id, key)
);

create table public.staff (
  id uuid primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  role text not null check (role in ('owner', 'admin', 'cashier')),
  active boolean not null default true,
  pin_hash text not null,
  updated_at timestamptz not null default now()
);

create index staff_store_updated_at_idx on public.staff(store_id, updated_at);

alter table public.stores enable row level security;
alter table public.store_memberships enable row level security;
alter table public.signup_requests enable row level security;
alter table public.platform_features enable row level security;
alter table public.store_features enable row level security;
alter table public.shop_profiles enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.invoices enable row level security;
alter table public.feature_flags enable row level security;
alter table public.staff enable row level security;

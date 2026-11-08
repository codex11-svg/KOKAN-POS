alter table public.invoices
  add column if not exists customer_phone text;

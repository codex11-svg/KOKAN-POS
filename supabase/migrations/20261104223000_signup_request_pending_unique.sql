alter table public.signup_requests
  drop constraint if exists signup_requests_user_id_status_key;

create unique index if not exists signup_requests_one_pending_per_user_idx
  on public.signup_requests(user_id)
  where status = 'pending';

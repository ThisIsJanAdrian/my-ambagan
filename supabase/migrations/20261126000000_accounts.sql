-- Accounts: a verified identity (auth.users) that owns exactly one permanent Username.
-- Rules live here, not in app code (ADR 0002).

create table public.accounts (
  id uuid primary key references auth.users (id) on delete restrict,
  username text not null,
  created_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-z0-9._-]{3,30}$')
);

-- Case-insensitive uniqueness (the format check already forces lowercase;
-- this index keeps the guarantee even if the format is ever loosened).
create unique index accounts_username_key on public.accounts (lower(username));

-- Usernames are permanent: no UPDATE or DELETE, for anyone (table owner included).
create function public.accounts_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'A Username is permanent and cannot be changed or removed.'
    using errcode = 'P0001';
end $$;

create trigger accounts_permanent_username before update or delete on public.accounts
  for each row execute function public.accounts_immutable();

alter table public.accounts enable row level security;

-- Any signed-in Account can see Usernames. The table holds no email, and
-- auth.users is not reachable by API roles, so emails stay private.
create policy accounts_read on public.accounts
  for select to authenticated using (true);

revoke all on public.accounts from anon, authenticated;
grant select on public.accounts to authenticated;

create function public.is_verified() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid() and email_confirmed_at is not null
  );
$$;

-- Immediate feedback for the sign-up form.
create function public.username_available(p_username text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.accounts where lower(username) = lower(p_username));
$$;

create function public.set_username(p_username text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;
  if not public.is_verified() then
    raise exception 'Verify your email before choosing a Username.' using errcode = '42501';
  end if;
  if exists (select 1 from public.accounts where id = auth.uid()) then
    raise exception 'You already have a Username and it cannot be changed.' using errcode = 'P0001';
  end if;
  if p_username is null or p_username !~ '^[a-z0-9._-]{3,30}$' then
    raise exception 'Username must be 3 to 30 characters: lowercase letters, numbers, dot, hyphen or underscore.'
      using errcode = '22023';
  end if;
  if not public.username_available(p_username) then
    raise exception 'Username "%" is already taken.', p_username using errcode = '23505';
  end if;
  insert into public.accounts (id, username) values (auth.uid(), p_username);
end $$;

revoke all on function public.set_username(text), public.username_available(text), public.is_verified() from public, anon;
grant execute on function public.set_username(text), public.username_available(text), public.is_verified() to authenticated;

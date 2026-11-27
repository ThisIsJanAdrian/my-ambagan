-- Join, rejoin and leave (ADR 0002: rules live in Postgres).
-- A Member who leaves keeps their row with left_at set, so rejoining restores
-- the same Member instead of creating a new one.

alter table public.room_members add column left_at timestamptz;

-- "Member" means a current Member: one who has not left.
create or replace function public.is_room_member(p_room_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_members
    where room_id = p_room_id and account_id = auth.uid() and left_at is null
  );
$$;

-- Former Members stay out of the member list; their rows are history.
drop policy room_members_read on public.room_members;
create policy room_members_read on public.room_members
  for select to authenticated using (left_at is null and public.is_room_member(room_id));

-- Failed join attempts, kept so guessing Room IDs can be rate-limited per Account.
create table public.join_attempts (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts (id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index join_attempts_account_idx on public.join_attempts (account_id, attempted_at desc);
alter table public.join_attempts enable row level security;
revoke all on public.join_attempts from anon, authenticated;

-- Join a Room by its Room ID. Refusals are returned (not raised) so that a
-- failed attempt can be recorded for the rate limit.
create function public.join_room(p_room_id text)
returns table (outcome text, message text)
language plpgsql security definer set search_path = '' as $$
declare
  max_members constant int := 10;
  max_failures constant int := 5;
  failure_window constant interval := interval '10 minutes';
  rid text := lower(btrim(coalesce(p_room_id, '')));
  existing public.room_members;
  had_row boolean;
  current_members int;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;
  if not public.is_verified() then
    raise exception 'Verify your email before joining a Room.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.accounts where id = auth.uid()) then
    raise exception 'Choose a Username before joining a Room.' using errcode = '42501';
  end if;

  if (select count(*) from public.join_attempts
      where account_id = auth.uid() and attempted_at > now() - failure_window) >= max_failures then
    return query select 'rate_limited', 'Too many failed attempts. Try again in a few minutes.';
    return;
  end if;

  -- Lock the Room so two joiners cannot both take the last seat.
  perform 1 from public.rooms where id = rid for update;
  if not found then
    delete from public.join_attempts where attempted_at < now() - interval '1 day';
    insert into public.join_attempts (account_id) values (auth.uid());
    return query select 'unknown_room', 'No Room has that Room ID.';
    return;
  end if;

  select * into existing from public.room_members where room_id = rid and account_id = auth.uid();
  had_row := found;
  if had_row and existing.left_at is null then
    return query select 'already_member', 'You are already in this Room.';
    return;
  end if;

  select count(*) into current_members from public.room_members where room_id = rid and left_at is null;
  if current_members >= max_members then
    return query select 'room_full', 'This Room already has ten Members.';
    return;
  end if;

  if had_row then
    update public.room_members set left_at = null where room_id = rid and account_id = auth.uid();
    perform public.record_audit_event(rid, auth.uid(), 'member_rejoined');
    return query select 'rejoined', 'Welcome back.';
  else
    insert into public.room_members (room_id, account_id) values (rid, auth.uid());
    perform public.record_audit_event(rid, auth.uid(), 'member_joined');
    return query select 'joined', 'You joined the Room.';
  end if;
end $$;

-- Leave a Room. The Creator never can. (The guard for unsettled Shares comes with #014.)
create function public.leave_room(p_room_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;
  if exists (select 1 from public.rooms where id = p_room_id and creator_id = auth.uid()) then
    raise exception 'The Creator cannot leave the Room.' using errcode = '42501';
  end if;
  update public.room_members set left_at = now()
    where room_id = p_room_id and account_id = auth.uid() and left_at is null;
  if not found then
    raise exception 'You are not a Member of this Room.' using errcode = '42501';
  end if;
  perform public.record_audit_event(p_room_id, auth.uid(), 'member_left');
end $$;

revoke all on function public.join_room(text), public.leave_room(text) from public, anon;
grant execute on function public.join_room(text), public.leave_room(text) to authenticated;

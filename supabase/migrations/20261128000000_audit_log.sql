-- Audit log: an append-only record of what happened in a Room (ADR 0002).
-- Each entry keeps the actor's account id; Usernames are permanent, so the
-- Username shown for an entry never changes.

create table public.audit_log (
  id bigint generated always as identity primary key,
  room_id text not null references public.rooms (id) on delete restrict,
  actor_id uuid not null references public.accounts (id) on delete restrict,
  event_type text not null,
  created_at timestamptz not null default now(),
  constraint audit_event_type_format check (event_type ~ '^[a-z_]+$')
);

create index audit_log_room_idx on public.audit_log (room_id, created_at desc, id desc);

-- Insert-only, even for the table owner: updates, deletes and truncates are refused.
create function public.audit_log_refuse_change() returns trigger
language plpgsql as $$
begin
  raise exception 'The Audit log is append-only.' using errcode = '42501';
end $$;

create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function public.audit_log_refuse_change();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_refuse_change();

-- Only current Members of a Room can read its entries.
alter table public.audit_log enable row level security;
create policy audit_log_read on public.audit_log
  for select to authenticated using (public.is_room_member(room_id));

revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

-- How later features record their events. Not callable from the API.
create function public.record_audit_event(p_room_id text, p_actor_id uuid, p_event_type text) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (room_id, actor_id, event_type) values (p_room_id, p_actor_id, p_event_type);
$$;
revoke all on function public.record_audit_event(text, uuid, text) from public, anon, authenticated;

-- A Room's Audit log for its current Members, newest first, with the actor's Username.
create function public.room_audit_log(p_room_id text)
returns table (id bigint, actor_username text, event_type text, created_at timestamptz)
language sql stable set search_path = '' as $$
  select l.id, a.username, l.event_type, l.created_at
  from public.audit_log l
  join public.accounts a on a.id = l.actor_id
  where l.room_id = p_room_id
  order by l.created_at desc, l.id desc;
$$;
revoke all on function public.room_audit_log(text) from public, anon;
grant execute on function public.room_audit_log(text) to authenticated;

-- Creating a Room is the first event in its log.
create or replace function public.create_room() returns text
language plpgsql security definer set search_path = '' as $$
declare
  new_id text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;
  if not public.is_verified() then
    raise exception 'Verify your email before creating a Room.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.accounts where id = auth.uid()) then
    raise exception 'Choose a Username before creating a Room.' using errcode = '42501';
  end if;
  loop
    new_id := public.generate_room_id();
    begin
      insert into public.rooms (id, creator_id) values (new_id, auth.uid());
      exit;
    exception when unique_violation then
      null;
    end;
  end loop;
  insert into public.room_members (room_id, account_id) values (new_id, auth.uid());
  perform public.record_audit_event(new_id, auth.uid(), 'room_created');
  return new_id;
end $$;

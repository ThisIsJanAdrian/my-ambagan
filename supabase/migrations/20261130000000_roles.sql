-- Roles: promote, demote, kick (ADR 0002: rules live in Postgres).
-- The Creator is whoever rooms.creator_id says; a Moderator is a Member with
-- is_moderator set. Losing Membership (leaving or being kicked) clears the flag,
-- so anyone who rejoins comes back as a regular Member.

alter table public.room_members add column is_moderator boolean not null default false;

-- Audit entries about someone else (promotion, kick) record who was affected.
alter table public.audit_log add column target_id uuid references public.accounts (id) on delete restrict;

drop function public.record_audit_event(text, uuid, text);
create function public.record_audit_event(p_room_id text, p_actor_id uuid, p_event_type text, p_target_id uuid default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (room_id, actor_id, event_type, target_id)
  values (p_room_id, p_actor_id, p_event_type, p_target_id);
$$;
revoke all on function public.record_audit_event(text, uuid, text, uuid) from public, anon, authenticated;

drop function public.room_audit_log(text);
create function public.room_audit_log(p_room_id text)
returns table (id bigint, actor_username text, event_type text, target_username text, created_at timestamptz)
language sql stable set search_path = '' as $$
  select l.id, a.username, l.event_type, t.username, l.created_at
  from public.audit_log l
  join public.accounts a on a.id = l.actor_id
  left join public.accounts t on t.id = l.target_id
  where l.room_id = p_room_id
  order by l.created_at desc, l.id desc;
$$;
revoke all on function public.room_audit_log(text) from public, anon;
grant execute on function public.room_audit_log(text) to authenticated;

-- Only the Creator promotes a regular Member to Moderator. It cannot be undone by the Creator.
create function public.promote_member(p_room_id text, p_username text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  target public.room_members;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;
  perform 1 from public.rooms where id = p_room_id and creator_id = auth.uid() for update;
  if not found then
    raise exception 'Only the Creator can promote Members.' using errcode = '42501';
  end if;
  select m.* into target from public.room_members m
    join public.accounts a on a.id = m.account_id
    where m.room_id = p_room_id and m.left_at is null and a.username = lower(btrim(coalesce(p_username, '')));
  if not found then
    raise exception 'That person is not a Member of this Room.' using errcode = '42501';
  end if;
  if target.account_id = auth.uid() or target.is_moderator then
    raise exception 'That Member is already the Creator or a Moderator.' using errcode = '42501';
  end if;
  update public.room_members set is_moderator = true
    where room_id = p_room_id and account_id = target.account_id;
  perform public.record_audit_event(p_room_id, auth.uid(), 'member_promoted', target.account_id);
end $$;

-- A Moderator can step down; nobody can demote someone else.
create function public.demote_self(p_room_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;
  update public.room_members set is_moderator = false
    where room_id = p_room_id and account_id = auth.uid() and left_at is null and is_moderator;
  if not found then
    raise exception 'Only a Moderator can demote themselves.' using errcode = '42501';
  end if;
  perform public.record_audit_event(p_room_id, auth.uid(), 'moderator_demoted', auth.uid());
end $$;

-- The Creator can kick anyone but themselves; a Moderator can kick regular Members only.
-- (The guard for unsettled Shares comes with #014.)
create function public.kick_member(p_room_id text, p_username text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor_is_creator boolean;
  actor_is_moderator boolean;
  target public.room_members;
  target_is_creator boolean;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;
  perform 1 from public.rooms where id = p_room_id for update;
  actor_is_creator := exists (select 1 from public.rooms where id = p_room_id and creator_id = auth.uid());
  actor_is_moderator := exists (
    select 1 from public.room_members
    where room_id = p_room_id and account_id = auth.uid() and left_at is null and is_moderator);
  if not (actor_is_creator or actor_is_moderator) then
    raise exception 'You cannot kick Members.' using errcode = '42501';
  end if;
  select m.* into target from public.room_members m
    join public.accounts a on a.id = m.account_id
    where m.room_id = p_room_id and m.left_at is null and a.username = lower(btrim(coalesce(p_username, '')));
  if not found then
    raise exception 'That person is not a Member of this Room.' using errcode = '42501';
  end if;
  target_is_creator := exists (select 1 from public.rooms where id = p_room_id and creator_id = target.account_id);
  if target_is_creator then
    if actor_is_creator then
      raise exception 'The Creator cannot be kicked.' using errcode = '42501';
    end if;
    raise exception 'Moderators cannot kick the Creator.' using errcode = '42501';
  end if;
  if target.is_moderator and not actor_is_creator then
    raise exception 'Moderators cannot kick another Moderator.' using errcode = '42501';
  end if;
  update public.room_members set left_at = now(), is_moderator = false
    where room_id = p_room_id and account_id = target.account_id;
  perform public.record_audit_event(p_room_id, auth.uid(), 'member_kicked', target.account_id);
end $$;

-- Leaving also drops Moderator status.
create or replace function public.leave_room(p_room_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;
  if exists (select 1 from public.rooms where id = p_room_id and creator_id = auth.uid()) then
    raise exception 'The Creator cannot leave the Room.' using errcode = '42501';
  end if;
  update public.room_members set left_at = now(), is_moderator = false
    where room_id = p_room_id and account_id = auth.uid() and left_at is null;
  if not found then
    raise exception 'You are not a Member of this Room.' using errcode = '42501';
  end if;
  perform public.record_audit_event(p_room_id, auth.uid(), 'member_left');
end $$;

revoke all on function public.promote_member(text, text), public.demote_self(text), public.kick_member(text, text) from public, anon;
grant execute on function public.promote_member(text, text), public.demote_self(text), public.kick_member(text, text) to authenticated;

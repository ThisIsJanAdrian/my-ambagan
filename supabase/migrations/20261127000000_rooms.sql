-- Rooms: a group of Members sharing a ledger, identified by a Room ID.
-- Rules live here, not in app code (ADR 0002).

-- The curated word list for Room IDs. Five-letter lowercase words only, with
-- offensive words left out. Nobody but the table owner can change it.
create table public.room_words (
  word text primary key,
  constraint room_word_format check (word ~ '^[a-z]{5}$')
);

insert into public.room_words (word) values
  ('quick'), ('snake'), ('boots'), ('power'), ('apple'), ('beach'), ('brave'), ('bread'),
  ('brick'), ('bring'), ('brook'), ('broom'), ('brush'), ('cabin'), ('candy'), ('canoe'),
  ('cargo'), ('chair'), ('chalk'), ('charm'), ('cheer'), ('chess'), ('chief'), ('clean'),
  ('clear'), ('clerk'), ('cliff'), ('climb'), ('clock'), ('cloud'), ('coast'), ('coral'),
  ('couch'), ('crane'), ('crisp'), ('crown'), ('daisy'), ('dance'), ('delta'), ('diary'),
  ('dream'), ('dress'), ('drift'), ('eagle'), ('earth'), ('ember'), ('fable'), ('fairy'),
  ('feast'), ('fence'), ('fiber'), ('field'), ('flame'), ('flint'), ('float'), ('flock'),
  ('flute'), ('focus'), ('frost'), ('fruit'), ('giant'), ('glade'), ('gleam'), ('globe'),
  ('grace'), ('grain'), ('grape'), ('grass'), ('green'), ('grove'), ('happy'), ('hazel'),
  ('heart'), ('hedge'), ('honey'), ('horse'), ('house'), ('humor'), ('ivory'), ('jolly'),
  ('judge'), ('juice'), ('kayak'), ('kneel'), ('lemon'), ('level'), ('light'), ('lilac'),
  ('lunar'), ('magic'), ('maple'), ('march'), ('marsh'), ('melon'), ('merry'), ('mirth'),
  ('misty'), ('moose'), ('mount'), ('music'), ('noble'), ('north'), ('novel'), ('oasis'),
  ('ocean'), ('olive'), ('onion'), ('orbit'), ('otter'), ('paint'), ('panda'), ('paper'),
  ('pearl'), ('pedal'), ('piano'), ('pilot'), ('plain'), ('plant'), ('plaza'), ('plume'),
  ('polar'), ('pride'), ('pulse'), ('quail'), ('quest'), ('quiet'), ('quilt'), ('radio'),
  ('rainy'), ('ranch'), ('raven'), ('reach'), ('relay'), ('river'), ('robin'), ('rocky'),
  ('round'), ('royal'), ('sandy'), ('scout'), ('shade'), ('shell'), ('shine'), ('skate'),
  ('sleek'), ('smile'), ('solar'), ('spark'), ('spice'), ('spoon'), ('sport'), ('spray'),
  ('stage'), ('stamp'), ('steam'), ('steel'), ('stone'), ('storm'), ('story'), ('sugar'),
  ('sunny'), ('swami'), ('sweet'), ('swift'), ('table'), ('tango'), ('tiger'), ('toast'),
  ('torch'), ('tower'), ('trail'), ('tulip'), ('umbra'), ('unity'), ('urban'), ('valid'),
  ('vapor'), ('vivid'), ('voice'), ('water'), ('wheat'), ('whale'), ('wheel'), ('windy'),
  ('wings'), ('world'), ('yacht'), ('young'), ('zebra'), ('zesty');

alter table public.room_words enable row level security;
revoke all on public.room_words from anon, authenticated;

create table public.rooms (
  id text primary key,
  creator_id uuid not null references public.accounts (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint room_id_format check (id ~ '^[a-z]{5}(-[a-z]{5}){3}$')
);

-- A Member is an Account that has joined a Room.
create table public.room_members (
  room_id text not null references public.rooms (id) on delete restrict,
  account_id uuid not null references public.accounts (id) on delete restrict,
  joined_at timestamptz not null default now(),
  primary key (room_id, account_id)
);

create index room_members_account_idx on public.room_members (account_id);

-- Membership check that bypasses RLS, so policies on both tables can use it without recursion.
create function public.is_room_member(p_room_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_members
    where room_id = p_room_id and account_id = auth.uid()
  );
$$;

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;

-- Members see their Rooms and who else is in them; nobody sees other Rooms.
create policy rooms_read on public.rooms
  for select to authenticated using (public.is_room_member(id));
create policy room_members_read on public.room_members
  for select to authenticated using (public.is_room_member(room_id));

revoke all on public.rooms, public.room_members from anon, authenticated;
grant select on public.rooms, public.room_members to authenticated;

-- Four different random words from the curated list joined by hyphens; retries until the ID is unused.
create function public.generate_room_id() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  candidate text;
begin
  loop
    select string_agg(word, '-') into candidate from (
      select word from public.room_words order by random() limit 4
    ) picked;
    exit when not exists (select 1 from public.rooms where id = candidate);
  end loop;
  return candidate;
end $$;

create function public.create_room() returns text
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
      -- A concurrent create took this ID between generation and insert; pick again.
      null;
    end;
  end loop;
  insert into public.room_members (room_id, account_id) values (new_id, auth.uid());
  return new_id;
end $$;

revoke all on function public.generate_room_id(), public.is_room_member(text) from public, anon;
revoke all on function public.generate_room_id() from authenticated;
grant execute on function public.is_room_member(text) to authenticated;
revoke all on function public.create_room() from public, anon;
grant execute on function public.create_room() to authenticated;

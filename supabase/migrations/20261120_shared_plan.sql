-- Wedding seating: one shared plan protected by an edit passcode.
-- Tables have RLS ON and NO policies, so the public (anon) key cannot read or write them directly.
-- The app only talks to the database through get_plan / save_plan, which check the passcode first.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.plans (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text
);
create table if not exists public.plan_secrets (
  plan_id text primary key references public.plans(id) on delete cascade,
  passcode_hash text            -- bcrypt hash; NULL = passcode not set yet
);
create table if not exists public.plan_failed_attempts (
  id bigint generated always as identity primary key,
  plan_id text not null,
  at timestamptz not null default now()
);
create index if not exists plan_failed_attempts_at on public.plan_failed_attempts (plan_id, at);

alter table public.plans enable row level security;
alter table public.plan_secrets enable row level security;
alter table public.plan_failed_attempts enable row level security;
revoke all on public.plans, public.plan_secrets, public.plan_failed_attempts from anon, authenticated, public;

insert into public.plans (id) values ('main') on conflict do nothing;
insert into public.plan_secrets (plan_id) values ('main') on conflict do nothing;

-- internal: 'ok' | 'bad' | 'not_set' | 'locked' | 'no_plan'
create or replace function public._check_passcode(p_plan text, p_passcode text)
returns text language plpgsql security definer set search_path = '' as $$
declare h text; fails int;
begin
  select passcode_hash into h from public.plan_secrets where plan_id = p_plan;
  if not found then return 'no_plan'; end if;
  if h is null then return 'not_set'; end if;
  -- slow down guessing: max 20 wrong tries per 10 minutes per plan
  select count(*) into fails from public.plan_failed_attempts where plan_id = p_plan and at > now() - interval '10 minutes';
  if fails >= 20 then return 'locked'; end if;
  if p_passcode is not null and extensions.crypt(p_passcode, h) = h then return 'ok'; end if;
  insert into public.plan_failed_attempts (plan_id) values (p_plan);
  delete from public.plan_failed_attempts where at < now() - interval '1 day';
  return 'bad';
end $$;

create or replace function public.get_plan(p_passcode text, p_plan text default 'main')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare st text; r public.plans;
begin
  st := public._check_passcode(p_plan, p_passcode);
  if st <> 'ok' then return jsonb_build_object('status', st); end if;
  select * into r from public.plans where id = p_plan;
  return jsonb_build_object('status', 'ok', 'data', r.data, 'version', r.version, 'updated_at', r.updated_at, 'updated_by', r.updated_by);
end $$;

-- Saves only if nobody else saved since base_version; otherwise returns the latest plan
-- (status 'conflict') so the app can re-apply its own changes on top and try again.
create or replace function public.save_plan(p_passcode text, p_data jsonb, p_base_version integer, p_by text default null, p_plan text default 'main')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare st text; r public.plans;
begin
  st := public._check_passcode(p_plan, p_passcode);
  if st <> 'ok' then return jsonb_build_object('status', st); end if;
  if jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) > 2000000 then
    return jsonb_build_object('status', 'invalid');
  end if;
  update public.plans set data = p_data, version = version + 1, updated_at = now(), updated_by = left(p_by, 60)
    where id = p_plan and version = p_base_version
    returning * into r;
  if found then return jsonb_build_object('status', 'ok', 'version', r.version); end if;
  select * into r from public.plans where id = p_plan;
  return jsonb_build_object('status', 'conflict', 'data', r.data, 'version', r.version, 'updated_by', r.updated_by);
end $$;

-- Admin only (SQL editor / service role). Not callable with the public key.
-- select public.set_passcode('the passcode');   -- or NULL to switch editing off
create or replace function public.set_passcode(p_new text, p_plan text default 'main')
returns text language plpgsql security definer set search_path = '' as $$
begin
  if p_new is not null and length(p_new) < 6 then raise exception 'Passcode must be at least 6 characters'; end if;
  insert into public.plans (id) values (p_plan) on conflict do nothing;
  insert into public.plan_secrets (plan_id, passcode_hash)
    values (p_plan, case when p_new is null then null else extensions.crypt(p_new, extensions.gen_salt('bf', 10)) end)
    on conflict (plan_id) do update set passcode_hash = excluded.passcode_hash;
  delete from public.plan_failed_attempts where plan_id = p_plan;
  return case when p_new is null then 'passcode cleared' else 'passcode set' end;
end $$;

revoke all on function public._check_passcode(text, text) from public, anon, authenticated;
revoke all on function public.set_passcode(text, text) from public, anon, authenticated;
revoke all on function public.get_plan(text, text) from public;
revoke all on function public.save_plan(text, jsonb, integer, text, text) from public;
grant execute on function public.get_plan(text, text) to anon, authenticated;
grant execute on function public.save_plan(text, jsonb, integer, text, text) to anon, authenticated;

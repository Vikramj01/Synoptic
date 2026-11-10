-- Synoptic migration 1/4: tenancy, roles, invitations and the access helpers
-- every other table's RLS policies are built on.
--
-- Model:  agency -> workspace (client) -> project (brand + domain)
-- Roles:  agency_members.role     operator | analyst   (agency staff)
--         workspace_members.role  analyst  | viewer    (assignment to a client)
--   * operator: full access to every workspace in their agency
--   * analyst : read/write only in workspaces they are assigned to
--   * viewer  : read-only, only in workspaces they are assigned to
--
-- Bootstrapping: the first agency + operator row is created by a service-role
-- script (no INSERT policy on agencies / first agency_members row by design).

create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- tables

create table public.agencies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- Default timezone for schedules and reporting periods (open question 4).
  timezone    text not null default 'UTC',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.workspaces (
  id                    uuid primary key default gen_random_uuid(),
  agency_id             uuid not null references public.agencies (id) on delete cascade,
  name                  text not null,
  archived_at           timestamptz,
  -- Hard-stop monthly credit budget for the whole workspace (FR-14). null = none.
  monthly_credit_budget numeric(12,2) check (monthly_credit_budget is null or monthly_credit_budget >= 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index workspaces_agency_id_idx on public.workspaces (agency_id);

create table public.agency_members (
  agency_id   uuid not null references public.agencies (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('operator', 'analyst')),
  created_at  timestamptz not null default now(),
  primary key (agency_id, user_id)
);
create index agency_members_user_id_idx on public.agency_members (user_id);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null check (role in ('analyst', 'viewer')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_id_idx on public.workspace_members (user_id);

-- Invite flow (FR-2). Only a hash of the token is stored.
create table public.invitations (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies (id) on delete cascade,
  workspace_id  uuid references public.workspaces (id) on delete cascade,
  email         text not null,
  -- operator/analyst => agency staff invite; viewer => client invite (needs workspace_id)
  role          text not null check (role in ('operator', 'analyst', 'viewer')),
  token_hash    text not null unique,
  invited_by    uuid references auth.users (id) on delete set null,
  expires_at    timestamptz not null default (now() + interval '7 days'),
  accepted_at   timestamptz,
  created_at    timestamptz not null default now(),
  check (role <> 'viewer' or workspace_id is not null)
);
create index invitations_agency_id_idx on public.invitations (agency_id);
create index invitations_workspace_id_idx on public.invitations (workspace_id);

create trigger agencies_updated_at before update on public.agencies
  for each row execute function private.set_updated_at();
create trigger workspaces_updated_at before update on public.workspaces
  for each row execute function private.set_updated_at();

-- ------------------------------------------------------- access helpers
-- SECURITY DEFINER so policies can look up membership without recursing
-- through the membership tables' own RLS.

create or replace function private.agency_role(p_agency uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select role from public.agency_members
  where agency_id = p_agency and user_id = (select auth.uid());
$$;

-- 'operator' | 'analyst' | 'viewer' | null for the current user in a workspace.
create or replace function private.workspace_role(p_workspace uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from public.workspaces w
      join public.agency_members am on am.agency_id = w.agency_id
      where w.id = p_workspace
        and am.user_id = (select auth.uid())
        and am.role = 'operator'
    ) then 'operator'
    else (
      select wm.role from public.workspace_members wm
      where wm.workspace_id = p_workspace
        and wm.user_id = (select auth.uid())
    )
  end;
$$;

create or replace function private.can_read_workspace(p_workspace uuid)
returns boolean
language sql stable
set search_path = ''
as $$ select private.workspace_role(p_workspace) is not null; $$;

create or replace function private.can_write_workspace(p_workspace uuid)
returns boolean
language sql stable
set search_path = ''
as $$ select coalesce(private.workspace_role(p_workspace) in ('operator', 'analyst'), false); $$;

create or replace function private.is_workspace_operator(p_workspace uuid)
returns boolean
language sql stable
set search_path = ''
as $$ select coalesce(private.workspace_role(p_workspace) = 'operator', false); $$;

revoke all on function private.agency_role(uuid), private.workspace_role(uuid),
  private.can_read_workspace(uuid), private.can_write_workspace(uuid),
  private.is_workspace_operator(uuid) from public;
grant execute on function private.agency_role(uuid), private.workspace_role(uuid),
  private.can_read_workspace(uuid), private.can_write_workspace(uuid),
  private.is_workspace_operator(uuid) to authenticated;

-- ------------------------------------------------------------------ RLS

alter table public.agencies          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.agency_members    enable row level security;
alter table public.workspace_members enable row level security;
alter table public.invitations       enable row level security;

-- agencies: staff can see their agency; operators can edit it.
create policy agencies_select on public.agencies for select to authenticated
  using (private.agency_role(id) is not null);
create policy agencies_update on public.agencies for update to authenticated
  using (private.agency_role(id) = 'operator')
  with check (private.agency_role(id) = 'operator');

-- workspaces: anyone with access to the workspace can read it (incl. viewers);
-- only operators create/edit/archive/delete.
create policy workspaces_select on public.workspaces for select to authenticated
  using (private.can_read_workspace(id));
create policy workspaces_insert on public.workspaces for insert to authenticated
  with check (private.agency_role(agency_id) = 'operator');
create policy workspaces_update on public.workspaces for update to authenticated
  using (private.agency_role(agency_id) = 'operator')
  with check (private.agency_role(agency_id) = 'operator');
create policy workspaces_delete on public.workspaces for delete to authenticated
  using (private.agency_role(agency_id) = 'operator');

-- agency_members: see your own row; operators manage the agency's staff.
create policy agency_members_select on public.agency_members for select to authenticated
  using (user_id = (select auth.uid()) or private.agency_role(agency_id) = 'operator');
create policy agency_members_insert on public.agency_members for insert to authenticated
  with check (private.agency_role(agency_id) = 'operator');
create policy agency_members_update on public.agency_members for update to authenticated
  using (private.agency_role(agency_id) = 'operator')
  with check (private.agency_role(agency_id) = 'operator');
create policy agency_members_delete on public.agency_members for delete to authenticated
  using (private.agency_role(agency_id) = 'operator');

-- workspace_members: see your own row; operators manage assignments.
create policy workspace_members_select on public.workspace_members for select to authenticated
  using (user_id = (select auth.uid()) or private.is_workspace_operator(workspace_id));
create policy workspace_members_insert on public.workspace_members for insert to authenticated
  with check (private.is_workspace_operator(workspace_id));
create policy workspace_members_update on public.workspace_members for update to authenticated
  using (private.is_workspace_operator(workspace_id))
  with check (private.is_workspace_operator(workspace_id));
create policy workspace_members_delete on public.workspace_members for delete to authenticated
  using (private.is_workspace_operator(workspace_id));

-- invitations: operators only. Accepting an invite is done server-side
-- (service role) after validating the token hash.
create policy invitations_all on public.invitations for all to authenticated
  using (private.agency_role(agency_id) = 'operator')
  with check (private.agency_role(agency_id) = 'operator');

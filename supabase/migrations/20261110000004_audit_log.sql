-- Synoptic migration 4/4: audit log (FR-25) and triggers that record key
-- actions: invites, membership changes, schedule/budget changes, archiving.

create table public.audit_log (
  id            bigint generated always as identity primary key,
  agency_id     uuid not null references public.agencies (id) on delete cascade,
  workspace_id  uuid references public.workspaces (id) on delete set null,
  actor_id      uuid,                    -- auth.uid() at the time; null for service-role/system
  action        text not null,           -- e.g. 'workspace_members.insert'
  entity_type   text not null,
  entity_id     text,
  detail        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index audit_log_agency_created_idx on public.audit_log (agency_id, created_at desc);
create index audit_log_workspace_created_idx on public.audit_log (workspace_id, created_at desc);

alter table public.audit_log enable row level security;

-- Operators read their agency's log. Nobody writes through the API; rows come
-- from the triggers below (SECURITY DEFINER) or the service role.
create policy audit_log_select on public.audit_log for select to authenticated
  using (private.agency_role(agency_id) = 'operator');

create or replace function private.audit_row()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row       jsonb;
  v_agency    uuid;
  v_workspace uuid;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;

  -- Never log secrets.
  v_row := v_row - 'token_hash';

  v_agency    := nullif(v_row ->> 'agency_id', '')::uuid;
  v_workspace := nullif(v_row ->> 'workspace_id', '')::uuid;

  if tg_table_name = 'workspaces' then
    v_workspace := nullif(v_row ->> 'id', '')::uuid;
  end if;

  if v_agency is null and v_workspace is not null then
    select w.agency_id into v_agency from public.workspaces w where w.id = v_workspace;
  end if;

  -- Row is going away together with its agency/workspace; nothing to attach to.
  if v_agency is null then
    return null;
  end if;

  insert into public.audit_log (agency_id, workspace_id, actor_id, action, entity_type, entity_id, detail)
  values (
    v_agency,
    v_workspace,
    (select auth.uid()),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', concat_ws(':', v_row ->> 'agency_id', v_row ->> 'workspace_id', v_row ->> 'user_id')),
    jsonb_build_object('row', v_row)
  );
  return null;
end;
$$;

revoke all on function private.audit_row() from public, authenticated;

create trigger audit_agency_members
  after insert or update or delete on public.agency_members
  for each row execute function private.audit_row();
create trigger audit_workspace_members
  after insert or update or delete on public.workspace_members
  for each row execute function private.audit_row();
create trigger audit_invitations
  after insert or update or delete on public.invitations
  for each row execute function private.audit_row();
create trigger audit_workspaces
  after insert or update of name, archived_at, monthly_credit_budget or delete on public.workspaces
  for each row execute function private.audit_row();
create trigger audit_projects
  after insert or update of schedule, schedule_hour, schedule_dow, timezone, monthly_credit_budget, archived_at or delete on public.projects
  for each row execute function private.audit_row();

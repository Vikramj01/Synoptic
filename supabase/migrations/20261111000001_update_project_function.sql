-- Synoptic migration 8: edit a project's configuration atomically.
--
-- SECURITY INVOKER: runs as the signed-in user, so RLS decides who may edit
-- (operators and analysts of the workspace; viewers are refused).
--
-- History is preserved: prompts, markets and engines that are removed are
-- deactivated or deleted without touching past scan runs, and prompts that
-- stay keep their ids (tasks reference them).
--   * engines      replaced (nothing references them)
--   * markets      deactivated, not deleted (rows may be re-enabled later)
--   * prompts      matched by text; removed ones are deactivated, new ones added
--   * prompt_markets  re-synced to the selected markets for every active prompt
--   * competitors  matched by name; existing aliases/domains are kept

create or replace function public.update_project(
  p_project       uuid,
  p_name          text,
  p_brand_name    text,
  p_brand_aliases text[],
  p_domains       text[],
  p_engines       text[],
  p_countries     text[],
  p_competitors   text[],
  p_prompts       text[],
  p_monthly_credit_budget numeric default null
)
returns void
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  if coalesce(array_length(p_engines, 1), 0) = 0 then
    raise exception 'Select at least one engine' using errcode = '22023';
  end if;
  if coalesce(array_length(p_countries, 1), 0) = 0 then
    raise exception 'Select at least one market' using errcode = '22023';
  end if;

  select workspace_id into v_ws from public.projects where id = p_project;
  if v_ws is null then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  update public.projects
     set name = p_name,
         brand_name = p_brand_name,
         brand_aliases = coalesce(p_brand_aliases, '{}'),
         domains = coalesce(p_domains, '{}')
   where id = p_project;
  -- RLS filters rows silently: a viewer sees the project but updates nothing.
  if not found then
    raise exception 'permission denied to edit this project' using errcode = '42501';
  end if;

  -- Only touch the budget column when it changes, so the audit trigger
  -- records real budget changes rather than every save.
  update public.projects
     set monthly_credit_budget = p_monthly_credit_budget
   where id = p_project
     and monthly_credit_budget is distinct from p_monthly_credit_budget;

  -- engines
  delete from public.project_engines where project_id = p_project and engine <> all (p_engines);
  insert into public.project_engines (project_id, workspace_id, engine)
  select p_project, v_ws, e from unnest(p_engines) as e
  on conflict (project_id, engine) do nothing;

  -- markets
  update public.project_markets set active = (country = any (p_countries)) where project_id = p_project;
  insert into public.project_markets (project_id, workspace_id, country, active)
  select p_project, v_ws, c, true from unnest(p_countries) as c
  on conflict (project_id, country) do update set active = true;

  -- competitors (by name)
  delete from public.competitors where project_id = p_project and name <> all (coalesce(p_competitors, '{}'));
  insert into public.competitors (project_id, workspace_id, name)
  select p_project, v_ws, n from unnest(coalesce(p_competitors, '{}')) as n
  where not exists (select 1 from public.competitors c where c.project_id = p_project and c.name = n);

  -- prompts (by text)
  update public.prompts set active = (text = any (coalesce(p_prompts, '{}'))) where project_id = p_project;
  insert into public.prompts (project_id, workspace_id, text)
  select p_project, v_ws, t from unnest(coalesce(p_prompts, '{}')) as t
  where not exists (select 1 from public.prompts r where r.project_id = p_project and r.text = t);

  -- prompt markets for every active prompt follow the selected markets
  update public.prompt_markets pm
     set active = (pm.country = any (p_countries))
    from public.prompts pr
   where pr.id = pm.prompt_id and pr.project_id = p_project;
  insert into public.prompt_markets (prompt_id, workspace_id, country)
  select pr.id, v_ws, c
    from public.prompts pr cross join unnest(p_countries) as c
   where pr.project_id = p_project and pr.active
  on conflict (prompt_id, country) do update set active = true;
end;
$$;

revoke all on function public.update_project(uuid, text, text, text[], text[], text[], text[], text[], text[], numeric)
  from public, anon;
grant execute on function public.update_project(uuid, text, text, text[], text[], text[], text[], text[], text[], numeric)
  to authenticated;

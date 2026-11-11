-- Synoptic migration 9: competitors carry domains and aliases.
--
-- create_project / update_project took competitor NAMES only (text[]), so a
-- competitor's domains and aliases could not be set from the app and cited
-- sources were never labelled "competitor". They now take a JSON array:
--   [{"name": "Ideogram", "domains": ["ideogram.ai"], "aliases": ["Ideogram AI"]}, ...]
-- `domains` and `aliases` are optional per element.
--
-- The argument type changes, so the old functions are dropped first (a plain
-- CREATE OR REPLACE would add an overload and make the REST call ambiguous).
-- The form is now the source of truth: competitors are matched by name, and
-- their domains/aliases are replaced with what the form sends.

drop function if exists public.create_project(uuid, text, text, text[], text[], text[], text[], text[], text[], numeric);
drop function if exists public.update_project(uuid, text, text, text[], text[], text[], text[], text[], text[], numeric);

create function public.create_project(
  p_workspace     uuid,
  p_name          text,
  p_brand_name    text,
  p_brand_aliases text[],
  p_domains       text[],
  p_engines       text[],
  p_countries     text[],
  p_competitors   jsonb,
  p_prompts       text[],
  p_monthly_credit_budget numeric default null
)
returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_project uuid;
  v_prompt  uuid;
  v_text    text;
begin
  if coalesce(array_length(p_engines, 1), 0) = 0 then
    raise exception 'Select at least one engine' using errcode = '22023';
  end if;
  if coalesce(array_length(p_countries, 1), 0) = 0 then
    raise exception 'Select at least one market' using errcode = '22023';
  end if;
  if p_competitors is not null and jsonb_typeof(p_competitors) <> 'array' then
    raise exception 'Competitors must be a JSON array' using errcode = '22023';
  end if;

  insert into public.projects (workspace_id, name, brand_name, brand_aliases, domains, monthly_credit_budget)
  values (p_workspace, p_name, p_brand_name, coalesce(p_brand_aliases, '{}'), coalesce(p_domains, '{}'),
          p_monthly_credit_budget)
  returning id into v_project;

  insert into public.project_engines (project_id, workspace_id, engine)
  select v_project, p_workspace, e from unnest(p_engines) as e;

  insert into public.project_markets (project_id, workspace_id, country)
  select v_project, p_workspace, c from unnest(p_countries) as c;

  insert into public.competitors (project_id, workspace_id, name, aliases, domains)
  select v_project, p_workspace, btrim(c ->> 'name'),
         array(select jsonb_array_elements_text(coalesce(c -> 'aliases', '[]'::jsonb))),
         array(select jsonb_array_elements_text(coalesce(c -> 'domains', '[]'::jsonb)))
    from jsonb_array_elements(coalesce(p_competitors, '[]'::jsonb)) as c
   where nullif(btrim(c ->> 'name'), '') is not null;

  foreach v_text in array coalesce(p_prompts, '{}') loop
    insert into public.prompts (project_id, workspace_id, text)
    values (v_project, p_workspace, v_text)
    returning id into v_prompt;

    insert into public.prompt_markets (prompt_id, workspace_id, country)
    select v_prompt, p_workspace, c from unnest(p_countries) as c;
  end loop;

  return v_project;
end;
$$;

create function public.update_project(
  p_project       uuid,
  p_name          text,
  p_brand_name    text,
  p_brand_aliases text[],
  p_domains       text[],
  p_engines       text[],
  p_countries     text[],
  p_competitors   jsonb,
  p_prompts       text[],
  p_monthly_credit_budget numeric default null
)
returns void
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_ws   uuid;
  v_comp jsonb := coalesce(p_competitors, '[]'::jsonb);
begin
  if coalesce(array_length(p_engines, 1), 0) = 0 then
    raise exception 'Select at least one engine' using errcode = '22023';
  end if;
  if coalesce(array_length(p_countries, 1), 0) = 0 then
    raise exception 'Select at least one market' using errcode = '22023';
  end if;
  if jsonb_typeof(v_comp) <> 'array' then
    raise exception 'Competitors must be a JSON array' using errcode = '22023';
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

  -- competitors, matched by name; aliases and domains follow the form
  delete from public.competitors
   where project_id = p_project
     and name <> all (array(select btrim(c ->> 'name') from jsonb_array_elements(v_comp) as c));

  update public.competitors cp
     set aliases = array(select jsonb_array_elements_text(coalesce(c -> 'aliases', '[]'::jsonb))),
         domains = array(select jsonb_array_elements_text(coalesce(c -> 'domains', '[]'::jsonb)))
    from jsonb_array_elements(v_comp) as c
   where cp.project_id = p_project and cp.name = btrim(c ->> 'name');

  insert into public.competitors (project_id, workspace_id, name, aliases, domains)
  select p_project, v_ws, btrim(c ->> 'name'),
         array(select jsonb_array_elements_text(coalesce(c -> 'aliases', '[]'::jsonb))),
         array(select jsonb_array_elements_text(coalesce(c -> 'domains', '[]'::jsonb)))
    from jsonb_array_elements(v_comp) as c
   where nullif(btrim(c ->> 'name'), '') is not null
     and not exists (select 1 from public.competitors x where x.project_id = p_project and x.name = btrim(c ->> 'name'));

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

revoke all on function public.create_project(uuid, text, text, text[], text[], text[], text[], jsonb, text[], numeric)
  from public, anon;
grant execute on function public.create_project(uuid, text, text, text[], text[], text[], text[], jsonb, text[], numeric)
  to authenticated;

revoke all on function public.update_project(uuid, text, text, text[], text[], text[], text[], jsonb, text[], numeric)
  from public, anon;
grant execute on function public.update_project(uuid, text, text, text[], text[], text[], text[], jsonb, text[], numeric)
  to authenticated;

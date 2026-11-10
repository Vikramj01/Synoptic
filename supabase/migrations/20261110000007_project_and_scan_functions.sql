-- Synoptic migration 7: functions the app calls.
--
--   public.workspace_role(ws)        caller's role in a workspace (for app-side checks)
--   public.create_project(...)       project + engines + markets + competitors + prompts, atomically
--   public.refresh_daily_rollups()   recompute one project/day of rollups (service role only)
--
-- workspace_role and create_project are SECURITY INVOKER: they run as the
-- signed-in user, so RLS decides what is allowed. Nothing here bypasses it.

create or replace function public.workspace_role(p_workspace uuid)
returns text
language sql stable security invoker
set search_path = ''
as $$ select private.workspace_role(p_workspace); $$;

create or replace function public.create_project(
  p_workspace     uuid,
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

  insert into public.projects (workspace_id, name, brand_name, brand_aliases, domains, monthly_credit_budget)
  values (p_workspace, p_name, p_brand_name, coalesce(p_brand_aliases, '{}'), coalesce(p_domains, '{}'),
          p_monthly_credit_budget)
  returning id into v_project;

  insert into public.project_engines (project_id, workspace_id, engine)
  select v_project, p_workspace, e from unnest(p_engines) as e;

  insert into public.project_markets (project_id, workspace_id, country)
  select v_project, p_workspace, c from unnest(p_countries) as c;

  insert into public.competitors (project_id, workspace_id, name)
  select v_project, p_workspace, n from unnest(coalesce(p_competitors, '{}')) as n;

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

-- Recompute rollups for one project and UTC day from answers + analysis.
-- Idempotent (delete + insert in one transaction), so no read-modify-write races.
-- Reporting day is UTC for now; per-agency/project timezones are an open question.
create or replace function public.refresh_daily_rollups(p_project uuid, p_day date)
returns void
language sql security invoker
set search_path = ''
as $$
  delete from public.daily_rollups where project_id = p_project and day = p_day;

  insert into public.daily_rollups
    (project_id, workspace_id, engine, country, day, answers_n, mentions_n, citations_n, rank_sum, rank_n)
  select
    a.project_id, a.workspace_id, a.engine, a.country, p_day,
    count(*),
    count(*) filter (where an.brand_mentioned),
    count(*) filter (where an.domain_cited),
    coalesce(sum(an.mention_rank), 0),
    count(an.mention_rank)
  from public.answers a
  join public.answer_analysis an on an.answer_id = a.id
  where a.project_id = p_project
    and (a.answered_at at time zone 'UTC')::date = p_day
  group by a.project_id, a.workspace_id, a.engine, a.country;
$$;

revoke all on function public.workspace_role(uuid) from public, anon;
grant execute on function public.workspace_role(uuid) to authenticated;

revoke all on function public.create_project(uuid, text, text, text[], text[], text[], text[], text[], text[], numeric)
  from public, anon;
grant execute on function public.create_project(uuid, text, text, text[], text[], text[], text[], text[], text[], numeric)
  to authenticated;

revoke all on function public.refresh_daily_rollups(uuid, date) from public, anon, authenticated;
grant execute on function public.refresh_daily_rollups(uuid, date) to service_role;

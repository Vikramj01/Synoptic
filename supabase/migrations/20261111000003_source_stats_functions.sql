-- Synoptic migration 10: citation / source analysis (FR-18).
--
--   public.source_stats(...)    top cited domains or pages, with per-engine counts
--   public.source_summary(...)  headline numbers for the same scope
--
-- Both are read-only and SECURITY INVOKER: they run as the signed-in user, so
-- RLS decides which sources are visible (view-only client users included).
-- Scope filters are all optional: a scan run, an engine, a market, a source type.

create or replace function public.source_stats(
  p_project  uuid,
  p_scan_run uuid    default null,
  p_engine   text    default null,
  p_country  text    default null,
  p_role     text    default null,      -- 'client' | 'competitor' | 'other'
  p_by       text    default 'domain',  -- 'domain' | 'url'
  p_limit    integer default 25
)
returns table (
  item       text,     -- the domain, or the full URL when p_by = 'url'
  host       text,
  kind       text,     -- client | competitor | other
  citations  bigint,   -- times cited
  answers    bigint,   -- distinct answers that cited it
  by_engine  jsonb     -- {"chatgpt": 5, "gemini": 3}
)
language sql stable security invoker
set search_path = ''
as $$
  with base as (
    select case when p_by = 'url' then s.url else s.domain end as k,
           s.domain as d, s.domain_role as r, s.answer_id as aid, a.engine as e
      from public.sources s
      join public.answers a on a.id = s.answer_id
      join public.tasks   t on t.id = a.task_id
     where s.project_id = p_project
       and (p_scan_run is null or t.scan_run_id = p_scan_run)
       and (p_engine   is null or a.engine = p_engine)
       and (p_country  is null or a.country = p_country)
       and (p_role     is null or s.domain_role = p_role)
  ), per_engine as (
    select k, e, count(*) as n from base group by k, e
  ), per_key as (
    select k, max(d) as d, max(r) as r, count(*) as c, count(distinct aid) as a
      from base group by k
  )
  select pk.k, pk.d, pk.r, pk.c, pk.a,
         (select jsonb_object_agg(pe.e, pe.n) from per_engine pe where pe.k = pk.k)
    from per_key pk
   order by pk.c desc, pk.a desc, pk.k
   limit least(greatest(coalesce(p_limit, 25), 1), 200);
$$;

create or replace function public.source_summary(
  p_project  uuid,
  p_scan_run uuid default null,
  p_engine   text default null,
  p_country  text default null
)
returns table (
  answers               bigint,  -- answers in scope (even those with no sources)
  citations             bigint,
  domains               bigint,  -- distinct cited domains
  client_citations      bigint,
  competitor_citations  bigint,
  other_citations       bigint,
  answers_citing_client bigint   -- distinct answers that cite one of the client's domains
)
language sql stable security invoker
set search_path = ''
as $$
  with scoped as (
    select a.id as aid
      from public.answers a
      join public.tasks t on t.id = a.task_id
     where a.project_id = p_project
       and (p_scan_run is null or t.scan_run_id = p_scan_run)
       and (p_engine   is null or a.engine = p_engine)
       and (p_country  is null or a.country = p_country)
  ), src as (
    select s.domain as d, s.domain_role as r, s.answer_id as aid
      from public.sources s
      join scoped sc on sc.aid = s.answer_id
     where s.project_id = p_project
  )
  select (select count(*) from scoped),
         (select count(*) from src),
         (select count(distinct d) from src),
         (select count(*) from src where r = 'client'),
         (select count(*) from src where r = 'competitor'),
         (select count(*) from src where r = 'other'),
         (select count(distinct aid) from src where r = 'client');
$$;

revoke all on function public.source_stats(uuid, uuid, text, text, text, text, integer) from public, anon;
grant execute on function public.source_stats(uuid, uuid, text, text, text, text, integer) to authenticated;
revoke all on function public.source_summary(uuid, uuid, text, text) from public, anon;
grant execute on function public.source_summary(uuid, uuid, text, text) to authenticated;

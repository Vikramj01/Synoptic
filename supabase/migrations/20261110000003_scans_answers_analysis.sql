-- Synoptic migration 3/4: scan runs, tasks, answers, sources, analysis,
-- credit ledger and daily rollups.
--
-- All of these are written by the server (service role: dispatcher, webhook
-- receiver, reconciler, analysis jobs). Authenticated users only get SELECT,
-- scoped to workspaces they can read. There are deliberately no insert/update/
-- delete policies, so a client viewer (or analyst) cannot tamper with results.

create table public.scan_runs (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null,
  workspace_id       uuid not null,
  trigger            text not null check (trigger in ('manual', 'schedule')),
  status             text not null default 'queued'
                       check (status in ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
  credits_estimated  numeric(12,2) not null default 0,
  credits_actual     numeric(12,2) not null default 0,
  created_by         uuid references auth.users (id) on delete set null,
  started_at         timestamptz,
  finished_at        timestamptz,
  created_at         timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete cascade
);
create index scan_runs_project_created_idx on public.scan_runs (project_id, created_at desc);
create index scan_runs_workspace_id_idx on public.scan_runs (workspace_id);
create index scan_runs_created_by_idx on public.scan_runs (created_by);

-- One row per prompt x engine x market (FR-11).
create table public.tasks (
  id                 uuid primary key default gen_random_uuid(),
  scan_run_id        uuid not null,
  project_id         uuid not null,
  workspace_id       uuid not null,
  prompt_id          uuid references public.prompts (id) on delete set null,
  prompt_text        text not null,          -- snapshot: the exact text that was sent
  engine             text not null references public.engines (code),
  country            text not null references public.countries (code),
  provider_task_id   text,                   -- querying.ai task id
  -- Idempotency key sent to the provider so a retried submit never double-charges (FR-13).
  idempotency_key    text not null unique,
  status             text not null default 'queued'
                       check (status in ('queued', 'submitted', 'running', 'completed', 'failed')),
  attempts           integer not null default 0,
  error              text,
  credits_estimated  numeric(8,2) not null default 0,
  credits_charged    numeric(8,2) not null default 0,
  submitted_at       timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (scan_run_id, workspace_id) references public.scan_runs (id, workspace_id) on delete cascade,
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete cascade
);
create index tasks_scan_run_id_idx on public.tasks (scan_run_id);
create index tasks_workspace_id_idx on public.tasks (workspace_id);
create index tasks_project_id_idx on public.tasks (project_id, workspace_id);
create index tasks_prompt_id_idx on public.tasks (prompt_id);
create index tasks_engine_idx on public.tasks (engine);
create index tasks_country_idx on public.tasks (country);
create index tasks_provider_task_id_idx on public.tasks (provider_task_id) where provider_task_id is not null;
-- Dispatcher / reconciler work queue (DB-backed queue, component 6 and 9).
create index tasks_open_idx on public.tasks (status, submitted_at)
  where status in ('queued', 'submitted', 'running');

-- Slim answer row: what dashboards read.
create table public.answers (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null unique,
  project_id    uuid not null,
  workspace_id  uuid not null,
  engine        text not null references public.engines (code),
  country       text not null references public.countries (code),
  text          text not null,
  answered_at   timestamptz not null default now(),   -- day used for trends
  unique (id, workspace_id),
  foreign key (task_id, workspace_id) references public.tasks (id, workspace_id) on delete cascade,
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete cascade
);
create index answers_project_day_idx on public.answers (project_id, answered_at desc);
create index answers_workspace_id_idx on public.answers (workspace_id);
create index answers_project_workspace_idx on public.answers (project_id, workspace_id);
create index answers_engine_idx on public.answers (engine);
create index answers_country_idx on public.answers (country);

-- Raw provider JSON kept apart so dashboard queries never scan it (storage
-- growth note: retained permanently, can later be compressed or moved out).
create table public.answer_raw (
  answer_id     uuid primary key references public.answers (id) on delete cascade,
  workspace_id  uuid not null,
  raw           jsonb not null
);
create index answer_raw_workspace_id_idx on public.answer_raw (workspace_id);

create table public.sources (
  id            uuid primary key default gen_random_uuid(),
  answer_id     uuid not null references public.answers (id) on delete cascade,
  project_id    uuid not null,
  workspace_id  uuid not null,
  url           text not null,
  domain        text not null,
  label         text,
  position      integer not null,
  -- Who owns the cited domain, relative to the project (FR-18).
  domain_role   text not null default 'other' check (domain_role in ('client', 'competitor', 'other')),
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete cascade
);
create index sources_answer_id_idx on public.sources (answer_id);
create index sources_project_domain_idx on public.sources (project_id, domain);
create index sources_workspace_id_idx on public.sources (workspace_id);
create index sources_project_workspace_idx on public.sources (project_id, workspace_id);

create table public.answer_analysis (
  answer_id              uuid primary key references public.answers (id) on delete cascade,
  project_id             uuid not null,
  workspace_id           uuid not null,
  brand_mentioned        boolean not null,
  mention_rank           integer check (mention_rank is null or mention_rank >= 1),  -- among tracked brands
  domain_cited           boolean not null,
  competitors_mentioned  text[] not null default '{}',
  analysed_at            timestamptz not null default now(),
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete cascade
);
create index answer_analysis_project_idx on public.answer_analysis (project_id);
create index answer_analysis_workspace_id_idx on public.answer_analysis (workspace_id);
create index answer_analysis_project_workspace_idx on public.answer_analysis (project_id, workspace_id);

-- Pre-aggregated metrics for fast charts (dashboard < 2 s over 12 months).
-- Counts are stored, rates derived, so periods can be re-aggregated exactly.
create table public.daily_rollups (
  project_id      uuid not null,
  workspace_id    uuid not null,
  engine          text not null references public.engines (code),
  country         text not null references public.countries (code),
  day             date not null,
  answers_n       integer not null default 0,
  mentions_n      integer not null default 0,
  citations_n     integer not null default 0,
  rank_sum        integer not null default 0,
  rank_n          integer not null default 0,
  mention_rate    numeric generated always as (case when answers_n > 0 then mentions_n::numeric / answers_n end) stored,
  citation_rate   numeric generated always as (case when answers_n > 0 then citations_n::numeric / answers_n end) stored,
  avg_rank        numeric generated always as (case when rank_n > 0 then rank_sum::numeric / rank_n end) stored,
  primary key (project_id, engine, country, day),
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete cascade
);
create index daily_rollups_workspace_id_idx on public.daily_rollups (workspace_id);
create index daily_rollups_project_workspace_idx on public.daily_rollups (project_id, workspace_id);
create index daily_rollups_country_idx on public.daily_rollups (country);
create index daily_rollups_engine_idx on public.daily_rollups (engine);

-- Credit ledger (FR-14, FR-24). Credits are held on submit, charged on
-- completion and released on failure, mirroring querying.ai.
create table public.credit_ledger (
  id            bigint generated always as identity primary key,
  workspace_id  uuid not null,
  project_id    uuid not null,
  country       text references public.countries (code),
  task_id       uuid references public.tasks (id) on delete set null,
  kind          text not null check (kind in ('hold', 'charge', 'release')),
  credits       numeric(8,2) not null check (credits >= 0),
  created_at    timestamptz not null default now(),
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete cascade
);
create index credit_ledger_project_created_idx on public.credit_ledger (project_id, created_at);
create index credit_ledger_workspace_created_idx on public.credit_ledger (workspace_id, created_at);
create index credit_ledger_task_id_idx on public.credit_ledger (task_id);
create index credit_ledger_country_idx on public.credit_ledger (country);

-- Month-to-date spend per project (charged + still-held). RLS applies to the
-- caller because the view is security_invoker.
create view public.project_month_usage with (security_invoker = true) as
select
  workspace_id,
  project_id,
  date_trunc('month', created_at) as month,
  sum(case kind when 'charge'  then credits when 'hold' then credits when 'release' then -credits end) as credits_committed
from public.credit_ledger
group by workspace_id, project_id, date_trunc('month', created_at);

-- ------------------------------------------------------------------ RLS
-- Read-only for workspace members; writes are service-role only.

do $$
declare t text;
begin
  foreach t in array array[
    'scan_runs', 'tasks', 'answers', 'answer_raw', 'sources',
    'answer_analysis', 'daily_rollups', 'credit_ledger'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.can_read_workspace(workspace_id))',
      t || '_select', t);
  end loop;
end
$$;

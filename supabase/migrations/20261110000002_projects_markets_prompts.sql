-- Synoptic migration 2/4: projects, markets, engines, prompts, competitors.
--
-- Every child table carries workspace_id (denormalised) so RLS is a single
-- cheap check. A composite FK (project_id, workspace_id) -> projects guarantees
-- the denormalised value can never disagree with the project's workspace.

-- ----------------------------------------------------- reference tables
-- Configuration, not code (FR-8): add countries/engines by inserting rows.

create table public.engines (
  code    text primary key,
  label   text not null,
  active  boolean not null default true
);

insert into public.engines (code, label) values
  ('chatgpt',             'ChatGPT'),
  ('gemini',              'Gemini'),
  ('perplexity',          'Perplexity'),
  ('copilot',             'Copilot'),
  ('google_ai_overviews', 'Google AI Overviews'),
  ('google_ai_mode',      'Google AI Mode'),
  ('meta_ai',             'Meta AI');

create table public.countries (
  code    text primary key check (code ~ '^[A-Z]{2}$'),  -- ISO 3166-1 alpha-2
  name    text not null,
  region  text not null,                                  -- 'GCC' | 'SEA' | 'BASELINE'
  active  boolean not null default true
);

insert into public.countries (code, name, region) values
  ('AE', 'United Arab Emirates', 'GCC'),
  ('SA', 'Saudi Arabia',         'GCC'),
  ('QA', 'Qatar',                'GCC'),
  ('KW', 'Kuwait',               'GCC'),
  ('BH', 'Bahrain',              'GCC'),
  ('OM', 'Oman',                 'GCC'),
  ('SG', 'Singapore',            'SEA'),
  ('MY', 'Malaysia',             'SEA'),
  ('TH', 'Thailand',             'SEA'),
  ('ID', 'Indonesia',            'SEA'),
  ('PH', 'Philippines',          'SEA'),
  ('VN', 'Vietnam',              'SEA'),
  ('US', 'United States',        'BASELINE');

alter table public.engines   enable row level security;
alter table public.countries enable row level security;
create policy engines_select   on public.engines   for select to authenticated using (true);
create policy countries_select on public.countries for select to authenticated using (true);

-- --------------------------------------------------------------- projects

create table public.projects (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces (id) on delete cascade,
  name                  text not null,
  brand_name            text not null,
  -- Aliases/misspellings, any script (Arabic, Thai, ...). Stored as UTF-8.
  brand_aliases         text[] not null default '{}',
  -- Domains incl. subdomains, lower-case, no scheme (e.g. 'shop.example.com').
  domains               text[] not null default '{}',
  -- Schedule (FR-10). Interpreted in `timezone`, falling back to the agency's.
  schedule              text not null default 'manual' check (schedule in ('manual', 'daily', 'weekly')),
  schedule_hour         smallint not null default 6 check (schedule_hour between 0 and 23),
  schedule_dow          smallint check (schedule_dow between 0 and 6),   -- 0 = Sunday; weekly only
  timezone              text,
  next_run_at           timestamptz,
  -- Hard-stop monthly credit budget (FR-14). null = none.
  monthly_credit_budget numeric(12,2) check (monthly_credit_budget is null or monthly_credit_budget >= 0),
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, workspace_id),
  check (schedule <> 'weekly' or schedule_dow is not null)
);
create index projects_workspace_id_idx on public.projects (workspace_id);
create index projects_next_run_idx on public.projects (next_run_at)
  where schedule <> 'manual' and archived_at is null;

-- Engines enabled per project (FR-7).
create table public.project_engines (
  project_id    uuid not null,
  workspace_id  uuid not null,
  engine        text not null references public.engines (code),
  primary key (project_id, engine),
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete cascade
);
create index project_engines_workspace_id_idx on public.project_engines (workspace_id);

-- Markets monitored per project (FR-8).
create table public.project_markets (
  project_id    uuid not null,
  workspace_id  uuid not null,
  country       text not null references public.countries (code),
  active        boolean not null default true,
  primary key (project_id, country),
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete cascade
);
create index project_markets_workspace_id_idx on public.project_markets (workspace_id);

-- ---------------------------------------------------------------- prompts
-- Open question 2 (shared vs per-market prompts): a prompt belongs to the
-- project; prompt_markets says which markets it runs in. A shared prompt has a
-- row per market, a market-specific prompt has one row. Each row is its own
-- activation switch (FR-8: per-market prompt activation).

create table public.prompts (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null,
  workspace_id  uuid not null,
  text          text not null check (length(btrim(text)) > 0),
  tags          text[] not null default '{}',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete cascade
);
create index prompts_project_id_idx on public.prompts (project_id);
create index prompts_workspace_id_idx on public.prompts (workspace_id);

create table public.prompt_markets (
  prompt_id     uuid not null,
  workspace_id  uuid not null,
  country       text not null references public.countries (code),
  active        boolean not null default true,
  primary key (prompt_id, country),
  foreign key (prompt_id, workspace_id) references public.prompts (id, workspace_id) on delete cascade
);
create index prompt_markets_workspace_id_idx on public.prompt_markets (workspace_id);

-- ------------------------------------------------------------ competitors

create table public.competitors (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null,
  workspace_id  uuid not null,
  name          text not null,
  aliases       text[] not null default '{}',
  domains       text[] not null default '{}',
  created_at    timestamptz not null default now(),
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete cascade
);
create index competitors_project_id_idx on public.competitors (project_id);
create index competitors_workspace_id_idx on public.competitors (workspace_id);

create trigger projects_updated_at before update on public.projects
  for each row execute function private.set_updated_at();
create trigger prompts_updated_at before update on public.prompts
  for each row execute function private.set_updated_at();

-- ------------------------------------------------------------------ RLS
-- Read: anyone with access to the workspace (viewers included).
-- Write: operators and analysts only. Viewers can never write (FR-4).

do $$
declare t text;
begin
  foreach t in array array[
    'projects', 'project_engines', 'project_markets',
    'prompts', 'prompt_markets', 'competitors'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.can_read_workspace(workspace_id))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (private.can_write_workspace(workspace_id))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (private.can_write_workspace(workspace_id)) with check (private.can_write_workspace(workspace_id))',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (private.can_write_workspace(workspace_id))',
      t || '_delete', t);
  end loop;
end
$$;

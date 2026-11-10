-- Synoptic migration 5: covering indexes for foreign keys flagged by the
-- Supabase performance advisor (composite (project_id, workspace_id) keys,
-- plus invited_by and the engine/country references).

create index answers_task_workspace_idx           on public.answers (task_id, workspace_id);
create index competitors_project_workspace_idx    on public.competitors (project_id, workspace_id);
create index credit_ledger_project_workspace_idx  on public.credit_ledger (project_id, workspace_id);
create index invitations_invited_by_idx           on public.invitations (invited_by);
create index project_engines_engine_idx           on public.project_engines (engine);
create index project_engines_project_workspace_idx on public.project_engines (project_id, workspace_id);
create index project_markets_country_idx          on public.project_markets (country);
create index project_markets_project_workspace_idx on public.project_markets (project_id, workspace_id);
create index prompt_markets_country_idx           on public.prompt_markets (country);
create index prompt_markets_prompt_workspace_idx  on public.prompt_markets (prompt_id, workspace_id);
create index prompts_project_workspace_idx        on public.prompts (project_id, workspace_id);
create index scan_runs_project_workspace_idx      on public.scan_runs (project_id, workspace_id);
create index tasks_scan_run_workspace_idx         on public.tasks (scan_run_id, workspace_id);

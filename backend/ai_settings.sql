-- App Settings (key/value runtime config for the Tech Manager)
-- Safe to run multiple times.
create table if not exists app_settings (
  key text primary key,
  value text,
  updated_at timestamptz default now(),
  updated_by text
);

-- Seed the editable AI system prompt (empty by default = use built-in prompt).
insert into app_settings (key, value)
values ('ai_system_prompt', '')
on conflict (key) do nothing;

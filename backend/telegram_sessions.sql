-- Per-chat flow state for the Telegram bot (button / command driven).
-- Run this in the Supabase SQL editor.
-- Stores a tiny state machine ("I asked for a style number — for which action?")
-- and any pending status update awaiting confirmation. Survives between
-- serverless invocations. Without it the bot still works, but each step must be
-- self-contained.

create table if not exists public.telegram_sessions (
  chat_id    text primary key,
  flow       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- If you previously created this table with a `contents` column, add `flow`:
alter table public.telegram_sessions
  add column if not exists flow jsonb not null default '{}'::jsonb;

-- Quick lookup / cleanup of stale threads.
create index if not exists telegram_sessions_updated_idx
  on public.telegram_sessions (updated_at);

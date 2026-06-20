-- =====================================================================
-- Tintura AI Operations Layer — foundation tables
-- Run this in the Supabase SQL Editor (new clone project).
-- These are NEW tables only. No existing table is altered.
-- =====================================================================

-- 1) Activity Registry: append-only audit log of every state change.
--    `before`/`after` snapshots make any action undoable.
CREATE TABLE IF NOT EXISTS activity_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor        TEXT NOT NULL DEFAULT 'System',
  actor_role   TEXT,
  source       TEXT NOT NULL DEFAULT 'human',   -- 'human' | 'ai'
  action       TEXT NOT NULL,                    -- e.g. 'order.create'
  entity_table TEXT NOT NULL,
  entity_id    TEXT,
  summary      TEXT NOT NULL,
  risk         TEXT NOT NULL DEFAULT 'low',      -- 'read' | 'low' | 'high'
  before       JSONB,
  after        JSONB,
  undone       BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_entity  ON activity_log (entity_table, entity_id);

-- 2) Dustbin: central recycle bin so nothing is ever hard-deleted.
CREATE TABLE IF NOT EXISTS dustbin (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  entity_table TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  snapshot     JSONB NOT NULL,
  deleted_by   TEXT NOT NULL DEFAULT 'System',
  restored     BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_dustbin_open ON dustbin (restored, created_at DESC);

-- 3) Feature toggles: new capabilities default OFF (missing row = disabled).
CREATE TABLE IF NOT EXISTS feature_toggles (
  key         TEXT PRIMARY KEY,
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_by  TEXT
);

-- Seed the known flags (all OFF). Safe to re-run.
INSERT INTO feature_toggles (key, enabled, description) VALUES
  ('ai_chat',          FALSE, 'In-app AI assistant chat panel'),
  ('ai_writes',        FALSE, 'Allow AI to perform write actions (with approval rules)'),
  ('ai_voice',         FALSE, 'Voice input for the AI assistant'),
  ('tech_manager_ai',  FALSE, 'Tech Manager meta-AI (edits workflows/prompts)'),
  ('telegram_bot',     FALSE, 'Telegram channel for the AI assistant'),
  ('whatsapp_bot',     FALSE, 'WhatsApp channel for the AI assistant')
ON CONFLICT (key) DO NOTHING;

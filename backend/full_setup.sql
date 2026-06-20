-- =====================================================================
-- TINTURA — COMPLETE DATABASE SETUP (single script)
-- Run this ONCE in the Supabase SQL Editor of your project.
-- Safe to re-run: everything uses IF NOT EXISTS / ON CONFLICT guards and
-- no existing data is dropped. This recreates EVERY table, function, seed
-- row and the storage bucket the app needs to work in its current state
-- (styles, tech-pack + poster images, orders, materials, procurement,
-- sales, inventory, Telegram bot, AI infra, etc.).
-- =====================================================================

create extension if not exists "pgcrypto";   -- for gen_random_uuid()

-- =====================================================================
-- 0) ORDER NUMBER SEQUENCE  (used by createOrder -> rpc('next_order_no'))
-- =====================================================================
create sequence if not exists order_no_seq start 1000;

drop function if exists next_order_no();
create or replace function next_order_no()
returns bigint
language sql
as $$ select nextval('order_no_seq'); $$;

-- Sequential PO numbers for Sales (rpc('next_po_no') -> PO-0001, PO-0002, …).
create sequence if not exists po_no_seq start 1;

drop function if exists next_po_no();
create or replace function next_po_no()
returns bigint
language sql
as $$ select nextval('po_no_seq'); $$;

-- =====================================================================
-- 1) APP USERS  (plaintext login — dev posture; harden later)
-- =====================================================================
create table if not exists app_users (
  id         uuid primary key default gen_random_uuid(),
  username   text not null unique,
  password   text not null,
  role       text not null default 'ADMIN',   -- ADMIN | TECH_MANAGER | MANAGER | ACCESSORIES_MANAGER | ACCOUNTS_INVENTORY
  full_name  text not null default '',
  telegram_chat_id text,                       -- maps a Telegram chat to this user for bot access control
  created_at timestamptz not null default now()
);

-- Older deployments may pre-date the Telegram column; add it idempotently.
alter table app_users add column if not exists telegram_chat_id text;
create unique index if not exists idx_app_users_chat_id
  on app_users (telegram_chat_id) where telegram_chat_id is not null;

-- Default logins (change the passwords after first sign-in).
-- If an older app_users table already exists with a SERIAL id, its sequence
-- may be out of sync (causing "duplicate key ... app_users_pkey"). Resync it
-- so new rows get a fresh id before seeding.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_users'
      and column_name = 'id' and data_type in ('integer','bigint','smallint')
  ) and pg_get_serial_sequence('public.app_users','id') is not null then
    perform setval(
      pg_get_serial_sequence('public.app_users','id'),
      coalesce((select max(id) from public.app_users), 0) + 1,
      false
    );
  end if;
end $$;

insert into app_users (username, password, role, full_name) values
  ('admin', 'admin', 'ADMIN', 'Administrator'),
  ('tech',  'tech',  'TECH_MANAGER', 'Tech Manager'),
  ('manager','manager','MANAGER','Production Manager'),
  ('materials','materials','ACCESSORIES_MANAGER','Accessories Manager'),
  ('accounts','accounts','ACCOUNTS_INVENTORY','Accounts & Inventory')
on conflict (username) do nothing;

-- =====================================================================
-- 2) UNITS  (production sub-units; orders reference unit_id)
-- =====================================================================
create table if not exists units (
  id      serial primary key,
  name    text not null,
  is_main boolean not null default false
);

insert into units (name, is_main) values
  ('Main Unit', true),
  ('Sub Unit 1', false)
on conflict do nothing;

-- Resync the units id sequence too (same legacy serial-id concern).
do $$
begin
  if pg_get_serial_sequence('public.units','id') is not null then
    perform setval(
      pg_get_serial_sequence('public.units','id'),
      coalesce((select max(id) from public.units), 0) + 1,
      false
    );
  end if;
end $$;

-- =====================================================================
-- 3) STYLE TEMPLATE  (single row id=1 holding the tech-pack schema)
-- =====================================================================
create table if not exists style_templates (
  id         int primary key,
  config     jsonb not null default '[]'::jsonb,   -- [{ name, fields:[...] }]
  updated_at timestamptz not null default now()
);

insert into style_templates (id, config) values
  (1, '[
    { "name": "Fabric",   "fields": ["Body Fabric", "Rib / Collar"] },
    { "name": "Trims",    "fields": ["Main Label", "Wash Care", "Buttons", "Thread"] },
    { "name": "Finishing","fields": ["Stitching", "Packing"] }
  ]'::jsonb)
on conflict (id) do nothing;

-- =====================================================================
-- 4) STYLES  (tech_pack JSONB holds categories/fields/variants +
--             reserved __poster__ (poster images) & __custom__ keys)
-- =====================================================================
create table if not exists styles (
  id               uuid primary key default gen_random_uuid(),
  style_number     text not null,
  style_text       text not null default '',
  category         text not null default '',
  packing_type     text not null default '',
  pcs_per_box      numeric not null default 0,
  garment_type     text,
  demographic      text,
  available_colors jsonb not null default '[]'::jsonb,
  available_sizes  jsonb not null default '[]'::jsonb,
  size_type        text default 'letter',            -- 'letter' | 'number'
  tech_pack        jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create unique index if not exists idx_styles_style_number on styles (style_number);

-- =====================================================================
-- 5) ORDERS  (production orders; link to styles by style_number string)
-- =====================================================================
create table if not exists orders (
  id                   uuid primary key default gen_random_uuid(),
  order_no             text not null unique,
  unit_id              int references units(id) on delete set null,
  style_number         text not null default '',
  quantity             numeric not null default 0,
  box_count            int,
  actual_box_count     int,
  attachments          jsonb default '[]'::jsonb,
  attachment_url       text,
  attachment_name      text,
  qc_attachment_url    text,
  size_breakdown       jsonb default '[]'::jsonb,
  completion_breakdown jsonb default '[]'::jsonb,
  material_forecast    jsonb default '[]'::jsonb,
  size_sequence        jsonb default '[]'::jsonb,
  description          text default '',
  qc_notes             text,
  target_delivery_date date,
  size_format          text default 'standard',       -- 'standard' | 'numeric'
  status               text not null default 'ASSIGNED',
  deleted              boolean not null default false,
  created_at           timestamptz not null default now()
);
create index if not exists idx_orders_status  on orders (status);
create index if not exists idx_orders_deleted on orders (deleted);
create index if not exists idx_orders_created on orders (created_at desc);

-- =====================================================================
-- 6) ORDER LOGS  (per-order activity timeline)
-- =====================================================================
create table if not exists order_logs (
  id              bigserial primary key,
  order_id        uuid references orders(id) on delete cascade,
  log_type        text not null,        -- STATUS_CHANGE | MANUAL_UPDATE | CREATION
  message         text not null default '',
  created_by_name text,
  attachments     jsonb not null default '[]'::jsonb,   -- [{ url, name }] images attached to a status entry
  created_at      timestamptz not null default now()
);
-- Older deployments may pre-date the attachments column; add it idempotently.
alter table order_logs add column if not exists attachments jsonb not null default '[]'::jsonb;
create index if not exists idx_order_logs_order on order_logs (order_id);

-- =====================================================================
-- 7) HISTORY (undo) tables for bulk style edits & order edits
-- =====================================================================
create table if not exists bulk_edit_history (
  id             uuid primary key default gen_random_uuid(),
  description    text not null default '',
  affected_count int not null default 0,
  snapshot       jsonb not null default '{}'::jsonb,   -- { styleId: Style }
  created_at     timestamptz not null default now()
);

create table if not exists order_edit_history (
  id             uuid primary key default gen_random_uuid(),
  description    text not null default '',
  affected_count int not null default 0,
  snapshot       jsonb not null default '{}'::jsonb,   -- { orderId: Order }
  created_at     timestamptz not null default now()
);

-- =====================================================================
-- 8) LEGACY MATERIAL REQUESTS + APPROVALS (older materials flow)
-- =====================================================================
create table if not exists material_requests (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid references orders(id) on delete cascade,
  requested_by_name  text,
  material_content   text not null default '',
  quantity_requested numeric not null default 0,
  quantity_approved  numeric not null default 0,
  unit               text not null default 'Nos',
  attachments        jsonb default '[]'::jsonb,
  status             text not null default 'PENDING',   -- PENDING | PARTIALLY_APPROVED | APPROVED | REJECTED
  created_at         timestamptz not null default now()
);
create index if not exists idx_material_requests_order on material_requests (order_id);

create table if not exists material_approvals (
  id               bigserial primary key,
  request_id       uuid references material_requests(id) on delete cascade,
  qty_approved     numeric not null default 0,
  approved_by_name text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_material_approvals_request on material_approvals (request_id);

-- =====================================================================
-- 9) MATERIALS PROCUREMENT  (4-stage lifecycle + audit movements)
-- =====================================================================
create table if not exists material_procurements (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid references orders(id) on delete set null,
  style_number   text not null default '',
  material_name  text not null,
  unit           text not null default 'Nos',
  total_quantity numeric not null default 0,
  qty_requested  numeric not null default 0,
  qty_ordered    numeric not null default 0,
  qty_received   numeric not null default 0,
  qty_released   numeric not null default 0,
  invoice_no     text,
  note           text,
  created_by_name text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_material_procurements_order on material_procurements (order_id);
create index if not exists idx_material_procurements_style on material_procurements (style_number);
create index if not exists idx_material_procurements_name  on material_procurements (material_name);

create table if not exists material_movements (
  id              bigserial primary key,
  procurement_id  uuid not null references material_procurements(id) on delete cascade,
  from_stage      text not null,   -- NEW | REQUESTED | ORDERED | RECEIVED | RELEASED
  to_stage        text not null,   -- REQUESTED | ORDERED | RECEIVED | RELEASED
  qty             numeric not null,
  invoice_no      text,
  note            text,
  created_by_name text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_material_movements_proc on material_movements (procurement_id);

-- =====================================================================
-- 10) INVENTORY  (running on-hand qty per style + colour + size)
--     >>> This is the table that was MISSING — without it stock commits
--         silently fail and nothing appears in the Inventory dashboard. <<<
-- =====================================================================
create table if not exists stock_levels (
  id           bigserial primary key,
  style_number text not null,
  color        text not null default '',
  size         text not null default '',
  quantity     numeric not null default 0,
  updated_at   timestamptz not null default now(),
  unique (style_number, color, size)
);
create index if not exists idx_stock_levels_style on stock_levels (style_number);

-- =====================================================================
-- 11) ORDER STOCK COMMITS  (completed pieces -> inventory, undoable)
-- =====================================================================
create table if not exists order_stock_commits (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid references orders(id) on delete cascade,
  style_number    text not null default '',
  breakdown       jsonb not null default '[]'::jsonb,   -- [{ color, size, qty }]
  total_items     numeric not null default 0,
  created_by_name text,
  created_at      timestamptz not null default now(),
  undone          boolean not null default false,
  undone_at       timestamptz
);
create index if not exists idx_order_stock_commits_order on order_stock_commits (order_id);

-- Legacy simple stock-commit feed (fetchStockCommits)
create table if not exists stock_commits (
  id          bigserial primary key,
  total_items numeric not null default 0,
  note        text,
  created_at  timestamptz not null default now()
);

-- =====================================================================
-- 12) INVOICES (accounts dashboard)
-- =====================================================================
create table if not exists invoices (
  id            uuid primary key default gen_random_uuid(),
  invoice_no    text not null default '',
  customer_name text not null default '',
  total_amount  numeric not null default 0,
  created_at    timestamptz not null default now()
);

-- =====================================================================
-- 13) BUYERS  (reusable customer list for Sales POs)
-- =====================================================================
create table if not exists buyers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  contact    text,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists idx_buyers_name on buyers (lower(name));

-- =====================================================================
-- 14) SALES ORDERS  (buyer matrix -> PO -> forward)
-- =====================================================================
create table if not exists sales_orders (
  id              uuid primary key default gen_random_uuid(),
  po_number       text not null default '',
  po_date         date not null default now(),
  buyer_name      text not null default '',
  size_format     text not null default 'standard',    -- 'standard' | 'numeric'
  size_labels     jsonb not null default '[]'::jsonb,   -- ["S","M","L",...]
  lines           jsonb not null default '[]'::jsonb,   -- [{ style_number, sizes:{...}, total, rate, amount }]
  total_qty       numeric not null default 0,
  total_amount    numeric not null default 0,
  note            text,
  status          text not null default 'DRAFT',        -- DRAFT | FORWARDED | CANCELLED
  forwarded_at    timestamptz,
  created_by_name text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_sales_orders_status  on sales_orders (status);
create index if not exists idx_sales_orders_created on sales_orders (created_at desc);

-- =====================================================================
-- 15) TELEGRAM BOT  (per-chat flow state machine)
-- =====================================================================
create table if not exists public.telegram_sessions (
  chat_id    text primary key,
  flow       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.telegram_sessions
  add column if not exists flow jsonb not null default '{}'::jsonb;
create index if not exists telegram_sessions_updated_idx on public.telegram_sessions (updated_at);

-- =====================================================================
-- 16) AI OPERATIONS LAYER  (audit, dustbin, feature toggles)
-- =====================================================================
create table if not exists activity_log (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  actor        text not null default 'System',
  actor_role   text,
  source       text not null default 'human',   -- 'human' | 'ai'
  action       text not null,
  entity_table text not null,
  entity_id    text,
  summary      text not null,
  risk         text not null default 'low',      -- 'read' | 'low' | 'high'
  before       jsonb,
  after        jsonb,
  undone       boolean not null default false
);
create index if not exists idx_activity_created on activity_log (created_at desc);
create index if not exists idx_activity_entity  on activity_log (entity_table, entity_id);

create table if not exists dustbin (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  entity_table text not null,
  entity_id    text not null,
  snapshot     jsonb not null,
  deleted_by   text not null default 'System',
  restored     boolean not null default false
);
create index if not exists idx_dustbin_open on dustbin (restored, created_at desc);

create table if not exists feature_toggles (
  key         text primary key,
  enabled     boolean not null default false,
  description text,
  updated_at  timestamptz default now(),
  updated_by  text
);
insert into feature_toggles (key, enabled, description) values
  ('ai_chat',          false, 'In-app AI assistant chat panel'),
  ('ai_writes',        false, 'Allow AI to perform write actions (with approval rules)'),
  ('ai_voice',         false, 'Voice input for the AI assistant'),
  ('tech_manager_ai',  false, 'Tech Manager meta-AI (edits workflows/prompts)'),
  ('telegram_bot',     true,  'Telegram channel for the AI assistant'),
  ('whatsapp_bot',     false, 'WhatsApp channel for the AI assistant')
on conflict (key) do nothing;

-- =====================================================================
-- 17) APP SETTINGS  (key/value runtime config; editable AI prompt)
-- =====================================================================
create table if not exists app_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz default now(),
  updated_by text
);
insert into app_settings (key, value) values ('ai_system_prompt', '')
on conflict (key) do nothing;

-- =====================================================================
-- 18) STORAGE BUCKET  (posters / tech-pack files / order + Telegram uploads)
--     Public so Telegram sendPhoto/sendDocument and previews work by URL.
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('order-attachments', 'order-attachments', true)
on conflict (id) do update set public = true;

drop policy if exists "order_attachments_read"   on storage.objects;
drop policy if exists "order_attachments_insert" on storage.objects;
drop policy if exists "order_attachments_update" on storage.objects;
drop policy if exists "order_attachments_delete" on storage.objects;

create policy "order_attachments_read"   on storage.objects for select using (bucket_id = 'order-attachments');
create policy "order_attachments_insert" on storage.objects for insert with check (bucket_id = 'order-attachments');
create policy "order_attachments_update" on storage.objects for update using (bucket_id = 'order-attachments');
create policy "order_attachments_delete" on storage.objects for delete using (bucket_id = 'order-attachments');

-- =====================================================================
-- DONE. The app (anon key) can now read/write every table above.
-- Note: app tables are created WITHOUT row-level security (dev posture),
-- so the anon key works immediately. Enable RLS + policies before going
-- public. Only storage.objects has RLS (handled by the policies above).
-- =====================================================================

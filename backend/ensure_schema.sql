-- =============================================================
-- SAFE SCHEMA ENSURE SCRIPT
-- Run this in Supabase SQL Editor.
-- It creates missing tables/columns/indexes/policies only when absent.
-- It does not duplicate existing objects.
-- =============================================================

create extension if not exists pgcrypto;

-- 1) App users
create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password text not null,
  role text not null default 'ADMIN',
  full_name text not null default '',
  telegram_chat_id text,
  created_at timestamptz not null default now()
);
alter table public.app_users add column if not exists telegram_chat_id text;
create unique index if not exists idx_app_users_chat_id
  on public.app_users (telegram_chat_id) where telegram_chat_id is not null;

-- 2) Units
create table if not exists public.units (
  id serial primary key,
  name text not null,
  is_main boolean not null default false
);

-- 3) Style template
create table if not exists public.style_templates (
  id int primary key,
  config jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.style_templates (id, config)
values (1, '[{"name":"Fabric","fields":["Body Fabric","Rib / Collar"]},{"name":"Trims","fields":["Main Label","Wash Care","Buttons","Thread"]},{"name":"Finishing","fields":["Stitching","Packing"]}]'::jsonb)
on conflict (id) do nothing;

-- 4) Styles
create table if not exists public.styles (
  id uuid primary key default gen_random_uuid(),
  style_number text not null,
  style_text text not null default '',
  category text not null default '',
  packing_type text not null default '',
  pcs_per_box numeric not null default 0,
  garment_type text,
  demographic text,
  available_colors jsonb not null default '[]'::jsonb,
  available_sizes jsonb not null default '[]'::jsonb,
  size_type text default 'letter',
  tech_pack jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_styles_style_number on public.styles (style_number);

-- 5) Orders
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  unit_id int references public.units(id) on delete set null,
  style_number text not null default '',
  quantity numeric not null default 0,
  box_count int,
  actual_box_count int,
  attachments jsonb default '[]'::jsonb,
  attachment_url text,
  attachment_name text,
  qc_attachment_url text,
  size_breakdown jsonb default '[]'::jsonb,
  completion_breakdown jsonb default '[]'::jsonb,
  material_forecast jsonb default '[]'::jsonb,
  size_sequence text[] default ARRAY[]::text[],
  description text default '',
  qc_notes text,
  ai_issue_summary text,
  ai_issue_summary_generated_at timestamptz,
  target_delivery_date date,
  size_format text default 'standard',
  status text not null default 'ASSIGNED',
  deleted boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.orders add column if not exists unit_id int;
alter table public.orders add column if not exists style_number text;
alter table public.orders add column if not exists quantity numeric;
alter table public.orders add column if not exists box_count int;
alter table public.orders add column if not exists actual_box_count int;
alter table public.orders add column if not exists attachments jsonb;
alter table public.orders add column if not exists attachment_url text;
alter table public.orders add column if not exists attachment_name text;
alter table public.orders add column if not exists qc_attachment_url text;
alter table public.orders add column if not exists size_breakdown jsonb;
alter table public.orders add column if not exists completion_breakdown jsonb;
alter table public.orders add column if not exists material_forecast jsonb;
alter table public.orders add column if not exists size_sequence text[];
alter table public.orders add column if not exists description text;
alter table public.orders add column if not exists qc_notes text;
alter table public.orders add column if not exists ai_issue_summary text;
alter table public.orders add column if not exists ai_issue_summary_generated_at timestamptz;
alter table public.orders add column if not exists target_delivery_date date;
alter table public.orders add column if not exists size_format text;
alter table public.orders add column if not exists status text;
alter table public.orders add column if not exists deleted boolean;
alter table public.orders add column if not exists created_at timestamptz;

-- Set defaults only when the column exists and has no defined default
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='style_number') THEN
    ALTER TABLE public.orders ALTER COLUMN style_number SET DEFAULT '';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='quantity') THEN
    ALTER TABLE public.orders ALTER COLUMN quantity SET DEFAULT 0;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='size_format') THEN
    ALTER TABLE public.orders ALTER COLUMN size_format SET DEFAULT 'standard';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='status') THEN
    ALTER TABLE public.orders ALTER COLUMN status SET DEFAULT 'ASSIGNED';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='deleted') THEN
    ALTER TABLE public.orders ALTER COLUMN deleted SET DEFAULT false;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='attachments') THEN
    ALTER TABLE public.orders ALTER COLUMN attachments SET DEFAULT '[]'::jsonb;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='size_breakdown') THEN
    ALTER TABLE public.orders ALTER COLUMN size_breakdown SET DEFAULT '[]'::jsonb;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='completion_breakdown') THEN
    ALTER TABLE public.orders ALTER COLUMN completion_breakdown SET DEFAULT '[]'::jsonb;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='material_forecast') THEN
    ALTER TABLE public.orders ALTER COLUMN material_forecast SET DEFAULT '[]'::jsonb;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='size_sequence') THEN
    ALTER TABLE public.orders ALTER COLUMN size_sequence SET DEFAULT ARRAY[]::text[];
  END IF;
END $$;

create index if not exists idx_orders_status on public.orders (status);
create index if not exists idx_orders_deleted on public.orders (deleted);
create index if not exists idx_orders_created on public.orders (created_at desc);

-- 6) Order logs
create table if not exists public.order_logs (
  id bigserial primary key,
  order_id uuid references public.orders(id) on delete cascade,
  log_type text not null,
  message text not null default '',
  created_by_name text,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.order_logs add column if not exists attachments jsonb;
create index if not exists idx_order_logs_order on public.order_logs (order_id);

-- 7) History tables
create table if not exists public.bulk_edit_history (
  id uuid primary key default gen_random_uuid(),
  description text not null default '',
  affected_count int not null default 0,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.order_edit_history (
  id uuid primary key default gen_random_uuid(),
  description text not null default '',
  affected_count int not null default 0,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 8) Material requests / approvals
create table if not exists public.material_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  requested_by_name text,
  material_content text not null default '',
  quantity_requested numeric not null default 0,
  quantity_approved numeric not null default 0,
  unit text not null default 'Nos',
  attachments jsonb default '[]'::jsonb,
  status text not null default 'PENDING',
  created_at timestamptz not null default now()
);
alter table public.material_requests add column if not exists attachments jsonb;
alter table public.material_requests add column if not exists status text;
create index if not exists idx_material_requests_order on public.material_requests (order_id);

create table if not exists public.material_approvals (
  id bigserial primary key,
  request_id uuid references public.material_requests(id) on delete cascade,
  qty_approved numeric not null default 0,
  approved_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_material_approvals_request on public.material_approvals (request_id);

-- 9) Procurement tables
create table if not exists public.material_procurements (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete set null,
  style_number text not null default '',
  material_name text not null,
  unit text not null default 'Nos',
  total_quantity numeric not null default 0,
  qty_requested numeric not null default 0,
  qty_ordered numeric not null default 0,
  qty_received numeric not null default 0,
  qty_released numeric not null default 0,
  invoice_no text,
  note text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_material_procurements_order on public.material_procurements (order_id);
create index if not exists idx_material_procurements_style on public.material_procurements (style_number);
create index if not exists idx_material_procurements_name on public.material_procurements (material_name);

create table if not exists public.material_movements (
  id bigserial primary key,
  procurement_id uuid not null references public.material_procurements(id) on delete cascade,
  from_stage text not null,
  to_stage text not null,
  qty numeric not null,
  invoice_no text,
  note text,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_material_movements_proc on public.material_movements (procurement_id);

-- 10) Inventory + stock commits
create table if not exists public.stock_levels (
  id bigserial primary key,
  style_number text not null,
  color text not null default '',
  size text not null default '',
  quantity numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (style_number, color, size)
);
create index if not exists idx_stock_levels_style on public.stock_levels (style_number);

create table if not exists public.order_stock_commits (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  style_number text not null default '',
  breakdown jsonb not null default '[]'::jsonb,
  total_items numeric not null default 0,
  created_by_name text,
  created_at timestamptz not null default now(),
  undone boolean not null default false,
  undone_at timestamptz
);
create index if not exists idx_order_stock_commits_order on public.order_stock_commits (order_id);

create table if not exists public.stock_commits (
  id bigserial primary key,
  total_items numeric not null default 0,
  note text,
  created_at timestamptz not null default now()
);

-- 11) Invoices / buyers / sales orders
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null default '',
  customer_name text not null default '',
  total_amount numeric not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.buyers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_buyers_name on public.buyers (lower(name));
create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null default '',
  po_date date not null default now(),
  buyer_name text not null default '',
  size_format text not null default 'standard',
  size_labels jsonb not null default '[]'::jsonb,
  lines jsonb not null default '[]'::jsonb,
  total_qty numeric not null default 0,
  total_amount numeric not null default 0,
  note text,
  status text not null default 'DRAFT',
  forwarded_at timestamptz,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_sales_orders_status on public.sales_orders (status);
create index if not exists idx_sales_orders_created on public.sales_orders (created_at desc);

-- 12) Telegram sessions
create table if not exists public.telegram_sessions (
  chat_id text primary key,
  flow jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.telegram_sessions add column if not exists flow jsonb;
create index if not exists telegram_sessions_updated_idx on public.telegram_sessions (updated_at);

-- 13) Activity log / dustbin / feature toggles / app settings
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor text not null default 'System',
  actor_role text,
  source text not null default 'human',
  action text not null,
  entity_table text not null,
  entity_id text,
  summary text not null,
  risk text not null default 'low',
  before jsonb,
  after jsonb,
  undone boolean not null default false
);
create index if not exists idx_activity_created on public.activity_log (created_at desc);
create index if not exists idx_activity_entity on public.activity_log (entity_table, entity_id);

create table if not exists public.dustbin (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entity_table text not null,
  entity_id text not null,
  snapshot jsonb not null,
  deleted_by text not null default 'System',
  restored boolean not null default false
);
create index if not exists idx_dustbin_open on public.dustbin (restored, created_at desc);

create table if not exists public.feature_toggles (
  key text primary key,
  enabled boolean not null default false,
  description text,
  updated_at timestamptz default now(),
  updated_by text
);
insert into public.feature_toggles (key, enabled, description) values
  ('ai_chat', false, 'In-app AI assistant chat panel'),
  ('ai_writes', false, 'Allow AI to perform write actions (with approval rules)'),
  ('ai_voice', false, 'Voice input for the AI assistant'),
  ('tech_manager_ai', false, 'Tech Manager meta-AI (edits workflows/prompts)'),
  ('telegram_bot', true, 'Telegram channel for the AI assistant'),
  ('whatsapp_bot', false, 'WhatsApp channel for the AI assistant')
on conflict (key) do nothing;

create table if not exists public.app_settings (
  key text primary key,
  value text,
  updated_at timestamptz default now(),
  updated_by text
);
insert into public.app_settings (key, value) values ('ai_system_prompt', '') on conflict (key) do nothing;

-- 14) Storage bucket and policies
insert into storage.buckets (id, name, public)
values ('order-attachments', 'order-attachments', true)
on conflict (id) do update set public = true;

drop policy if exists "order_attachments_read" on storage.objects;
drop policy if exists "order_attachments_insert" on storage.objects;
drop policy if exists "order_attachments_update" on storage.objects;
drop policy if exists "order_attachments_delete" on storage.objects;

create policy "order_attachments_read" on storage.objects for select using (bucket_id = 'order-attachments');
create policy "order_attachments_insert" on storage.objects for insert with check (bucket_id = 'order-attachments');
create policy "order_attachments_update" on storage.objects for update using (bucket_id = 'order-attachments');
create policy "order_attachments_delete" on storage.objects for delete using (bucket_id = 'order-attachments');

-- 15) Sequential helper functions
create sequence if not exists public.order_no_seq start 1000;
create sequence if not exists public.po_no_seq start 1;
create or replace function public.next_order_no() returns bigint language sql as $$ select nextval('public.order_no_seq'); $$;
create or replace function public.next_po_no() returns bigint language sql as $$ select nextval('public.po_no_seq'); $$;

-- 16) Seed default users if missing
insert into public.app_users (username, password, role, full_name) values
  ('admin', 'admin', 'ADMIN', 'Administrator'),
  ('tech', 'tech', 'TECH_MANAGER', 'Tech Manager'),
  ('manager', 'manager', 'MANAGER', 'Production Manager'),
  ('materials', 'materials', 'ACCESSORIES_MANAGER', 'Accessories Manager'),
  ('accounts', 'accounts', 'ACCOUNTS_INVENTORY', 'Accounts & Inventory')
on conflict (username) do nothing;

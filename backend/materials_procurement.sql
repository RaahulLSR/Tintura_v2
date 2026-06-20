-- Materials procurement: 4-stage lifecycle with partial quantities
-- Run this in the Supabase SQL editor. No existing tables are altered.

-- A procurement line = one material for one style/order.
create table if not exists material_procurements (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete set null,
  style_number text not null default '',
  material_name text not null,
  unit text not null default 'Nos',
  total_quantity numeric not null default 0,
  qty_requested numeric not null default 0,
  qty_ordered  numeric not null default 0,
  qty_received numeric not null default 0,
  qty_released numeric not null default 0,
  invoice_no text,
  note text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_material_procurements_order on material_procurements(order_id);
create index if not exists idx_material_procurements_style on material_procurements(style_number);
create index if not exists idx_material_procurements_name on material_procurements(material_name);

-- Append-only timeline of every stage movement (audit + voice/WhatsApp trail).
create table if not exists material_movements (
  id bigserial primary key,
  procurement_id uuid not null references material_procurements(id) on delete cascade,
  from_stage text not null,   -- 'NEW' | REQUESTED | ORDERED | RECEIVED | RELEASED
  to_stage text not null,     -- REQUESTED | ORDERED | RECEIVED | RELEASED
  qty numeric not null,
  invoice_no text,
  note text,
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_material_movements_proc on material_movements(procurement_id);

-- Sales purchase orders: buyer matrix (style rows x size columns) -> PO -> forward
-- Run this in the Supabase SQL editor. No existing tables are altered.

create table if not exists sales_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null default '',
  po_date date not null default now(),
  buyer_name text not null default '',
  size_format text not null default 'standard',   -- 'standard' | 'numeric'
  size_labels jsonb not null default '[]',         -- ["S","M","L",...]
  lines jsonb not null default '[]',               -- [{ style_number, sizes:{S:10,...}, total, rate, amount }]
  total_qty numeric not null default 0,
  total_amount numeric not null default 0,
  note text,
  status text not null default 'DRAFT',            -- DRAFT | FORWARDED | CANCELLED
  forwarded_at timestamptz,
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sales_orders_status on sales_orders(status);
create index if not exists idx_sales_orders_created on sales_orders(created_at desc);

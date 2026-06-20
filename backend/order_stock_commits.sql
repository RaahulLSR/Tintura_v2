-- Stock commits: pushing completed order pieces into inventory (partial/full, undoable)
-- Run this in the Supabase SQL editor. No existing tables are altered.

create table if not exists order_stock_commits (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  style_number text not null default '',
  breakdown jsonb not null default '[]',   -- [{ color, size, qty }]
  total_items numeric not null default 0,
  created_by_name text,
  created_at timestamptz not null default now(),
  undone boolean not null default false,
  undone_at timestamptz
);

create index if not exists idx_order_stock_commits_order on order_stock_commits(order_id);

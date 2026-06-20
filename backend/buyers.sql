-- Buyer registry: reusable customer list for Sales POs + filtering.
-- Run this in the Supabase SQL editor. No existing tables are altered.

create table if not exists buyers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_buyers_name on buyers (lower(name));

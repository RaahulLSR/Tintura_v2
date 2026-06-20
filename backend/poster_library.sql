-- Poster Editor shared library (reusable assets + templates).
-- Run this ONCE in the Supabase SQL editor.
-- Consistent with the rest of the app: no RLS (anon key has full access).

create table if not exists poster_library (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('asset', 'template')),
  name text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists poster_library_kind_idx on poster_library (kind, created_at desc);

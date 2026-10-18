-- 0001: extensions and shared trigger function
-- Extensions live in the `extensions` schema (Supabase convention); later migrations reference extensions.vector explicitly.

create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Keeps updated_at current on every mutable table (triggers are attached in 0006).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

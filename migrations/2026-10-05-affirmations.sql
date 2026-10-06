-- Affirmations library: daily affirmations for kids.
-- Run in the Supabase SQL editor.

-- The library itself. Content is inserted separately (see affirmations/*.tsv).
create table if not exists public.affirmations (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  age_band text not null, -- '4-6' | '7-9' | '10-12' | '13+'
  pillar text not null,   -- 'confidence' | 'self-worth' | ... (13 pillars)
  sort_order int not null default 0, -- position in the rotation cycle
  created_at timestamptz not null default now()
);
alter table public.affirmations enable row level security;
drop policy if exists "Anyone can read affirmations" on public.affirmations;
create policy "Anyone can read affirmations"
  on public.affirmations for select using (true);
create index if not exists affirmations_band_order
  on public.affirmations (age_band, sort_order);

-- Kid's age band (null = auto-detected from the kid label, e.g. "Age 9").
alter table public.kid_profiles add column if not exists age_band text;
drop policy if exists "Parents update own kids" on public.kid_profiles;
create policy "Parents update own kids"
  on public.kid_profiles for update
  using (auth.uid() = parent_id)
  with check (auth.uid() = parent_id);

-- "I said it" check-ins.
create table if not exists public.affirmation_checkins (
  id uuid primary key default gen_random_uuid(),
  kid_id uuid not null references public.kid_profiles(id) on delete cascade,
  affirmation_id uuid not null references public.affirmations(id) on delete cascade,
  said_on date not null default current_date,
  created_at timestamptz not null default now(),
  unique (kid_id, affirmation_id, said_on)
);
alter table public.affirmation_checkins enable row level security;
drop policy if exists "Kids manage own affirmation checkins" on public.affirmation_checkins;
create policy "Kids manage own affirmation checkins"
  on public.affirmation_checkins for all
  using (auth.uid() = kid_id)
  with check (auth.uid() = kid_id);
drop policy if exists "Parents read kids affirmation checkins" on public.affirmation_checkins;
create policy "Parents read kids affirmation checkins"
  on public.affirmation_checkins for select
  using (exists (
    select 1 from public.kid_profiles kp
    where kp.id = affirmation_checkins.kid_id and kp.parent_id = auth.uid()
  ));

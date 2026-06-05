create extension if not exists vector;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone_number text unique,
  whatsapp_id text unique,
  timezone text default 'America/Chicago',
  locale text default 'es',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.memory_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_type text not null check (source_type in ('whatsapp', 'web_upload', 'manual_note', 'system')),
  memory_type text not null check (memory_type in ('document', 'event', 'relationship', 'personal_fact', 'life_history', 'reminder', 'weekly_summary')),
  title text not null,
  summary text,
  raw_text text,
  status text not null default 'uploaded',
  confidence numeric,
  occurred_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.document_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  memory_item_id uuid not null references public.memory_items(id) on delete cascade,
  storage_bucket text not null default 'original-files',
  storage_path text not null,
  original_file_name text,
  mime_type text,
  file_size bigint,
  sha256 text,
  created_at timestamptz default now()
);

create table if not exists public.extracted_fields (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  memory_item_id uuid not null references public.memory_items(id) on delete cascade,
  field_name text not null,
  field_value text not null,
  field_type text,
  confidence numeric,
  source_quote text,
  review_status text not null default 'auto',
  created_at timestamptz default now()
);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  memory_item_id uuid references public.memory_items(id) on delete cascade,
  title text not null,
  description text,
  remind_at timestamptz,
  due_at timestamptz,
  status text not null default 'scheduled',
  source text not null default 'manual',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  channel text not null default 'whatsapp',
  direction text not null check (direction in ('inbound', 'outbound')),
  external_message_id text,
  message_type text not null,
  body text,
  media_url text,
  memory_item_id uuid references public.memory_items(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.memory_embeddings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  memory_item_id uuid not null references public.memory_items(id) on delete cascade,
  chunk_index int not null default 0,
  content text not null,
  embedding vector(1536),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;
alter table public.memory_items enable row level security;
alter table public.document_files enable row level security;
alter table public.extracted_fields enable row level security;
alter table public.reminders enable row level security;
alter table public.messages enable row level security;
alter table public.memory_embeddings enable row level security;

create policy "profiles are owner readable" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles are owner writable" on public.profiles
  for update using (auth.uid() = id);

create policy "memory owner access" on public.memory_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "file owner access" on public.document_files
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "field owner access" on public.extracted_fields
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "reminder owner access" on public.reminders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "message owner access" on public.messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "embedding owner access" on public.memory_embeddings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

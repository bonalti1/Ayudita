-- Ayudita v1 decoder schema.
-- V1 is a single-document decoder: raw document -> extracted facts -> Spanish explanation.
-- Keep the previous broad memory tables for now, but do not use them for v1.

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_phone text not null,
  created_at timestamptz not null default now(),
  storage_path text not null,
  source text not null default 'whatsapp',
  mime_type text,
  document_type text,
  document_category text,
  language text,
  review_status text not null default 'pending',
  status text not null default 'received'
);

create table if not exists public.facts (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  fact_type text not null,
  label text,
  fact_value text,
  provenance_type text not null,
  source_text text,
  page_number int,
  model text
);

create table if not exists public.explanations (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  language text not null default 'es',
  body text,
  model text
);

create table if not exists public.document_text (
  document_id uuid primary key references public.documents(id) on delete cascade,
  raw_text text,
  language text,
  extraction_model text,
  created_at timestamptz not null default now()
);

create table if not exists public.user_questions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.documents(id) on delete set null,
  user_phone text,
  question text,
  answer text,
  created_at timestamptz not null default now()
);

create index if not exists documents_created_at_idx
  on public.documents (created_at desc);

create index if not exists documents_user_phone_created_at_idx
  on public.documents (user_phone, created_at desc);

create index if not exists documents_review_status_idx
  on public.documents (review_status, created_at desc);

create index if not exists documents_status_idx
  on public.documents (status, created_at desc);

create index if not exists facts_document_id_idx
  on public.facts (document_id);

create index if not exists facts_document_id_fact_type_idx
  on public.facts (document_id, fact_type);

create index if not exists explanations_document_id_created_at_idx
  on public.explanations (document_id, created_at desc);

create index if not exists user_questions_document_id_idx
  on public.user_questions (document_id);

-- Private raw document bucket. The backend service role uploads here before AI runs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'raw-documents',
  'raw-documents',
  false,
  20971520,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.documents enable row level security;
alter table public.facts enable row level security;
alter table public.explanations enable row level security;
alter table public.document_text enable row level security;
alter table public.user_questions enable row level security;

-- No anon/auth policies yet. V1 reads and writes through server routes using the service role.
-- This keeps sensitive documents private while the first review workflow is built.

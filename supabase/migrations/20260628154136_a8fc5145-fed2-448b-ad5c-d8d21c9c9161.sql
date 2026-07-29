
-- Enums
create type public.app_role as enum ('admin', 'user');
create type public.project_kind as enum ('single', 'compilation_video', 'compilation_playlist');
create type public.project_status as enum ('draft', 'in_progress', 'scheduled', 'published', 'archived');
create type public.section_kind as enum ('track','analysis','keywords','metadata','tags','thumbnail','cover','longform','shorts','publish');
create type public.section_status as enum ('pending','running','ready','approved','error');
create type public.asset_kind as enum ('audio','thumbnail','cover','longform_video','short_video','album_art');
create type public.social_platform as enum ('youtube','instagram','facebook','tiktok');
create type public.publish_status as enum ('queued','scheduled','uploading','published','failed');

-- updated_at trigger fn
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

-- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "own profile read" on public.profiles for select to authenticated using (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "own profile insert" on public.profiles for insert to authenticated with check (id = auth.uid());
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();

-- on signup -> create profile
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)), new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- user_roles
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create policy "own roles read" on public.user_roles for select to authenticated using (user_id = auth.uid());

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

-- projects
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind project_kind not null default 'single',
  status project_status not null default 'draft',
  title text not null default 'Untitled',
  primary_audio_path text,
  duration_sec numeric,
  cover_image_path text,
  scheduled_for timestamptz,
  first_published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.projects to authenticated;
grant all on public.projects to service_role;
alter table public.projects enable row level security;
create policy "own projects all" on public.projects for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create trigger projects_updated_at before update on public.projects for each row execute function public.set_updated_at();
create index projects_user_idx on public.projects(user_id, created_at desc);

-- project_tracks
create table public.project_tracks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  position int not null default 0,
  audio_path text not null,
  title text,
  duration_sec numeric,
  chapter_start_sec numeric,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.project_tracks to authenticated;
grant all on public.project_tracks to service_role;
alter table public.project_tracks enable row level security;
create policy "own tracks all" on public.project_tracks for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));
create index project_tracks_project_idx on public.project_tracks(project_id, position);

-- project_sections
create table public.project_sections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  section section_kind not null,
  status section_status not null default 'pending',
  data jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (project_id, section)
);
grant select, insert, update, delete on public.project_sections to authenticated;
grant all on public.project_sections to service_role;
alter table public.project_sections enable row level security;
create policy "own sections all" on public.project_sections for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));
create trigger project_sections_updated_at before update on public.project_sections for each row execute function public.set_updated_at();

-- project_assets
create table public.project_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind asset_kind not null,
  storage_path text not null,
  bucket text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.project_assets to authenticated;
grant all on public.project_assets to service_role;
alter table public.project_assets enable row level security;
create policy "own assets all" on public.project_assets for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));

-- chat_messages
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  section section_kind not null,
  role text not null,
  parts jsonb not null,
  created_at timestamptz not null default now()
);
grant select, insert, delete on public.chat_messages to authenticated;
grant all on public.chat_messages to service_role;
alter table public.chat_messages enable row level security;
create policy "own chat all" on public.chat_messages for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));
create index chat_messages_idx on public.chat_messages(project_id, section, created_at);

-- social_connections
create table public.social_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform social_platform not null,
  account_id text,
  account_name text,
  refresh_token text,
  access_token text,
  expires_at timestamptz,
  scopes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform, account_id)
);
grant select, delete on public.social_connections to authenticated;
grant all on public.social_connections to service_role;
alter table public.social_connections enable row level security;
-- Tokens never returned to client; client may list non-secret columns through views later.
create policy "own conns read" on public.social_connections for select to authenticated using (user_id = auth.uid());
create policy "own conns delete" on public.social_connections for delete to authenticated using (user_id = auth.uid());
create trigger social_connections_updated_at before update on public.social_connections for each row execute function public.set_updated_at();

-- publish_jobs
create table public.publish_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  platform social_platform not null,
  status publish_status not null default 'queued',
  scheduled_for timestamptz,
  published_at timestamptz,
  platform_post_id text,
  platform_url text,
  overrides jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.publish_jobs to authenticated;
grant all on public.publish_jobs to service_role;
alter table public.publish_jobs enable row level security;
create policy "own jobs all" on public.publish_jobs for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));

-- release_stats
create table public.release_stats (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  platform social_platform not null,
  views bigint,
  likes bigint,
  comments bigint,
  fetched_at timestamptz not null default now()
);
grant select, insert on public.release_stats to authenticated;
grant all on public.release_stats to service_role;
alter table public.release_stats enable row level security;
create policy "own stats read" on public.release_stats for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));

-- Storage policies: per-user folder structure: <user_id>/<project_id>/<file>
-- audio
create policy "own audio read" on storage.objects for select to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own audio write" on storage.objects for insert to authenticated
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own audio update" on storage.objects for update to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own audio delete" on storage.objects for delete to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
-- videos
create policy "own videos read" on storage.objects for select to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own videos write" on storage.objects for insert to authenticated
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own videos update" on storage.objects for update to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own videos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);

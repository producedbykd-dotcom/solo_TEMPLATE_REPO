-- Link projects to a parent compilation. Compilation projects skip audio
-- analysis and pull their audio from the ordered tracks in release_compilations.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS compilation_id uuid REFERENCES public.release_compilations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_compilation_id ON public.projects(compilation_id);

-- And the reverse pointer so /compilations can open its wizard project.
ALTER TABLE public.release_compilations
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_release_compilations_project_id ON public.release_compilations(project_id);
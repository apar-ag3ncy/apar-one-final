import type { Metadata } from 'next';
import { Button } from '@/components/ui/button';
import { ProjectsList } from '@/components/projects/projects-list';
import { listProjects } from '@/lib/server-stub/entity-actions';
import { PageHeader } from '@/components/shared/page-header';

export const metadata: Metadata = {
  title: 'Projects · Apar Dashboard',
};

export default async function ProjectsPage() {
  const data = await listProjects();
  return (
    <>
      <PageHeader
        title="Projects"
        description={`${data.length} project${data.length === 1 ? '' : 's'} across all clients. Fee captured from SOWs — not computed.`}
        actions={
          <Button
            size="sm"
            disabled
            title="Project creation wizard pending (similar pattern to /clients/new)."
          >
            New project
          </Button>
        }
      />
      <ProjectsList data={data} />
    </>
  );
}

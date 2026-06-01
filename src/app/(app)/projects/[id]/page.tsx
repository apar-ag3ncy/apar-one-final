import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ProjectDetailTabs } from '@/components/projects/project-detail-tabs';
import { getProject } from '@/lib/server-stub/entity-actions';
import type { ProjectStatus } from '@/types/api';
import { ProfileHeader } from '@/components/entity/profile-header';
import type { StatusTone } from '@/components/shared/status-badge';

const STATUS_TONES: Record<ProjectStatus, StatusTone> = {
  pitching: 'info',
  active: 'success',
  on_hold: 'warning',
  delivered: 'accent',
  closed: 'neutral',
};

const STATUS_LABELS: Record<ProjectStatus, string> = {
  pitching: 'Pitching',
  active: 'Active',
  on_hold: 'On hold',
  delivered: 'Delivered',
  closed: 'Closed',
};

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const project = await getProject(id);
  return {
    title: project
      ? `${project.code} · ${project.name} · Apār Dashboard`
      : 'Project · Apār Dashboard',
  };
}

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params;
  // TODO(backend): swap for getProject(id) once Backend ships the query helper.
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <>
      <ProfileHeader
        title={project.name}
        subtitle={
          <>
            <span className="font-mono text-xs opacity-75">{project.code}</span> · For{' '}
            <Link href={`/clients/${project.clientId}`} className="text-foreground hover:underline">
              {project.clientName}
            </Link>{' '}
            · Lead {project.leadName}
          </>
        }
        status={{
          tone: STATUS_TONES[project.status],
          label: STATUS_LABELS[project.status],
        }}
        back={{ href: '/projects', label: 'All projects' }}
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              disabled
              title="Server action pending (Backend agent)."
            >
              Edit
            </Button>
            <Button size="sm" disabled title="Server action pending (Backend agent).">
              New deliverable
            </Button>
          </>
        }
      />
      <ProjectDetailTabs project={project} />
    </>
  );
}

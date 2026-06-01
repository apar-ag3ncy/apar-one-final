import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectDetailTabs } from '@/components/projects/project-detail-tabs';
import { ProjectStatusChanger } from '@/components/projects/project-status-changer';
import { getProject, listProjectTransactions } from '@/lib/server-stub/entity-actions';
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
  const [project, feed] = await Promise.all([getProject(id), listProjectTransactions(id)]);
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
        actions={<ProjectStatusChanger projectId={project.id} value={project.dbStatus} />}
      />
      <ProjectDetailTabs project={project} feed={feed} />
    </>
  );
}

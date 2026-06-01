import {
  LayoutDashboardIcon,
  UsersIcon,
  TruckIcon,
  FolderKanbanIcon,
  UserCogIcon,
  FileTextIcon,
  BookOpenIcon,
  BarChart3Icon,
  BookmarkIcon,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboardIcon },
  { label: 'Clients', href: '/clients', icon: UsersIcon },
  { label: 'Vendors', href: '/vendors', icon: TruckIcon },
  { label: 'Projects', href: '/projects', icon: FolderKanbanIcon },
  { label: 'Employees', href: '/employees', icon: UserCogIcon },
  { label: 'Documents', href: '/documents', icon: FileTextIcon },
  { label: 'Ledger', href: '/ledger', icon: BookOpenIcon },
  { label: 'Reports', href: '/reports', icon: BarChart3Icon },
  { label: 'Views', href: '/views', icon: BookmarkIcon },
] as const;

const LABEL_BY_HREF = new Map(NAV_ITEMS.map((item) => [item.href, item.label] as const));

export function labelForSegment(href: string, segment: string): string {
  if (LABEL_BY_HREF.has(href)) return LABEL_BY_HREF.get(href)!;
  return segment
    .split('-')
    .map((part) => (part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(' ');
}

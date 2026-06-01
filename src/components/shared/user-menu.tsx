'use client';

import { LogOutIcon, SettingsIcon, UserIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type CurrentUser = {
  fullName: string;
  email: string;
  role: string;
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

export function UserMenu({ user }: { user: CurrentUser }) {
  // TODO(backend): replace stub with real sign-out server action from src/lib/auth.ts.
  const handleSignOut = () => {
    toast.info('Sign-out wiring pending (Backend agent).');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-9 gap-2 px-2" aria-label="Open user menu">
          <Avatar className="size-7">
            <AvatarFallback className="text-xs">{initialsOf(user.fullName)}</AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium sm:inline">{user.fullName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{user.fullName}</span>
          <span className="text-muted-foreground text-xs">{user.email}</span>
          <span className="text-muted-foreground text-xs capitalize">{user.role}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <UserIcon className="size-4" aria-hidden />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <SettingsIcon className="size-4" aria-hidden />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleSignOut}>
          <LogOutIcon className="size-4" aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

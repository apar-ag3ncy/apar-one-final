'use client';

import { MailIcon, PencilIcon, PhoneIcon, StarIcon, Trash2Icon, UserPlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusBadge } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';

export type Contact = {
  id: string;
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary?: boolean;
  /** Soft-delete marker; set when the contact has been archived. */
  deletedAt?: string | Date | null;
};

export type ContactListProps = {
  contacts: readonly Contact[];
  /**
   * Name of the parent entity (e.g. "Acme Co.") used in copy. Falls back to
   * generic phrasing when omitted.
   */
  entityName?: string;
  /** Show a header row with "Add contact" / count badge. Defaults to true. */
  showHeader?: boolean;
  /** Called when the user clicks "Add contact". Disables the button if absent. */
  onAdd?: () => void;
  /** Called when the user edits a contact row. */
  onEdit?: (contact: Contact) => void;
  /** Called when the user soft-deletes a contact row. */
  onDelete?: (contact: Contact) => void;
  className?: string;
};

/**
 * Renders an entity's points-of-contact in a compact card+table.
 *
 * Amendment §1 requires every contact to have email OR phone — validation lives
 * in the consumer's form (RHF + Zod). This component only renders.
 *
 * Dumb component. No data fetching, no router. Mutation callbacks let the
 * surface (Dashboard or OS) decide how to handle add/edit/delete.
 */
export function ContactList({
  contacts,
  entityName,
  showHeader = true,
  onAdd,
  onEdit,
  onDelete,
  className,
}: ContactListProps) {
  if (contacts.length === 0) {
    return (
      <EmptyState
        icon={UserPlusIcon}
        title="No contacts yet"
        description={`Add a point of contact so the team knows who to call${
          entityName ? ` about ${entityName}` : ''
        }.`}
        action={
          <Button size="sm" onClick={onAdd} disabled={!onAdd}>
            Add contact
          </Button>
        }
      />
    );
  }

  return (
    <Card className={className}>
      {showHeader ? (
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Points of contact</CardTitle>
          <Button size="sm" variant="outline" onClick={onAdd} disabled={!onAdd}>
            Add contact
          </Button>
        </CardHeader>
      ) : null}
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="px-4">Name</TableHead>
              <TableHead className="px-4">Title</TableHead>
              <TableHead className="px-4">Email</TableHead>
              <TableHead className="px-4">Phone</TableHead>
              <TableHead className="px-4">Primary</TableHead>
              {onEdit || onDelete ? (
                <TableHead className="px-4 text-right">Actions</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map((contact) => (
              <TableRow key={contact.id} className={cn(contact.deletedAt && 'opacity-50')}>
                <TableCell className="px-4 font-medium">{contact.name}</TableCell>
                <TableCell className="text-muted-foreground px-4">
                  {contact.title ?? <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="px-4">
                  {contact.email ? (
                    <a
                      className="inline-flex items-center gap-1.5 hover:underline"
                      href={`mailto:${contact.email}`}
                    >
                      <MailIcon className="size-3.5 opacity-60" aria-hidden />
                      {contact.email}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="px-4 tabular-nums">
                  {contact.phone ? (
                    <a
                      className="inline-flex items-center gap-1.5 hover:underline"
                      href={`tel:${contact.phone}`}
                    >
                      <PhoneIcon className="size-3.5 opacity-60" aria-hidden />
                      {contact.phone}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="px-4">
                  {contact.isPrimary ? (
                    <StatusBadge tone="success" label="Primary" dot={false} />
                  ) : (
                    <span className="text-muted-foreground inline-flex items-center gap-1">
                      <StarIcon className="size-3.5 opacity-40" aria-hidden />—
                    </span>
                  )}
                </TableCell>
                {onEdit || onDelete ? (
                  <TableCell className="px-4 text-right">
                    <div className="inline-flex items-center gap-1">
                      {onEdit ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEdit(contact)}
                          aria-label={`Edit ${contact.name}`}
                        >
                          <PencilIcon className="size-3.5" aria-hidden />
                        </Button>
                      ) : null}
                      {onDelete ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onDelete(contact)}
                          aria-label={`Remove ${contact.name}`}
                        >
                          <Trash2Icon className="size-3.5" aria-hidden />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

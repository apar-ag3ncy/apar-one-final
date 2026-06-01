'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ContactList, type Contact } from '@/components/entity/contact-list';
import { ContactForm, type ContactFormValues } from '@/components/entity/contact-form';
import {
  createContact,
  hardDeleteContact,
  softDeleteContact,
  updateContact,
  type ContactInput,
  type ContactRow,
} from '@/lib/server/entities/contacts';

export type ContactsSectionProps = {
  entityType: ContactInput['entityType'];
  entityId: string;
  entityName?: string;
  initial: readonly ContactRow[];
  /**
   * If true, the "Delete permanently" option appears on each row in the
   * confirm dialog. Wire to `ctx.role === 'partner'` server-side; this is
   * just a UI gate that mirrors the server's allow/deny.
   */
  canHardDelete?: boolean;
};

/**
 * Smart wrapper around `<ContactList>`. Owns local state for the add/edit
 * dialog and the delete confirmation, and routes all mutations through
 * the `entity_contacts` server actions in `lib/server/entities/contacts`.
 *
 * Per SPEC-AMENDMENT-001 §1 the form refuses to save without at least
 * one of email or phone; the DB CHECK is the final gate.
 */
export function ContactsSection({
  entityType,
  entityId,
  entityName,
  initial,
  canHardDelete = false,
}: ContactsSectionProps) {
  const [contacts, setContacts] = useState<readonly ContactRow[]>(initial);
  const [, startTransition] = useTransition();

  // Add / edit dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ContactRow | null>(null);

  // Delete confirmation state
  const [pendingDelete, setPendingDelete] = useState<ContactRow | null>(null);

  function toListContact(c: ContactRow): Contact {
    return {
      id: c.id,
      name: c.name,
      title: c.role,
      email: c.email,
      phone: c.phone,
      isPrimary: c.isPrimary,
    };
  }

  async function handleSubmit(values: ContactFormValues) {
    if (editing) {
      const updated = await updateContact(editing.id, {
        name: values.name,
        role: values.role || null,
        email: values.email || null,
        phone: values.phone || null,
        isPrimary: values.isPrimary,
        notes: values.notes || null,
      });
      startTransition(() => {
        setContacts((prev) => {
          const next = prev.map((c) => (c.id === updated.id ? updated : c));
          if (updated.isPrimary) {
            return next.map((c) => (c.id === updated.id ? c : { ...c, isPrimary: false }));
          }
          return next;
        });
      });
      toast.success('Contact updated.');
    } else {
      const created = await createContact({
        entityType,
        entityId,
        name: values.name,
        role: values.role || null,
        email: values.email || null,
        phone: values.phone || null,
        isPrimary: values.isPrimary,
        notes: values.notes || null,
      });
      startTransition(() => {
        setContacts((prev) => {
          const next = [...prev, created];
          if (created.isPrimary) {
            return next.map((c) => (c.id === created.id ? c : { ...c, isPrimary: false }));
          }
          return next;
        });
      });
      toast.success('Contact added.');
    }
    setEditing(null);
  }

  async function handleSoftDelete(c: ContactRow) {
    try {
      await softDeleteContact(c.id);
      startTransition(() => {
        setContacts((prev) => prev.filter((row) => row.id !== c.id));
      });
      toast.success('Contact archived.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not archive contact.';
      toast.error(msg);
    } finally {
      setPendingDelete(null);
    }
  }

  async function handleHardDelete(c: ContactRow) {
    try {
      await hardDeleteContact(c.id);
      startTransition(() => {
        setContacts((prev) => prev.filter((row) => row.id !== c.id));
      });
      toast.success('Contact permanently deleted.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not delete contact.';
      toast.error(msg);
    } finally {
      setPendingDelete(null);
    }
  }

  return (
    <>
      <ContactList
        contacts={contacts.map(toListContact)}
        entityName={entityName}
        onAdd={() => {
          setEditing(null);
          setFormOpen(true);
        }}
        onEdit={(c) => {
          const row = contacts.find((x) => x.id === c.id);
          if (!row) return;
          setEditing(row);
          setFormOpen(true);
        }}
        onDelete={(c) => {
          const row = contacts.find((x) => x.id === c.id);
          if (!row) return;
          setPendingDelete(row);
        }}
      />

      <ContactForm
        open={formOpen}
        onOpenChange={(v) => {
          setFormOpen(v);
          if (!v) setEditing(null);
        }}
        mode={editing ? 'edit' : 'create'}
        initial={
          editing
            ? {
                name: editing.name,
                role: editing.role,
                email: editing.email,
                phone: editing.phone,
                isPrimary: editing.isPrimary,
                notes: editing.notes,
              }
            : undefined
        }
        entityName={entityName}
        onSubmit={handleSubmit}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(v) => {
          if (!v) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this contact?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.name ? (
                <>
                  <strong>{pendingDelete.name}</strong>
                  {pendingDelete.email ? ` · ${pendingDelete.email}` : ''}
                  {pendingDelete.phone ? ` · ${pendingDelete.phone}` : ''}
                  <br />
                </>
              ) : null}
              Archiving keeps the record queryable but hides it from this list.
              {canHardDelete
                ? ' Hard delete removes it entirely — only available to the partner role.'
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {canHardDelete ? (
              <AlertDialogAction
                onClick={() => pendingDelete && handleHardDelete(pendingDelete)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete permanently
              </AlertDialogAction>
            ) : null}
            <AlertDialogAction onClick={() => pendingDelete && handleSoftDelete(pendingDelete)}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

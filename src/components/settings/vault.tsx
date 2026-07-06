'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UnlockIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { CopyButton } from '@/components/shared/copy-button';
import { notify } from '@/lib/client/toast';
import {
  changeVaultPassword,
  createVaultItem,
  deleteVaultItem,
  getVaultStatus,
  setupVault,
  unlockVault,
  updateVaultItem,
  type VaultItem,
  type VaultItemInput,
} from '@/lib/server/settings/vault';

/** Auto-lock: 10 min without pointer/keyboard input, or 2 min tab-hidden. */
const IDLE_LOCK_MS = 10 * 60_000;
const HIDDEN_LOCK_MS = 2 * 60_000;

/**
 * Settings → Vault. Self-contained: fetches its own status, holds the vault
 * password ONLY in client state while unlocked (every server call re-derives
 * the key from it), and re-locks automatically when unmounted, idle, or the
 * tab stays hidden — closing the window or navigating away locks the vault.
 */
export function VaultBody() {
  const [phase, setPhase] = useState<
    'loading' | 'denied' | 'error' | 'setup' | 'locked' | 'unlocked'
  >('loading');
  const [vaultPassword, setVaultPassword] = useState('');
  const [items, setItems] = useState<VaultItem[]>([]);
  const [itemCount, setItemCount] = useState(0);
  // Bumped by lock(): any in-flight refresh started before is discarded so a
  // slow response can't repopulate decrypted items after the user locked.
  const lockGen = useRef(0);
  const [statusAttempt, setStatusAttempt] = useState(0);

  // Initial phase is 'loading'; the Retry button resets it before re-running.
  useEffect(() => {
    let cancelled = false;
    getVaultStatus()
      .then((s) => {
        if (cancelled) return;
        if (!s.ok) {
          setPhase(s.denied ? 'denied' : 'error');
          return;
        }
        setItemCount(s.itemCount);
        setPhase(s.configured ? 'locked' : 'setup');
      })
      .catch(() => {
        if (!cancelled) setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [statusAttempt]);

  async function refresh(pw: string) {
    const gen = lockGen.current;
    const result = await unlockVault(pw);
    if (gen !== lockGen.current) return; // locked while in flight — drop it
    if (result.ok) {
      setItems(result.items);
      setItemCount(result.items.length);
    } else {
      // Password changed or vault reset elsewhere — fall back to locked.
      notify.error('Vault re-locked', result.message);
      lock();
    }
  }

  function lock() {
    lockGen.current++;
    setVaultPassword('');
    setItems([]);
    setPhase('locked');
  }

  // Auto-lock while unlocked: inactivity timer + a shorter hidden-tab timer.
  // Not an instant hide-lock — switching tabs to paste a credential is the
  // primary workflow.
  useEffect(() => {
    if (phase !== 'unlocked') return;
    let idleTimer = window.setTimeout(lockNow, IDLE_LOCK_MS);
    let hiddenTimer: number | null = null;
    function lockNow() {
      lock();
      notify.success('Vault locked', 'Locked automatically after inactivity.');
    }
    function resetIdle() {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(lockNow, IDLE_LOCK_MS);
    }
    function onVisibility() {
      if (document.hidden) {
        hiddenTimer = window.setTimeout(lockNow, HIDDEN_LOCK_MS);
      } else if (hiddenTimer !== null) {
        window.clearTimeout(hiddenTimer);
        hiddenTimer = null;
      }
    }
    document.addEventListener('pointerdown', resetIdle);
    document.addEventListener('keydown', resetIdle);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(idleTimer);
      if (hiddenTimer !== null) window.clearTimeout(hiddenTimer);
      document.removeEventListener('pointerdown', resetIdle);
      document.removeEventListener('keydown', resetIdle);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [phase]);

  if (phase === 'loading') {
    return <div className="text-muted-foreground py-8 text-center text-sm">Opening the vault…</div>;
  }
  if (phase === 'denied') {
    return (
      <div className="text-muted-foreground py-8 text-center text-sm">
        You don&apos;t have access to the vault.
      </div>
    );
  }
  if (phase === 'error') {
    return (
      <div className="text-muted-foreground py-8 text-center text-sm">
        Could not load the vault.{' '}
        <button
          type="button"
          className="underline"
          onClick={() => {
            setPhase('loading');
            setStatusAttempt((n) => n + 1);
          }}
        >
          Retry
        </button>
      </div>
    );
  }
  if (phase === 'setup') {
    return <SetupCard onDone={() => setPhase('locked')} />;
  }
  if (phase === 'locked') {
    return (
      <LockedCard
        itemCount={itemCount}
        onUnlocked={(pw, unlocked) => {
          setVaultPassword(pw);
          setItems(unlocked);
          setItemCount(unlocked.length);
          setPhase('unlocked');
        }}
      />
    );
  }
  return (
    <UnlockedCard
      items={items}
      vaultPassword={vaultPassword}
      onChanged={() => void refresh(vaultPassword)}
      onLock={lock}
      onPasswordChanged={(newPw) => setVaultPassword(newPw)}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Setup                                                                      */
/* -------------------------------------------------------------------------- */

function SetupCard({ onDone }: { onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');

  function submit() {
    if (pw.length < 8) {
      notify.error('Pick a longer password', 'At least 8 characters.');
      return;
    }
    if (pw !== confirm) {
      notify.error('Passwords do not match');
      return;
    }
    startTransition(async () => {
      const result = await setupVault(pw);
      if (result.ok) {
        notify.success('Vault created', 'Unlock it with your new vault password.');
        onDone();
      } else {
        notify.error('Could not create the vault', result.message);
      }
    });
  }

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRoundIcon className="size-4" aria-hidden />
          Set up the vault
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-muted-foreground text-sm">
          Pick a vault password. Everything stored in the vault is encrypted with it — without the
          password, entries cannot be viewed. There is no recovery if it is lost.
        </p>
        <div className="grid gap-1.5">
          <Label htmlFor="vault-setup-pw">Vault password</Label>
          <Input
            id="vault-setup-pw"
            type="password"
            autoComplete="new-password"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            disabled={pending}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="vault-setup-confirm">Confirm password</Label>
          <Input
            id="vault-setup-confirm"
            type="password"
            autoComplete="new-password"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            disabled={pending}
          />
        </div>
        <Button onClick={submit} disabled={pending}>
          {pending ? 'Creating…' : 'Create vault'}
        </Button>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Locked                                                                     */
/* -------------------------------------------------------------------------- */

function LockedCard({
  itemCount,
  onUnlocked,
}: {
  itemCount: number;
  onUnlocked: (password: string, items: VaultItem[]) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [pw, setPw] = useState('');

  function submit() {
    if (!pw) return;
    startTransition(async () => {
      const result = await unlockVault(pw);
      if (result.ok) {
        onUnlocked(pw, result.items);
      } else {
        notify.error('Could not unlock', result.message);
      }
    });
  }

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <LockIcon className="size-4" aria-hidden />
          Vault locked
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-muted-foreground text-sm">
          {itemCount === 0
            ? 'The vault is empty. Enter the vault password to open it.'
            : `${itemCount === 1 ? '1 entry is' : `${itemCount} entries are`} stored encrypted. Enter the vault password to view them.`}
        </p>
        <div className="grid gap-1.5">
          <Label htmlFor="vault-unlock-pw">Vault password</Label>
          <Input
            id="vault-unlock-pw"
            type="password"
            autoComplete="new-password"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            autoFocus
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            disabled={pending}
          />
        </div>
        <Button onClick={submit} disabled={pending || !pw}>
          <UnlockIcon className="mr-1 size-4" aria-hidden />
          {pending ? 'Unlocking…' : 'Unlock'}
        </Button>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Unlocked                                                                   */
/* -------------------------------------------------------------------------- */

function UnlockedCard({
  items,
  vaultPassword,
  onChanged,
  onLock,
  onPasswordChanged,
}: {
  items: VaultItem[];
  vaultPassword: string;
  onChanged: () => void;
  onLock: () => void;
  onPasswordChanged: (newPassword: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<VaultItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VaultItem | null>(null);
  const [changePwOpen, setChangePwOpen] = useState(false);

  function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    startTransition(async () => {
      const result = await deleteVaultItem(vaultPassword, target.id);
      if (result.ok) {
        notify.success('Entry removed');
        onChanged();
      } else {
        notify.error('Could not remove', result.message);
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <UnlockIcon className="size-4" aria-hidden />
          Vault
          <span className="text-muted-foreground text-xs font-normal">({items.length})</span>
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setChangePwOpen(true)}>
            Change password
          </Button>
          <Button variant="outline" size="sm" onClick={onLock}>
            <LockIcon className="mr-1 size-3.5" aria-hidden />
            Lock
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditTarget(null);
              setEditorOpen(true);
            }}
          >
            <PlusIcon className="mr-1 size-4" aria-hidden />
            Add entry
          </Button>
        </div>
      </CardHeader>
      <CardContent className={items.length === 0 ? '' : 'p-0'}>
        {items.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center text-sm">
            Nothing here yet. Add the IDs and passwords you want stored safely — bank logins, GST
            portal, email accounts, registrations.
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <VaultRow
                key={item.id}
                item={item}
                onEdit={() => {
                  setEditTarget(item);
                  setEditorOpen(true);
                }}
                onDelete={() => setDeleteTarget(item)}
              />
            ))}
          </ul>
        )}
      </CardContent>

      <ItemEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        vaultPassword={vaultPassword}
        item={editTarget}
        onSaved={onChanged}
      />
      <ChangePasswordDialog
        open={changePwOpen}
        onOpenChange={setChangePwOpen}
        currentPassword={vaultPassword}
        onChanged={onPasswordChanged}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              The entry is permanently deleted from the vault. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function VaultRow({
  item,
  onEdit,
  onDelete,
}: {
  item: VaultItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  if (item.corrupted) {
    return (
      <li className="flex items-center justify-between gap-3 px-6 py-3">
        <div className="min-w-0 space-y-1">
          <span className="font-medium break-words [overflow-wrap:anywhere]">{item.title}</span>
          <p className="text-destructive text-xs">
            This entry can&apos;t be decrypted — it may be corrupted. You can only remove it.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive size-8 shrink-0"
          onClick={onDelete}
          aria-label="Remove entry"
        >
          <Trash2Icon className="size-4" aria-hidden />
        </Button>
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-2 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium break-words [overflow-wrap:anywhere]">{item.title}</span>
          {item.url ? (
            <a
              href={item.url.startsWith('http') ? item.url : `https://${item.url}`}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground max-w-48 text-xs underline break-words [overflow-wrap:anywhere]"
            >
              {item.url}
            </a>
          ) : null}
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {item.username ? (
            <span className="inline-flex items-center gap-1">
              <span className="text-xs">ID</span>
              <span className="font-mono">{item.username}</span>
              <CopyButton value={item.username} label="ID" clearAfterMs={45_000} />
            </span>
          ) : null}
          {item.password ? (
            <span className="inline-flex items-center gap-1">
              <span className="text-xs">Password</span>
              <span className="font-mono">{revealed ? item.password : '••••••••'}</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setRevealed((r) => !r)}
                aria-label={revealed ? 'Hide password' : 'Show password'}
              >
                {revealed ? (
                  <EyeOffIcon className="size-3.5" aria-hidden />
                ) : (
                  <EyeIcon className="size-3.5" aria-hidden />
                )}
              </button>
              <CopyButton value={item.password} label="password" clearAfterMs={45_000} />
            </span>
          ) : null}
        </div>
        {item.notes ? (
          <p className="text-muted-foreground text-xs whitespace-pre-line">{item.notes}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onEdit}
          aria-label="Edit entry"
        >
          <PencilIcon className="size-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive size-8"
          onClick={onDelete}
          aria-label="Remove entry"
        >
          <Trash2Icon className="size-4" aria-hidden />
        </Button>
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Add / edit entry                                                           */
/* -------------------------------------------------------------------------- */

function ItemEditorDialog({
  open,
  onOpenChange,
  vaultPassword,
  item,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vaultPassword: string;
  item: VaultItem | null;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<VaultItemInput>(emptyForm());
  const [showPw, setShowPw] = useState(false);
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  function emptyForm(): VaultItemInput {
    return { title: '', username: '', password: '', url: '', notes: '' };
  }

  // Sync local state when the dialog opens for a (different) target, and
  // clear the guard on ANY close (Cancel, Esc, overlay, save) so a later
  // "Add entry" never resurfaces the previous entry's secrets.
  const targetKey = open ? (item?.id ?? 'new') : null;
  if (targetKey && hydratedFor !== targetKey) {
    setHydratedFor(targetKey);
    setShowPw(false);
    setForm(
      item
        ? {
            title: item.title,
            username: item.username,
            password: item.password,
            url: item.url,
            notes: item.notes,
          }
        : emptyForm(),
    );
  }
  if (!open && hydratedFor !== null) {
    setHydratedFor(null);
    setForm(emptyForm());
    setShowPw(false);
  }

  function set<K extends keyof VaultItemInput>(key: K, value: VaultItemInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function save() {
    if (!form.title?.trim()) {
      notify.error('Add a title', 'e.g. "GST portal" or "HDFC netbanking".');
      return;
    }
    startTransition(async () => {
      const result = item
        ? await updateVaultItem(vaultPassword, item.id, form)
        : await createVaultItem(vaultPassword, form);
      if (result.ok) {
        notify.success(item ? 'Entry updated' : 'Entry added');
        onOpenChange(false);
        onSaved();
      } else {
        notify.error('Could not save', result.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? 'Edit entry' : 'Add entry'}</DialogTitle>
          <DialogDescription>
            Stored encrypted under your vault password — nothing is readable without it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="vault-item-title">Title</Label>
            <Input
              id="vault-item-title"
              placeholder="e.g. GST portal"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="vault-item-username">ID / username</Label>
              <Input
                id="vault-item-username"
                className="font-mono"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore
                value={form.username}
                onChange={(e) => set('username', e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="vault-item-password">Password</Label>
              <div className="relative">
                <Input
                  id="vault-item-password"
                  type={showPw ? 'text' : 'password'}
                  className="pr-9 font-mono"
                  autoComplete="new-password"
                  data-1p-ignore
                  data-lpignore="true"
                  data-bwignore
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  disabled={pending}
                />
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
                  onClick={() => setShowPw((s) => !s)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? (
                    <EyeOffIcon className="size-4" aria-hidden />
                  ) : (
                    <EyeIcon className="size-4" aria-hidden />
                  )}
                </button>
              </div>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="vault-item-url">
              Website <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="vault-item-url"
              placeholder="gst.gov.in"
              value={form.url}
              onChange={(e) => set('url', e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="vault-item-notes">
              Notes <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="vault-item-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              disabled={pending}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Change vault password                                                      */
/* -------------------------------------------------------------------------- */

function ChangePasswordDialog({
  open,
  onOpenChange,
  currentPassword,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPassword: string;
  onChanged: (newPassword: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');

  // Every close path (Esc, overlay, X, Cancel, success) clears the typed
  // passwords so reopening never shows them.
  function handleOpenChange(o: boolean) {
    if (!o) {
      setNewPw('');
      setConfirm('');
    }
    onOpenChange(o);
  }

  function submit() {
    if (newPw.length < 8) {
      notify.error('Pick a longer password', 'At least 8 characters.');
      return;
    }
    if (newPw !== confirm) {
      notify.error('Passwords do not match');
      return;
    }
    startTransition(async () => {
      const result = await changeVaultPassword(currentPassword, newPw);
      if (result.ok) {
        notify.success('Vault password changed');
        onChanged(newPw);
        handleOpenChange(false);
      } else {
        notify.error('Could not change the password', result.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change vault password</DialogTitle>
          <DialogDescription>
            Entries are re-encrypted under a fresh key — the old password becomes useless.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="vault-newpw">New password</Label>
            <Input
              id="vault-newpw"
              type="password"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              data-bwignore
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="vault-newpw-confirm">Confirm new password</Label>
            <Input
              id="vault-newpw-confirm"
              type="password"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              data-bwignore
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              disabled={pending}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Changing…' : 'Change password'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

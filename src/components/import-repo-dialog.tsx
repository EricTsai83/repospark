import { useState } from 'react';
import { useMutation } from 'convex/react';
import { PlusIcon } from '@phosphor-icons/react';
import { api } from '../../convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import type { RepositoryId, ThreadId } from '@/lib/types';

export function ImportRepoDialog({
  onImported,
}: {
  onImported: (repoId: RepositoryId, threadId: ThreadId | null) => void;
}) {
  const createRepositoryImport = useMutation(api.repositories.createRepositoryImport);
  const [open, setOpen] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setImportError(null);
    setIsImporting(true);
    try {
      const result = await createRepositoryImport({
        url: importUrl,
        branch: branch.trim() || undefined,
      });
      setImportUrl('');
      setBranch('');
      setOpen(false);
      onImported(result.repositoryId, result.defaultThreadId ?? null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Import failed.');
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="icon" aria-label="Import repository" title="Import repository">
          <PlusIcon weight="bold" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import a repository</DialogTitle>
          <DialogDescription>
            Paste a public GitHub URL. We will clone the source and spin up a sandbox.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
        >
          <Input
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            autoFocus
          />
          <Input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="Branch (leave empty for repo default)"
          />
          {importError ? <p className="text-xs text-destructive">{importError}</p> : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="default" disabled={isImporting || !importUrl.trim()}>
              {isImporting ? 'Queuing import…' : 'Import repository'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

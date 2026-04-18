import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { shortSha } from '@/lib/format';
import { useRelativeTime } from '@/hooks/use-relative-time';
import type { TopBarRepoDetail } from '@/components/top-bar';

/** Single row inside the repo-info popover. */
function InfoRow({
  label,
  value,
  truncate,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  truncate?: boolean;
  mono?: boolean;
  highlight?: 'positive' | 'negative';
}) {
  let valueClass = 'truncate text-foreground';
  if (truncate) valueClass = 'max-w-[60%] truncate text-right text-foreground';
  if (mono) valueClass += ' font-mono';
  if (highlight === 'positive') valueClass += ' text-emerald-600 dark:text-emerald-400';
  if (highlight === 'negative') valueClass += ' text-orange-600 dark:text-orange-400';

  return (
    <div className="flex justify-between gap-4">
      <span>{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}

/** Derives a human-readable combined status for the popover. */
function deriveStatusLabel(repoDetail: TopBarRepoDetail): string {
  const importLower = repoDetail.repository.importStatus.toLowerCase();
  const importDone =
    importLower.includes('complete') || importLower.includes('ready') || importLower.includes('success');

  if (!importDone) {
    return `Sync: ${repoDetail.repository.importStatus}`;
  }

  if (!repoDetail.sandbox) return 'Ready (no sandbox)';

  const sb = repoDetail.sandbox;
  if (sb.status === 'failed') return 'Sandbox error';
  if (sb.status === 'archived' || Date.now() > sb.ttlExpiresAt) return 'Sandbox expired';
  if (sb.status === 'provisioning') return 'Sandbox starting…';
  return 'Ready';
}

/** Live-updating "Last synced" row inside the repo-info popover. */
function PopoverLastSynced({ timestamp }: { timestamp?: number }) {
  const label = useRelativeTime(timestamp);
  if (!label) return null;
  return <InfoRow label="Last synced" value={label} />;
}

export function RepoInfoPopover({
  repoDetail,
  title,
}: {
  repoDetail: TopBarRepoDetail;
  title: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="min-w-0 truncate text-sm font-semibold tracking-tight hover:underline md:text-base"
        >
          {title}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Repository info
        </p>
        <div className="flex flex-col gap-2 text-xs text-muted-foreground">
          <InfoRow label="Status" value={deriveStatusLabel(repoDetail)} />
          <InfoRow label="Branch" value={repoDetail.repository.defaultBranch ?? 'Unknown'} />
          <InfoRow label="Files indexed" value={String(repoDetail.fileCount)} />
          <InfoRow
            label="Languages"
            value={repoDetail.repository.detectedLanguages.join(', ') || 'Unknown'}
            truncate
          />
          <PopoverLastSynced timestamp={repoDetail.repository.lastImportedAt} />
          {repoDetail.repository.lastSyncedCommitSha ? (
            <InfoRow
              label="Commit"
              value={shortSha(repoDetail.repository.lastSyncedCommitSha)}
              mono
            />
          ) : null}
          <InfoRow
            label="Deep mode"
            value={repoDetail.deepModeAvailable ? 'Available' : 'Unavailable'}
            highlight={repoDetail.deepModeAvailable ? 'positive' : 'negative'}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

import { WarningCircleIcon, InfoIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type NoticeTone = 'info' | 'warning' | 'error';

const toneClasses: Record<NoticeTone, string> = {
  info: 'border-border bg-muted/50 text-foreground',
  warning: 'border-amber-500/30 bg-amber-500/10 text-foreground',
  error: 'border-destructive/20 bg-destructive/5 text-destructive',
};

export function AppNotice({
  title,
  message,
  tone = 'info',
  actionLabel,
  onAction,
  actionDisabled = false,
  className,
}: {
  title: string;
  message: string;
  tone?: NoticeTone;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  className?: string;
}) {
  const Icon = tone === 'error' || tone === 'warning' ? WarningCircleIcon : InfoIcon;

  return (
    <div className={cn('flex items-start gap-3 border px-4 py-3', toneClasses[tone], className)}>
      <Icon
        size={18}
        weight="fill"
        className={cn('mt-0.5 shrink-0', tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className={cn('mt-0.5 text-xs leading-5', tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
          {message}
        </p>
        {actionLabel && onAction ? (
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-fit gap-1.5 text-xs"
            disabled={actionDisabled}
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

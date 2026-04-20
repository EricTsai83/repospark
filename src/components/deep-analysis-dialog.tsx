import { SparkleIcon } from '@phosphor-icons/react';
import { AppNotice } from '@/components/app-notice';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';

export function DeepAnalysisDialog({
  open,
  onOpenChange,
  analysisPrompt,
  onAnalysisPromptChange,
  deepModeAvailable,
  deepModeReason,
  errorMessage,
  isRunning,
  onRun,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  analysisPrompt: string;
  onAnalysisPromptChange: (value: string) => void;
  deepModeAvailable: boolean;
  deepModeReason?: string | null;
  errorMessage?: string | null;
  isRunning: boolean;
  onRun: () => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deep analysis</DialogTitle>
          <DialogDescription>
            Searches the live sandbox filesystem for files matching your prompt. Unlike Quick mode which only uses
            pre-indexed data, Deep mode can find any file in the repository.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={analysisPrompt}
          onChange={(e) => onAnalysisPromptChange(e.target.value)}
          className="min-h-40"
        />
        {!deepModeAvailable ? (
          <AppNotice
            title="Deep analysis unavailable"
            message={deepModeReason ?? 'Deep analysis is unavailable right now. Sync the repository to provision a fresh sandbox.'}
            tone="warning"
          />
        ) : null}
        {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="default"
            disabled={isRunning || !analysisPrompt.trim() || !deepModeAvailable}
            onClick={() => {
              void onRun();
            }}
          >
            <SparkleIcon weight="bold" />
            {isRunning ? 'Queuing…' : 'Run deep analysis'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

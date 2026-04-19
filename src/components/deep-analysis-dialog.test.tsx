// @vitest-environment jsdom

import type React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogClose: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { DeepAnalysisDialog } from './deep-analysis-dialog';

afterEach(() => {
  cleanup();
});

describe('DeepAnalysisDialog', () => {
  test('does not close immediately when starting deep analysis', () => {
    const onOpenChange = vi.fn();
    const onRun = vi.fn().mockResolvedValue(undefined);

    render(
      <DeepAnalysisDialog
        open
        onOpenChange={onOpenChange}
        analysisPrompt="Inspect auth flow"
        onAnalysisPromptChange={vi.fn()}
        deepModeAvailable
        errorMessage={null}
        isRunning={false}
        onRun={onRun}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /run deep analysis/i }));

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  test('disables submission when deep mode is unavailable', () => {
    render(
      <DeepAnalysisDialog
        open
        onOpenChange={vi.fn()}
        analysisPrompt="Inspect auth flow"
        onAnalysisPromptChange={vi.fn()}
        deepModeAvailable={false}
        errorMessage={null}
        isRunning={false}
        onRun={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByRole('button', { name: /run deep analysis/i })).toBeDisabled();
    expect(screen.getByText(/deep analysis is unavailable right now/i)).toBeInTheDocument();
  });
});

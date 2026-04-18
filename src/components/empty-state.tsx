import { Logo } from '@/components/logo';

export function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 p-10 text-center">
      <Logo size={64} hero />
      <div className="max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">Import your first repository</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Use the <span className="font-semibold text-foreground">+</span> button in the sidebar to paste a GitHub URL.
        </p>
      </div>
    </div>
  );
}

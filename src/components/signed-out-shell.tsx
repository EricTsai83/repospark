import { GithubLogoIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ModeToggle } from '@/components/mode-toggle';
import { Logo } from '@/components/logo';
import { AuthButton } from '@/components/auth-button';

export function SignedOutShell() {
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.35] dark:opacity-60"
        style={{
          backgroundImage:
            'radial-gradient(60% 50% at 18% 0%, rgba(56,189,248,0.22) 0%, rgba(56,189,248,0) 60%), radial-gradient(40% 40% at 90% 10%, rgba(125,211,252,0.18) 0%, rgba(125,211,252,0) 60%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.08] mask-[radial-gradient(ellipse_at_top,black,transparent_70%)]"
        style={{
          backgroundImage:
            'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
          backgroundSize: '36px 36px',
        }}
      />

      <header className="border-b border-border bg-background/60 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <Logo size={36} />
            <div className="min-w-0 leading-tight">
              <div className="text-sm font-semibold tracking-tight">RepoSpark</div>
              <div className="text-[11px] text-muted-foreground">Grounded codebase answers</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ModeToggle />
            <AuthButton size="sm" />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-14 px-6 py-16">
        <section className="flex flex-col gap-6">
          <div className="inline-flex w-fit items-center gap-2 border border-border bg-card/60 px-2.5 py-1 text-[11px] font-medium tracking-wide text-muted-foreground backdrop-blur">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full bg-primary opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 bg-primary" />
            </span>
            <span className="uppercase">Early access · open source</span>
          </div>
          <h1 className="max-w-3xl text-balance text-5xl font-semibold leading-[1.02] tracking-tight sm:text-6xl">
            Ask the repo,{' '}
            <span className="bg-linear-to-r from-foreground via-foreground/70 to-foreground/40 bg-clip-text text-transparent">
              not the internet.
            </span>
          </h1>
          <p className="max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            Import a public repository, let the sandbox boot, and get grounded answers about its architecture, data
            flow, and risk areas — not generic guesses from a model that never saw the code.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <AuthButton />
            <Button asChild variant="secondary">
              <a href="https://github.com" rel="noreferrer" target="_blank">
                <GithubLogoIcon weight="bold" />
                View on GitHub
              </a>
            </Button>
          </div>
        </section>

        <section className="grid items-stretch gap-5 lg:grid-cols-3">
          {[
            {
              label: 'Import',
              eyebrow: 'step 1',
              title: 'Paste a GitHub URL.',
              body: 'We clone it into a fresh sandbox and map the structure.',
            },
            {
              label: 'Ask',
              eyebrow: 'step 2',
              title: 'Pick Quick or Deep mode.',
              body: 'Quick answers from indexed data. Deep searches the live sandbox for any file.',
            },
            {
              label: 'Capture',
              eyebrow: 'step 3',
              title: 'Save the answer.',
              body: 'Conversations, manifests, and architecture notes are saved as artifacts.',
            },
          ].map((card) => (
            <Card key={card.label} className="flex h-full flex-col">
              <CardHeader className="flex-row items-center justify-between gap-4 p-5 pb-3">
                <Badge variant="accent">
                  <span className="h-1.5 w-1.5 bg-primary" />
                  <span>{card.label}</span>
                </Badge>
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {card.eyebrow}
                </span>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col p-5 pt-0">
                <h2 className="text-lg font-semibold">{card.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{card.body}</p>
              </CardContent>
            </Card>
          ))}
        </section>
      </main>
    </div>
  );
}

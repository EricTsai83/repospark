import { Authenticated, Unauthenticated } from 'convex/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { RepositoryShell } from '@/components/repository-shell';
import { SignedOutShell } from '@/components/signed-out-shell';

export default function App() {
  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Authenticated>
        <SidebarProvider>
          <RepositoryShell />
        </SidebarProvider>
      </Authenticated>
      <Unauthenticated>
        <SignedOutShell />
      </Unauthenticated>
    </div>
  );
}

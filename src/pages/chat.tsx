import { SidebarProvider } from '@/components/ui/sidebar';
import { RepositoryShell } from '@/components/repository-shell';

export function ChatPage() {
  return (
    <SidebarProvider>
      <RepositoryShell />
    </SidebarProvider>
  );
}

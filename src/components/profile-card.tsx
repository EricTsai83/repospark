import { useAuth } from '@workos-inc/authkit-react';
import { CaretUpDown, Moon, Sun, SignOut, UserCircle, Stack, ChartLineUp } from '@phosphor-icons/react';
import { useTheme } from '@/providers/theme-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function ProfileCard() {
  const { user, signIn, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  if (!user) {
    return (
      <button
        type="button"
        onClick={() => void signIn()}
        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
          <UserCircle size={20} weight="bold" className="text-muted-foreground" />
        </span>
        <span className="min-w-0 flex-1 text-sm font-medium">Sign in</span>
      </button>
    );
  }

  const displayName = user.firstName
    ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
    : user.email ?? 'User';

  const avatarUrl = user.profilePictureUrl;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className="h-8 w-8 shrink-0 rounded-md object-cover"
            />
          ) : (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold uppercase text-muted-foreground">
              {displayName.charAt(0)}
            </span>
          )}
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold">{displayName}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {user.email ?? 'Workspace shortcuts'}
            </p>
          </div>
          <CaretUpDown size={14} weight="bold" className="shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuItem disabled title="Coming soon">
          <Stack weight="bold" />
          <span>Resources</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled title="Coming soon">
          <ChartLineUp weight="bold" />
          <span>Usage</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setTheme(isDark ? 'light' : 'dark')}>
          {isDark ? <Sun weight="bold" /> : <Moon weight="bold" />}
          <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut()} className="text-destructive focus:text-destructive">
          <SignOut weight="bold" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

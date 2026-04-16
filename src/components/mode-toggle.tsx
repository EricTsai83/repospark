import { Moon, Sun } from '@phosphor-icons/react';

import { useTheme } from '@/components/theme-provider';

export function ModeToggle() {
  const { theme, setTheme } = useTheme();
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <button
      aria-label="Toggle theme"
      className="bc-iconBtn"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      type="button"
    >
      {isDark ? <Sun className="h-[1.1rem] w-[1.1rem]" weight="bold" /> : <Moon className="h-[1.1rem] w-[1.1rem]" weight="bold" />}
      <span className="sr-only">Toggle theme</span>
    </button>
  );
}

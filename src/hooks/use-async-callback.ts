import { useCallback, useState } from 'react';

/**
 * Wraps an async function with a loading state flag.
 * Replaces the repeated `useState(false)` + `try/finally` + `setIsX` pattern.
 */
export function useAsyncCallback<Args extends unknown[]>(
  fn: (...args: Args) => Promise<void>,
): [boolean, (...args: Args) => Promise<void>] {
  const [isPending, setIsPending] = useState(false);

  const wrapped = useCallback(
    async (...args: Args) => {
      setIsPending(true);
      try {
        await fn(...args);
      } finally {
        setIsPending(false);
      }
    },
    [fn],
  );

  return [isPending, wrapped];
}

import { ReactNode, useCallback, useMemo } from 'react';
import { ConvexProviderWithAuth, ConvexReactClient } from 'convex/react';
import { AUTH_TOKEN_ERROR_EVENT } from '@/lib/auth-events';

// Modified to match WorkOS's auth hook structure
type UseAuth = () => {
  isLoading: boolean;
  user: unknown;
  getAccessToken: () => Promise<string | null>;
};

/**
 * A wrapper React component which provides a {@link ConvexReactClient}
 * authenticated with WorkOS AuthKit.
 *
 * It must be wrapped by a configured `AuthKitProvider`, from
 * `@workos-inc/authkit-react`.
 *
 * @public
 */
export function ConvexProviderWithAuthKit({
  children,
  client,
  useAuth,
}: {
  children: ReactNode;
  client: ConvexReactClient;
  useAuth: UseAuth;
}) {
  const useAuthFromWorkOS = useUseAuthFromAuthKit(useAuth);
  return (
    <ConvexProviderWithAuth client={client} useAuth={useAuthFromWorkOS}>
      {children}
    </ConvexProviderWithAuth>
  );
}

function useUseAuthFromAuthKit(useAuth: UseAuth) {
  return useMemo(
    () =>
      function useAuthFromWorkOS() {
        const { isLoading, user, getAccessToken } = useAuth();

        const fetchAccessToken = useCallback(async () => {
          try {
            const token = await getAccessToken();
            return token;
          } catch (error) {
            console.error('Error fetching WorkOS access token:', error);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(
                new CustomEvent(AUTH_TOKEN_ERROR_EVENT, {
                  detail: 'Authentication failed. Please refresh the page and sign in again.',
                }),
              );
            }
            return null;
          }
        }, [getAccessToken]);

        return useMemo(
          () => ({
            isLoading,
            isAuthenticated: !!user,
            fetchAccessToken,
          }),
          [isLoading, user, fetchAccessToken],
        );
      },
    [useAuth],
  );
}

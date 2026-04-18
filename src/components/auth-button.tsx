import { useAuth } from '@workos-inc/authkit-react';
import { Button } from '@/components/ui/button';

export function AuthButton({ size = 'default' }: { size?: 'default' | 'sm' }) {
  const { user, signIn, signOut } = useAuth();
  return user ? (
    <Button variant="secondary" size={size} onClick={() => signOut()}>
      Sign out
    </Button>
  ) : (
    <Button variant="default" size={size} onClick={() => void signIn()}>
      Sign in
    </Button>
  );
}

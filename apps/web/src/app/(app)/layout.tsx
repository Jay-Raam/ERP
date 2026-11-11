import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { AuthGate } from '@/features/auth/auth-gate';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <AppShell>{children}</AppShell>
    </AuthGate>
  );
}

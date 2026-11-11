import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/features/auth/login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <>
      <header className="mb-6 space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Use your organisation ID, email and password.
        </p>
      </header>
      {/* The form reads the URL (?org, ?next), so it renders on the client. */}
      <Suspense fallback={<div className="h-72" aria-hidden />}>
        <LoginForm />
      </Suspense>
    </>
  );
}

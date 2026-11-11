import type { Metadata } from 'next';
import { RegisterForm } from '@/features/auth/register-form';

export const metadata: Metadata = { title: 'Create organisation' };

export default function RegisterPage() {
  return (
    <>
      <header className="mb-6 space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Create your organisation</h1>
        <p className="text-sm text-muted-foreground">
          You become its Owner and can invite your team later.
        </p>
      </header>
      <RegisterForm />
    </>
  );
}

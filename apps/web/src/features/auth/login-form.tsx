'use client';

import { loginInputSchema, type Viewer } from '@erp/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { PasswordField } from '@/components/ui/password-field';
import { restPost } from '@/lib/api-client';
import { resolveApiError } from '@/lib/api-error';
import { handleApiError } from '@/lib/handle-api-error';
import { safeNext } from '@/lib/safe-next';
import { VIEWER_QUERY_KEY } from './viewer';

type FormInput = z.input<typeof loginInputSchema>;
type FormOutput = z.output<typeof loginInputSchema>;
const FIELDS = ['email', 'password'] as const;

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    resetField,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(loginInputSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const { viewer } = await restPost<{ viewer: Viewer }>('/auth/login', values);
      queryClient.setQueryData(VIEWER_QUERY_KEY, viewer);
      router.replace(safeNext(params.get('next')));
    } catch (error) {
      const action = resolveApiError(error);
      if (action.kind === 'login') {
        // Wrong credentials: say so next to the form, clear the password, keep the rest.
        setFormError(action.message);
        resetField('password');
        setFocus('password');
        return;
      }
      if (action.kind === 'toast' && !action.retryable) {
        setFormError(action.message);
        return;
      }
      const message = handleApiError(error, { setError, fields: FIELDS });
      if (action.kind === 'toast') setFormError(message);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {params.get('registered') && !formError ? (
        <Alert>
          <AlertDescription>Your organisation is ready. Sign in to continue.</AlertDescription>
        </Alert>
      ) : null}
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <Field
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        placeholder="you@company.com"
        error={errors.email?.message}
        {...register('email')}
      />
      <PasswordField
        label="Password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register('password')}
      />

      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {isSubmitting ? 'Signing in' : 'Sign in'}
      </Button>
    </form>
  );
}

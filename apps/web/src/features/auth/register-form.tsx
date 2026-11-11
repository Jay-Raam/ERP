'use client';

import { registerOrganisationInputSchema } from '@erp/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { PasswordField } from '@/components/ui/password-field';
import { gqlRequest } from '@/lib/api-client';
import { resolveApiError } from '@/lib/api-error';
import { handleApiError } from '@/lib/handle-api-error';
import { suggestSlug } from './slug';

type FormInput = z.input<typeof registerOrganisationInputSchema>;
type FormOutput = z.output<typeof registerOrganisationInputSchema>;
const FIELDS = ['organisationName', 'organisation', 'ownerName', 'email', 'password'] as const;

const REGISTER = /* GraphQL */ `
  mutation RegisterOrganisation($input: RegisterOrganisationInput!) {
    registerOrganisation(input: $input) {
      organisation {
        slug
      }
    }
  }
`;

export function RegisterForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  // Follow the name until the user types their own ID.
  const slugEdited = useRef(false);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(registerOrganisationInputSchema),
    defaultValues: {
      organisationName: '',
      organisation: '',
      ownerName: '',
      email: '',
      password: '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await gqlRequest(REGISTER, { input: values }, { retryOnUnauthenticated: false });
      router.push('/login?registered=1');
    } catch (error) {
      const action = resolveApiError(error);
      // "ID already taken" arrives as CONFLICT with a field error attached.
      const fieldErrors = (error as { error?: { fieldErrors?: Record<string, string[]> } }).error
        ?.fieldErrors;
      if (action.kind === 'toast' && fieldErrors?.organisation?.[0]) {
        setError(
          'organisation',
          { type: 'server', message: fieldErrors.organisation[0] },
          { shouldFocus: true },
        );
        return;
      }
      const message = handleApiError(error, { setError, fields: FIELDS });
      if (action.kind === 'toast') setFormError(message);
    }
  });

  const organisationName = register('organisationName');
  const organisation = register('organisation');

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <Field
        label="Organisation name"
        autoComplete="organization"
        placeholder="Acme Traders"
        error={errors.organisationName?.message}
        {...organisationName}
        onChange={(event) => {
          void organisationName.onChange(event);
          if (!slugEdited.current) {
            setValue('organisation', suggestSlug(event.target.value), { shouldValidate: false });
          }
        }}
      />
      <Field
        label="Organisation ID"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="acme-traders"
        hint="Your team types this when signing in. Lower-case letters, numbers and hyphens."
        error={errors.organisation?.message}
        {...organisation}
        onChange={(event) => {
          slugEdited.current = event.target.value !== '';
          void organisation.onChange(event);
        }}
      />
      <Field
        label="Your name"
        autoComplete="name"
        error={errors.ownerName?.message}
        {...register('ownerName')}
      />
      <Field
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        placeholder="you@company.com"
        error={errors.email?.message}
        {...register('email')}
      />
      <PasswordField
        label="Password"
        autoComplete="new-password"
        hint="At least 10 characters."
        error={errors.password?.message}
        {...register('password')}
      />

      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {isSubmitting ? 'Creating' : 'Create organisation'}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already registered?{' '}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

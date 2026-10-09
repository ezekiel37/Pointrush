'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createAccountSchema, usernameSchema } from '@pointrush/contracts';
import { z } from 'zod';
import { createAccount } from '@/lib/account';
import { RequestError } from '@/lib/auth-client';
import { useSubmit } from '@/lib/use-submit';
import { Form } from '@/components/ui/form';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
// "Who invited you" is optional: empty is fine, otherwise a username.
const onboardingSchema = createAccountSchema.extend({
  invitedBy: z.union([z.literal(''), usernameSchema]),
});

export function OnboardingForm({
  onSaved,
  blocked = false,
  invitedBy = null,
}: {
  onSaved: () => Promise<void>;
  blocked?: boolean;
  invitedBy?: string | null;
}) {
  const submit = useSubmit();
  const [expired, setExpired] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(onboardingSchema),
    mode: 'onBlur',
    defaultValues: {
      username: '',
      displayName: '',
      invitedBy: invitedBy ?? '',
    },
  });
  return (
    <Form
      noValidate
      aria-busy={submit.busy}
      onSubmit={handleSubmit((values) =>
        submit.run(async () => {
          try {
            await createAccount({
              username: values.username,
              displayName: values.displayName,
              ...(values.invitedBy ? { invitedBy: values.invitedBy } : {}),
            });
            setExpired(false);
            await onSaved();
          } catch (error) {
            if (error instanceof RequestError && error.status === 401)
              setExpired(true);
            if (error instanceof RequestError && error.code === 'INVITED_BY') {
              setError('invitedBy', { type: 'server' });
              return;
            }
            throw error;
          }
        }),
      )}
    >
      <Field
        id="displayName"
        label="Display name"
        autoComplete="nickname"
        maxLength={320}
        hint="1–80 characters. This is the name people will see."
        error={
          errors.displayName
            ? 'Use a visible name of 1–80 characters.'
            : undefined
        }
        {...register('displayName')}
      />
      <Field
        id="username"
        label="Username"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={64}
        hint="3–20 letters, numbers or underscores. Start with a letter; end with a letter or number. No double underscores."
        error={
          errors.username
            ? 'Follow the username rules below: 3–20 characters, start with a letter, end with a letter or number, no double underscores.'
            : undefined
        }
        {...register('username')}
      />
      <Field
        id="invitedBy"
        label="Who invited you? (optional)"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={64}
        placeholder="Their username"
        hint={
          invitedBy
            ? `From @${invitedBy}'s invite link.`
            : 'Their username, if someone invited you.'
        }
        error={
          errors.invitedBy
            ? 'Nobody has that username. Check it, or leave it empty.'
            : undefined
        }
        {...register('invitedBy')}
      />
      {submit.error && <Feedback error>{submit.error}</Feedback>}
      {expired && (
        <Feedback>
          Sign in in a new tab, then retry here. Your entries will stay in this
          tab.{' '}
          <Link href="/login" target="_blank" rel="noopener">
            Open sign in
          </Link>
        </Feedback>
      )}
      <Button
        className="full-width"
        type="submit"
        disabled={blocked}
        loading={submit.busy}
      >
        {submit.busy ? 'Saving profile…' : 'Complete setup'}
      </Button>
    </Form>
  );
}

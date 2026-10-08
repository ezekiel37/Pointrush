'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { emailRequestSchema } from '@/lib/forms';
import { authClient, requireSuccess } from '@/lib/auth-client';
import { useSubmit } from '@/lib/use-submit';
import { Form } from '@/components/ui/form';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { Celebrate } from '@/components/ui/celebrate';
export function EmailRequestForm({ kind }: { kind: 'reset' | 'verify' }) {
  const [sent, setSent] = useState(false);
  const submit = useSubmit();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(emailRequestSchema),
    mode: 'onBlur',
    defaultValues: { email: '' },
  });
  return (
    <>
      {sent ? (
        <div className="success-panel">
          <Celebrate kind="mail" />
          <Feedback>
            If this address is eligible, an email is on its way. Check your
            inbox and spam folder.
          </Feedback>
          <p>
            Wait at least a minute before requesting another. Delivery can take
            a few minutes.
          </p>
          <Button variant="outline" onClick={() => setSent(false)}>
            Use another address or request again
          </Button>
        </div>
      ) : (
        <Form
          noValidate
          aria-busy={submit.busy}
          onSubmit={handleSubmit(({ email }) =>
            submit.run(async () => {
              const client = authClient();
              requireSuccess(
                kind === 'reset'
                  ? await client.requestPasswordReset({
                      email,
                      redirectTo: `${window.location.origin}/reset-password`,
                    })
                  : await client.sendVerificationEmail({
                      email,
                      callbackURL: `${window.location.origin}/login?verified=1`,
                    }),
              );
              setSent(true);
            }),
          )}
        >
          <Field
            id="email"
            label="Email address"
            type="email"
            autoComplete="email"
            maxLength={254}
            error={errors.email?.message}
            {...register('email')}
          />
          {submit.error && <Feedback error>{submit.error}</Feedback>}
          <Button className="full-width" type="submit" loading={submit.busy}>
            {submit.busy
              ? 'Requesting email…'
              : kind === 'reset'
                ? 'Send reset link'
                : 'Send verification email'}
          </Button>
        </Form>
      )}
      <p className="form-switch">
        <Link href="/login">Back to sign in</Link>
      </p>
    </>
  );
}

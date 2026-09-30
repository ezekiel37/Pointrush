'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { signupSchema } from '@/lib/forms';
import { authClient, requireSuccess } from '@/lib/auth-client';
import { useSubmit } from '@/lib/use-submit';
import { Form } from '@/components/ui/form';
import { Field } from '@/components/ui/field';
import { Button, buttonVariants } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
export function SignupForm() {
  const [sent, setSent] = useState(false);
  const submit = useSubmit();
  const {
    register,
    handleSubmit,
    resetField,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(signupSchema),
    mode: 'onBlur',
    defaultValues: { name: '', email: '', password: '' },
  });
  if (sent)
    return (
      <div className="success-panel">
        <Feedback>
          Check your inbox for a verification link. If you already have an
          account, sign in or reset your password.
        </Feedback>
        <p>
          Email can take a few minutes. Check your spam folder too. Verifying
          your email does not sign you in automatically.
        </p>
        <Link
          className={buttonVariants({ className: 'full-width' })}
          href="/login"
        >
          Continue to sign in
        </Link>
        <Link className="text-link" href="/verify-email">
          Need another verification email?
        </Link>
      </div>
    );
  return (
    <>
      <Form
        noValidate
        aria-busy={submit.busy}
        onSubmit={handleSubmit((values) =>
          submit.run(async () => {
            requireSuccess(
              await authClient().signUp.email({
                ...values,
                callbackURL: `${window.location.origin}/login?verified=1`,
              }),
            );
            resetField('password');
            setSent(true);
          }),
        )}
      >
        <Field
          id="name"
          label="Display name"
          hint="Use a name people will recognise. You can confirm it during setup."
          autoComplete="nickname"
          maxLength={320}
          error={
            errors.name ? 'Use a visible name of 1–80 characters.' : undefined
          }
          {...register('name')}
        />
        <Field
          id="email"
          label="Email address"
          type="email"
          autoComplete="email"
          maxLength={254}
          error={errors.email?.message}
          {...register('email')}
        />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          minLength={15}
          maxLength={128}
          hint="15–128 characters. A memorable passphrase works well."
          error={errors.password?.message}
          {...register('password')}
        />
        {submit.error && <Feedback error>{submit.error}</Feedback>}
        <Button className="full-width" type="submit" disabled={submit.busy}>
          {submit.busy ? 'Creating account…' : 'Create account'}
        </Button>
      </Form>
      <p className="form-switch">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
      <p className="small-note">
        Creating an account does not award points or guarantee earnings.
      </p>
    </>
  );
}

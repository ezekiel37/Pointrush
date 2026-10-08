'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { signupSchema } from '@/lib/forms';
import { authClient, requireSuccess } from '@/lib/auth-client';
import { useSubmit } from '@/lib/use-submit';
import { Form } from '@/components/ui/form';
import { Field } from '@/components/ui/field';
import { Button, buttonVariants } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { PASSWORD_MIN_LENGTH } from '@pointrush/contracts';
import { SIGNUP_EMAIL_KEY } from '@/components/landing/email-capture';
export function SignupForm() {
  const [sent, setSent] = useState(false);
  const submit = useSubmit();
  const {
    register,
    handleSubmit,
    resetField,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(signupSchema),
    mode: 'onBlur',
    defaultValues: { name: '', email: '', password: '', confirmation: '' },
  });
  // Prefill from the landing page's email box, then forget it.
  useEffect(() => {
    try {
      const email = sessionStorage.getItem(SIGNUP_EMAIL_KEY);
      sessionStorage.removeItem(SIGNUP_EMAIL_KEY);
      if (email) setValue('email', email);
    } catch {
      // Storage can be blocked; the form simply starts empty.
    }
  }, [setValue]);
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
        onSubmit={handleSubmit(({ name, email, password }) =>
          submit.run(async () => {
            requireSuccess(
              await authClient().signUp.email({
                name,
                email,
                password,
                callbackURL: `${window.location.origin}/login?verified=1`,
              }),
            );
            resetField('password');
            resetField('confirmation');
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
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={128}
          hint="10–128 characters. A memorable passphrase works well."
          error={errors.password?.message}
          {...register('password')}
        />
        <Field
          id="confirmation"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          maxLength={128}
          error={errors.confirmation?.message}
          {...register('confirmation')}
        />
        {submit.error && <Feedback error>{submit.error}</Feedback>}
        <Button className="full-width" type="submit" loading={submit.busy}>
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

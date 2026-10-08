'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { resetSchema } from '@/lib/forms';
import { authClient, requireSuccess } from '@/lib/auth-client';
import { useSubmit } from '@/lib/use-submit';
import { Form } from '@/components/ui/form';
import { Field } from '@/components/ui/field';
import { Button, buttonVariants } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { PASSWORD_MIN_LENGTH } from '@pointrush/contracts';
export function ResetForm() {
  const query = useSearchParams();
  const [token, setToken] = useState<string | null>(() => {
    const value = query.get('token');
    return !query.has('error') && value && value.length <= 1024 ? value : null;
  });
  const [done, setDone] = useState(false);
  const submit = useSubmit();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(resetSchema),
    mode: 'onBlur',
    defaultValues: { password: '', confirmation: '' },
  });
  useEffect(() => {
    window.history.replaceState(null, '', '/reset-password');
  }, []);
  if (done)
    return (
      <>
        <Feedback>
          Your password has been changed. Sign in with your new password.
        </Feedback>
        <Link
          className={buttonVariants({ className: 'full-width' })}
          href="/login"
        >
          Back to sign in
        </Link>
      </>
    );
  if (!token)
    return (
      <>
        <Feedback error>
          This reset link is missing or invalid. Request a new link to continue.
        </Feedback>
        <Link
          className={buttonVariants({ className: 'full-width' })}
          href="/forgot-password"
        >
          Request a new reset link
        </Link>
      </>
    );
  return (
    <>
      <Form
        noValidate
        aria-busy={submit.busy}
        onSubmit={handleSubmit(({ password }) =>
          submit.run(async () => {
            requireSuccess(
              await authClient().resetPassword({
                token,
                newPassword: password,
              }),
            );
            reset();
            setToken(null);
            setDone(true);
          }),
        )}
      >
        <Field
          id="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={128}
          hint="10–128 characters. Choose one you do not use elsewhere."
          error={errors.password?.message}
          {...register('password')}
        />
        <Field
          id="confirmation"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          maxLength={128}
          error={errors.confirmation?.message}
          {...register('confirmation')}
        />
        {submit.error && <Feedback error>{submit.error}</Feedback>}
        <Button className="full-width" type="submit" loading={submit.busy}>
          {submit.busy ? 'Updating password…' : 'Update password'}
        </Button>
      </Form>
      <p className="form-switch">
        <Link href="/forgot-password">Request a new reset link</Link>
      </p>
    </>
  );
}

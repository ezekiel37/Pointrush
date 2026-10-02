'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight } from 'lucide-react';
import { loginSchema } from '@/lib/forms';
import { authClient, requireSuccess } from '@/lib/auth-client';
import { useSubmit } from '@/lib/use-submit';
import { Form } from '@/components/ui/form';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
export function LoginForm() {
  const router = useRouter();
  const query = useSearchParams();
  const submit = useSubmit();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(loginSchema),
    mode: 'onBlur',
    defaultValues: { email: '', password: '' },
  });
  return (
    <>
      <div className="form-notice">
        {query.has('error') && (
          <Feedback error>
            This verification link could not be used. Request another email
            below.
          </Feedback>
        )}
        {query.has('verified') && !query.has('error') && (
          <Feedback>Verification link opened. Sign in to continue.</Feedback>
        )}
      </div>
      <Form
        noValidate
        onSubmit={handleSubmit((values) =>
          submit.run(async () => {
            const result = await authClient().signIn.email(values);
            requireSuccess(result);
            if (
              result.data &&
              'twoFactorRedirect' in result.data &&
              result.data.twoFactorRedirect
            )
              return;
            router.replace('/account');
          }),
        )}
        aria-busy={submit.busy}
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
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          maxLength={128}
          error={errors.password?.message}
          {...register('password')}
        />
        <div className="form-link-row">
          <Link href="/forgot-password">Forgot password?</Link>
        </div>
        {submit.error && <Feedback error>{submit.error}</Feedback>}
        <Button className="full-width" type="submit" disabled={submit.busy}>
          {submit.busy ? 'Signing in…' : 'Sign in'}
          <ArrowRight size={18} aria-hidden />
        </Button>
      </Form>
      <p className="form-switch">
        New to PointRush? <Link href="/signup">Create an account</Link>
      </p>
      <p className="small-note">
        <Link href="/verify-email">Resend verification email</Link>
      </p>
    </>
  );
}

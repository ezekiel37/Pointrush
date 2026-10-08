'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight } from 'lucide-react';
import { loginSchema } from '@/lib/forms';
import { authClient, RequestError, requireSuccess } from '@/lib/auth-client';
import { useSubmit } from '@/lib/use-submit';
import { Form } from '@/components/ui/form';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
export function LoginForm() {
  const router = useRouter();
  const query = useSearchParams();
  const submit = useSubmit();
  const resend = useSubmit();
  // Set only after a correct password for an unconfirmed account, so it
  // reveals nothing to someone who does not own the account.
  const [unverified, setUnverified] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
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
            setUnverified(null);
            setResent(false);
            const result = await authClient().signIn.email(values);
            try {
              requireSuccess(result);
            } catch (cause) {
              if (
                cause instanceof RequestError &&
                cause.code === 'EMAIL_NOT_VERIFIED'
              )
                setUnverified(values.email);
              throw cause;
            }
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
        {unverified ? (
          <div className="verify-prompt" role="status">
            <p>
              <strong>Confirm your email first.</strong> We sent a link to{' '}
              {unverified} when you signed up. It may have expired.
            </p>
            {resent ? (
              <Feedback>
                New link sent. Check your inbox and spam folder, then sign in
                again.
              </Feedback>
            ) : (
              <Button
                type="button"
                variant="outline"
                loading={resend.busy}
                onClick={() =>
                  void resend.run(async () => {
                    requireSuccess(
                      await authClient().sendVerificationEmail({
                        email: unverified,
                        callbackURL: `${window.location.origin}/login?verified=1`,
                      }),
                    );
                    setResent(true);
                  })
                }
              >
                {resend.busy ? 'Sending…' : 'Send a new link'}
              </Button>
            )}
            {resend.error && <Feedback error>{resend.error}</Feedback>}
          </div>
        ) : (
          submit.error && <Feedback error>{submit.error}</Feedback>
        )}
        <Button className="full-width" type="submit" loading={submit.busy}>
          {submit.busy ? 'Signing in…' : 'Sign in'}
          <ArrowRight size={18} aria-hidden />
        </Button>
      </Form>
      <p className="form-switch">
        New to Acticlaim? <Link href="/signup">Create an account</Link>
      </p>
      <p className="small-note">
        <Link href="/verify-email">Resend verification email</Link>
      </p>
    </>
  );
}

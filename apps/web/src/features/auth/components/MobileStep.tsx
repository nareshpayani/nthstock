import { zodResolver } from '@hookform/resolvers/zod';
import { Mobile, type OtpPurpose, type OtpRequestResponse } from '@nthstock/contracts';
import { Button, Field, Input } from '@nthstock/ui';
import { useId } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useRequestOtp } from '../hooks/useAuthMutations';
import { authFailure } from '../model/authError';
import { normalizeMobile } from '../model/mobile';
import { strings } from '../strings';
import { AuthCard, FormError } from './AuthCard';

const mobileForm = z.object({
  // Accepts spaces and a typed or pasted +91 / 0 prefix, then the contracts rule applies.
  mobile: z.string().transform(normalizeMobile).pipe(Mobile),
  consent: z.boolean().refine((agreed) => agreed, { error: strings.mobile.consentRequired }),
});

export type OtpSent = OtpRequestResponse & { mobile: string };

export type MobileStepProps = {
  purpose: OtpPurpose;
  /** Shown above the form, e.g. why PIN login is no longer offered. */
  notice?: string | undefined;
  defaultMobile?: string | undefined;
  onSent: (sent: OtpSent) => void;
};

/** Step 1 (T-086): +91 mobile number, DPDP consent, then `POST /v1/auth/otp/request`. */
export function MobileStep({ purpose, notice, defaultMobile = '', onSent }: MobileStepProps) {
  const requestOtp = useRequestOtp();
  const consentErrorId = useId();
  const form = useForm<z.input<typeof mobileForm>, unknown, z.output<typeof mobileForm>>({
    resolver: zodResolver(mobileForm),
    defaultValues: { mobile: defaultMobile, consent: false },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ mobile }) => {
    try {
      const sent = await requestOtp.mutateAsync({ mobile, purpose });
      onSent({ ...sent, mobile });
    } catch (error) {
      const { code, details } = authFailure(error);
      form.setError('root', {
        message:
          code === 'RATE_LIMITED'
            ? strings.errors.rateLimited(details.retryAfterSec)
            : code === 'NETWORK'
              ? strings.errors.network
              : strings.errors.generic,
      });
    }
  });

  const unlocking = purpose === 'UNLOCK_PIN';
  return (
    <AuthCard
      title={unlocking ? strings.mobile.unlockTitle : strings.mobile.title}
      description={unlocking ? strings.mobile.unlockBody : strings.mobile.body}
    >
      {notice ? (
        <p role="status" className="rounded-md bg-marigold-soft px-3 py-2 text-label text-ink">
          {notice}
        </p>
      ) : null}
      <form className="grid gap-4" noValidate onSubmit={(event) => void onSubmit(event)}>
        <Field
          label={strings.mobile.label}
          hint={strings.mobile.hint}
          error={errors.mobile?.message}
        >
          <Input
            {...form.register('mobile')}
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            // The login page exists to take this number; focusing it on arrival is expected.
            autoFocus
            maxLength={16}
            leading={strings.mobile.prefix}
          />
        </Field>
        <div className="grid gap-1">
          <label className="flex items-start gap-2 text-label text-ink">
            <input
              {...form.register('consent')}
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-brand"
              aria-invalid={errors.consent ? true : undefined}
              aria-describedby={errors.consent ? consentErrorId : undefined}
            />
            <span>{strings.mobile.consent}</span>
          </label>
          {errors.consent?.message ? (
            <p id={consentErrorId} role="alert" className="text-label text-down">
              {errors.consent.message}
            </p>
          ) : null}
        </div>
        <FormError>{errors.root?.message}</FormError>
        <Button type="submit" block loading={isSubmitting}>
          {strings.mobile.submit}
        </Button>
      </form>
    </AuthCard>
  );
}

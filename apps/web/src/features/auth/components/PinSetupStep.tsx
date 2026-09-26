import { zodResolver } from '@hookform/resolvers/zod';
import { Pin } from '@nthstock/contracts';
import { Button, Field, OtpInput } from '@nthstock/ui';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useSetPin } from '../hooks/useAuthMutations';
import { authFailure } from '../model/authError';
import { strings } from '../strings';
import { AuthCard, FormError } from './AuthCard';

/** The UI uses 4-digit PINs; the contracts allow 4 to 6. */
export const PIN_LENGTH = 4;

const FourDigitPin = Pin.regex(/^\d{4}$/, { error: strings.pinSetup.pinRequired });
const pinForm = z
  .object({ pin: FourDigitPin, confirmPin: FourDigitPin })
  .refine((v) => v.pin === v.confirmPin, {
    error: strings.pinSetup.mismatch,
    path: ['confirmPin'],
  });
type PinForm = z.infer<typeof pinForm>;

export type PinSetupStepProps = { onDone: () => void };

/** First login (T-088): choose a PIN for this browser, or skip and keep using OTPs. */
export function PinSetupStep({ onDone }: PinSetupStepProps) {
  const setPin = useSetPin();
  const form = useForm<PinForm>({
    resolver: zodResolver(pinForm),
    defaultValues: { pin: '', confirmPin: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await setPin.mutateAsync(values);
      onDone();
    } catch (error) {
      form.setError('root', {
        message:
          authFailure(error).code === 'NETWORK' ? strings.errors.network : strings.errors.generic,
      });
    }
  });

  return (
    <AuthCard title={strings.pinSetup.title} description={strings.pinSetup.body}>
      <form className="grid gap-4" noValidate onSubmit={(event) => void onSubmit(event)}>
        <Controller
          control={form.control}
          name="pin"
          render={({ field }) => (
            <Field label={strings.pinSetup.pinLabel} error={errors.pin?.message}>
              <OtpInput
                value={field.value}
                onChange={field.onChange}
                length={PIN_LENGTH}
                mask
                autoFocus
                label={strings.pinSetup.pinLabel}
              />
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="confirmPin"
          render={({ field }) => (
            <Field label={strings.pinSetup.confirmLabel} error={errors.confirmPin?.message}>
              <OtpInput
                value={field.value}
                onChange={field.onChange}
                length={PIN_LENGTH}
                mask
                label={strings.pinSetup.confirmLabel}
              />
            </Field>
          )}
        />
        <FormError>{errors.root?.message}</FormError>
        <Button type="submit" block loading={isSubmitting}>
          {strings.pinSetup.submit}
        </Button>
        <Button variant="ghost" block onClick={onDone} disabled={isSubmitting}>
          {strings.pinSetup.skip}
        </Button>
      </form>
    </AuthCard>
  );
}

import { Button, Field, Input, Logo, buttonVariants } from '@nthstock/ui';
import { Link } from '@tanstack/react-router';
import { strings } from '../strings';

/** Login placeholder in the auth layout. OTP sign-in is built in E3 (T-033 contracts exist). */
export function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas p-4">
      <div className="grid w-full max-w-sm gap-6 rounded-lg border border-line bg-surface p-6">
        <Logo />
        <div className="grid gap-1">
          <h1 className="text-title text-ink">{strings.title}</h1>
          <p className="text-body text-ink-muted">{strings.body}</p>
        </div>
        <form className="grid gap-4" onSubmit={(event) => event.preventDefault()}>
          <Field label={strings.mobile} hint={strings.mobileHint}>
            <Input inputMode="numeric" autoComplete="tel-national" leading="+91" />
          </Field>
          <Button type="submit" block disabled>
            {strings.getOtp}
          </Button>
        </form>
        <p className="text-label text-ink-muted">{strings.notYet}</p>
        <Link to="/dashboard" className={buttonVariants({ variant: 'secondary', block: true })}>
          {strings.explore}
        </Link>
      </div>
    </main>
  );
}

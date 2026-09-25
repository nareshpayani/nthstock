import { buttonVariants, IconWallet } from '@nthstock/ui';
import { Link } from '@tanstack/react-router';
import { greetingFor } from '../model/greeting';
import { strings } from '../strings';

export function Hero({ now }: { now: Date }) {
  return (
    <section
      aria-labelledby="dashboard-title"
      className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-brand-soft p-4 lg:p-6"
    >
      <div className="grid max-w-2xl gap-1">
        <p className="text-label font-semibold tracking-wide text-brand uppercase">
          {strings.paperTag}
        </p>
        <h1 id="dashboard-title" className="text-title text-ink lg:text-display">
          {greetingFor(now)}
        </h1>
        <p className="text-body font-normal text-ink-muted lg:text-lg">{strings.heroBody}</p>
      </div>
      <Link to="/funds" className={buttonVariants({ variant: 'primary' })}>
        <IconWallet size={18} />
        {strings.heroCta}
      </Link>
    </section>
  );
}

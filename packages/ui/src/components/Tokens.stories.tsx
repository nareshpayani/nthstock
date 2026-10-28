import {
  colors,
  motion,
  radius,
  shadows,
  spring,
  typeScale,
  type ColorName,
} from '@nthstock/tokens';
import type { Meta, StoryObj } from '@storybook/react-vite';

// The token sheet (SPEC-CR-1 §4.1, CR-T02): every colour, type step, radius, shadow and motion
// token of the "Instrument" identity, read straight from @nthstock/tokens so the sheet can't drift.

const meta = {
  title: 'Foundations/Tokens',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const ROLES: Partial<Record<ColorName, string>> = {
  ink: 'Text, the position line, the loupe',
  'ink-muted': 'Secondary text, paise',
  brand: 'Actions, Buy, order lines',
  up: 'Price up',
  down: 'Price down, Sell outline',
  marigold: 'Trailing stop fill; never text',
  'marigold-ink': 'Trailing-stop line stroke',
  canvas: 'Ground strips, inputs',
  line: 'Hairlines',
  surface: 'Cards and sheets',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-title text-ink">{title}</h2>
      {children}
    </section>
  );
}

export const Sheet: Story = {
  render: () => (
    <div className="max-w-3xl font-sans text-ink">
      <Section title="Colour">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {(Object.keys(colors) as ColorName[]).map((name) => (
            <li key={name} className="flex items-center gap-3">
              <span
                aria-hidden
                className="size-10 shrink-0 rounded-md border border-line"
                style={{ background: colors[name] }}
              />
              <span className="min-w-0">
                <span className="block text-label">{name}</span>
                <span className="block font-mono text-label text-ink-muted">{colors[name]}</span>
                {ROLES[name] ? (
                  <span className="block text-label text-ink-muted">{ROLES[name]}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Type">
        <ul className="space-y-3">
          {Object.entries(typeScale).map(([name, step]) => (
            <li key={name} className="flex items-baseline gap-4 border-b border-line pb-2">
              <span className="w-24 shrink-0 font-mono text-label text-ink-muted">
                {name} {step.size}/{step.lineHeight}
              </span>
              <span
                className={name === 'price' ? 'font-mono tabular-nums' : ''}
                style={{
                  fontSize: step.size,
                  lineHeight: `${String(step.lineHeight)}px`,
                  fontWeight: step.weight,
                }}
              >
                {name === 'price' ? '₹1,523.85' : 'Infosys Ltd'}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Radius and shadow">
        <ul className="flex flex-wrap gap-4">
          {Object.entries(radius).map(([name, px]) => (
            <li key={name} className="text-center text-label text-ink-muted">
              <span
                aria-hidden
                className="mb-1 block size-16 border border-line bg-canvas"
                style={{ borderRadius: px }}
              />
              {name}
            </li>
          ))}
          {Object.entries(shadows).map(([name, value]) => (
            <li key={name} className="text-center text-label text-ink-muted">
              <span
                aria-hidden
                className="mb-1 block size-16 rounded-md bg-surface"
                style={{ boxShadow: value }}
              />
              {name}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Motion">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 font-mono text-label">
          {Object.entries(motion).map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="text-ink-muted">{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
          <dt className="text-ink-muted">spring</dt>
          <dd>
            stiffness {spring.stiffness}, damping {spring.damping.toFixed(1)} (critical), mass{' '}
            {spring.mass}
          </dd>
        </dl>
      </Section>
    </div>
  ),
};

import { formatChange } from '@nthstock/utils';
import { cva } from 'class-variance-authority';
import { cn } from '../lib/cn.js';

const badge = cva(
  'inline-flex items-center gap-1 font-mono font-medium tabular-nums whitespace-nowrap',
  {
    variants: {
      direction: { up: 'text-up', down: 'text-down', flat: 'text-ink-muted' },
      soft: { true: 'rounded-sm px-1.5 py-0.5', false: '' },
      size: { sm: 'text-label', md: 'text-body' },
    },
    compoundVariants: [
      { direction: 'up', soft: true, className: 'bg-up-soft' },
      { direction: 'down', soft: true, className: 'bg-down-soft' },
      { direction: 'flat', soft: true, className: 'bg-canvas' },
    ],
    defaultVariants: { soft: false, size: 'md' },
  },
);

export type ChangeBadgeProps = {
  /** Percentage change in integer basis points (1.25% = 125). */
  basisPoints: number;
  /** Optional absolute change shown before the percent, e.g. "+212.45". */
  absolute?: string;
  /** Tinted background, for badges on cards. */
  soft?: boolean;
  size?: 'sm' | 'md';
  className?: string;
};

/**
 * Up/down change with ▲▼, the number and colour, plus a screen-reader label ("up 1.25 percent"),
 * so direction never relies on colour alone.
 */
export function ChangeBadge({
  basisPoints,
  absolute,
  soft = false,
  size,
  className,
}: ChangeBadgeProps) {
  const change = formatChange(basisPoints);
  const visible = absolute ? `${absolute} (${change.text})` : change.text;
  const spoken = absolute ? `${absolute}, ${change.srLabel}` : change.srLabel;
  return (
    <span
      className={cn(badge({ direction: change.direction, soft, size }), className)}
      data-direction={change.direction}
    >
      <span aria-hidden="true">{visible}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}

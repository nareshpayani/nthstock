import type { CSSProperties } from 'react';
import { cn } from '../lib/cn.js';

export type SkeletonProps = {
  className?: string;
  style?: CSSProperties;
};

/** Grey placeholder block with a gentle pulse (still under reduced motion). Hidden from screen readers. */
export function Skeleton({ className, style }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      data-skeleton=""
      className={cn(
        'block h-4 animate-shimmer rounded-sm bg-line motion-reduce:animate-none',
        className,
      )}
      style={style}
    />
  );
}

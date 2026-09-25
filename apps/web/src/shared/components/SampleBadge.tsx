/** Marks figures that are static samples until live market data arrives (E4). */
export function SampleBadge({ label = 'Sample data' }: { label?: string }) {
  return (
    <span className="inline-flex items-center rounded-sm bg-marigold-soft px-1.5 py-0.5 text-label font-medium text-ink">
      {label}
    </span>
  );
}

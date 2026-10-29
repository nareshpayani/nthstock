import { RulerSlider } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { haptic } from '@/shared/motion/haptics';
import { strings } from '../strings';

export type RulerField = 'qty' | 'price';

export type TicketRulerProps = {
  /** Which field the ruler sets; follows the field last touched. */
  field: RulerField;
  qty: number | null;
  onQty: (qty: number) => void;
  /** Limit price in paise, or null (market, or not typed yet). */
  price: number | null;
  onPrice: (price: number) => void;
  /** Where the price ruler starts when no price is typed yet. */
  fallbackPrice: number | null;
  tickSize: number;
  /** A market order has no price to set. */
  priceEnabled: boolean;
};

/**
 * The order sheet's ruler on a phone (A8): nthstock's price rail as a control, under quantity and
 * price. Slide to set either one tick at a time with a selection haptic; the number inputs stay
 * for typing. It sets the field last focused (quantity first), named on its left edge, so it adds
 * one 36 px row to the sheet.
 */
export function TicketRuler({
  field,
  qty,
  onQty,
  price,
  onPrice,
  fallbackPrice,
  tickSize,
  priceEnabled,
}: TicketRulerProps) {
  const active: RulerField = priceEnabled ? field : 'qty';
  const priceValue = price ?? fallbackPrice;
  return (
    <div className="grid scroll-mb-24" data-testid="ticket-ruler">
      {active === 'price' ? (
        <RulerSlider
          key="price"
          label={strings.form.ruler.price}
          badge={strings.form.ruler.priceBadge}
          // No price typed and no quote yet: a disabled price ruler, never the quantity one.
          value={priceValue ?? tickSize}
          disabled={priceValue === null}
          onChange={onPrice}
          step={tickSize}
          min={tickSize}
          formatMajor={formatInr}
          valueText={formatInr}
          onTick={() => haptic('tick')}
        />
      ) : (
        <RulerSlider
          key="qty"
          label={strings.form.ruler.qty}
          badge={strings.form.ruler.qtyBadge}
          value={qty ?? 1}
          onChange={onQty}
          step={1}
          min={1}
          tickPx={12}
          formatMajor={String}
          valueText={strings.form.ruler.shares}
          onTick={() => haptic('tick')}
        />
      )}
    </div>
  );
}

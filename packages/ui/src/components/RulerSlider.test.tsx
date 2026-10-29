import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RulerSlider } from './RulerSlider.js';

function setup(value = 100, extra: Partial<Parameters<typeof RulerSlider>[0]> = {}) {
  const onChange = vi.fn();
  const onTick = vi.fn();
  render(
    <RulerSlider
      value={value}
      onChange={onChange}
      onTick={onTick}
      step={5}
      min={5}
      tickPx={8}
      label="Adjust price"
      formatMajor={(v) => `₹${v / 100}`}
      valueText={(v) => `₹${(v / 100).toFixed(2)}`}
      {...extra}
    />,
  );
  return { slider: screen.getByRole('slider', { name: 'Adjust price' }), onChange, onTick };
}

describe('RulerSlider (A8)', () => {
  it('is a slider with the value in words', () => {
    const { slider } = setup(100);
    expect(slider).toHaveAttribute('aria-valuenow', '100');
    expect(slider).toHaveAttribute('aria-valuetext', '₹1.00');
  });

  it('dragging the scale left raises the value one tick per tick width, with a tick haptic', () => {
    const { slider, onChange, onTick } = setup(100);
    fireEvent.pointerDown(slider, { pointerId: 1, clientX: 200 });
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 176 });
    expect(onChange).toHaveBeenLastCalledWith(115);
    expect(onTick).toHaveBeenCalledOnce();
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 216 });
    expect(onChange).toHaveBeenLastCalledWith(90);
    fireEvent.pointerUp(slider, { pointerId: 1 });
  });

  it('never goes below the minimum', () => {
    const { slider, onChange } = setup(10);
    fireEvent.pointerDown(slider, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 300 });
    expect(onChange).toHaveBeenLastCalledWith(5);
  });

  it('arrows move one tick and Page keys ten; disabled ignores them', () => {
    const { slider, onChange } = setup(100);
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(105);
    fireEvent.keyDown(slider, { key: 'PageDown' });
    expect(onChange).toHaveBeenLastCalledWith(50);
  });
});

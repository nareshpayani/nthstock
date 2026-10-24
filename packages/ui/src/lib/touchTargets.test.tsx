import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '../components/Button.js';
import { NumberInput } from '../components/NumberInput.js';
import { SegmentedControl } from '../components/SegmentedControl.js';
import { Switch } from '../components/Switch.js';
import { TouchTargets } from './touchTargets.js';

function Controls() {
  return (
    <>
      <SegmentedControl
        label="Trail in"
        size="sm"
        value="PCT"
        onValueChange={() => undefined}
        options={[
          { value: 'INR', label: '₹' },
          { value: 'PCT', label: '%' },
        ]}
      />
      <NumberInput mode="price" value={100} onChange={() => undefined} stepLabel="trail" />
      <Button size="sm">More options</Button>
      <Switch label="Add trailing stop" />
    </>
  );
}

// jsdom has no layout, so these check the size classes the phone E2E measures (phoneLayout.spec.ts).
describe('TouchTargets (SPEC-TFC-1 §9.4)', () => {
  it('keeps the desktop sizes outside a touch surface', () => {
    render(<Controls />);
    expect(screen.getByRole('radio', { name: '%' })).toHaveClass('h-7');
    expect(screen.getByRole('button', { name: 'Decrease trail' })).toHaveClass('size-8');
    expect(screen.getByRole('button', { name: 'More options' })).not.toHaveClass('min-h-11');
    expect(screen.getByRole('switch', { name: 'Add trailing stop' })).not.toHaveClass('h-11');
  });

  it('gives every control a 44 px target inside one', () => {
    render(
      <TouchTargets>
        <Controls />
      </TouchTargets>,
    );
    expect(screen.getByRole('radio', { name: '%' })).toHaveClass('h-11', 'min-w-11');
    expect(screen.getByRole('button', { name: 'Increase trail' })).toHaveClass('size-11');
    expect(screen.getByRole('button', { name: 'More options' })).toHaveClass(
      'min-h-11',
      'min-w-11',
    );
    expect(screen.getByRole('switch', { name: 'Add trailing stop' })).toHaveClass(
      'h-11',
      'min-w-11',
    );
  });
});

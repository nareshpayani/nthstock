import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  orderSoundsEnabled,
  resetOrderSoundsForTests,
  setOrderSoundsEnabled,
} from '@/shared/motion/orderSounds';
import { SoundToggle } from './SoundToggle';

describe('SoundToggle (A17)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetOrderSoundsForTests();
  });

  it('starts pressed, flips on click and persists the setting', () => {
    render(<SoundToggle />);
    const toggle = screen.getByRole('button', { name: 'Order sounds' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(orderSoundsEnabled()).toBe(false);
    expect(window.localStorage.getItem('nthstock.sounds')).toBe('off');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem('nthstock.sounds')).toBeNull();
  });

  it('keeps a second toggle on screen in sync', () => {
    render(
      <>
        <SoundToggle />
        <SoundToggle />
      </>,
    );
    const [first, second] = screen.getAllByRole('button', { name: 'Order sounds' });
    fireEvent.click(first as HTMLElement);
    expect(second).toHaveAttribute('aria-pressed', 'false');
    act(() => setOrderSoundsEnabled(true));
    expect(first).toHaveAttribute('aria-pressed', 'true');
  });
});

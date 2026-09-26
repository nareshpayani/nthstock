import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IconPlus } from '../icons/icons.js';
import { Button } from './Button.js';
import { IconButton } from './IconButton.js';

describe('Button', () => {
  it('calls onClick when enabled', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Buy</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Buy' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not fire when disabled', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Buy
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Buy' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is busy and ignores clicks while loading', () => {
    const onClick = vi.fn();
    render(
      <Button variant="sell" loading onClick={onClick}>
        Sell
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Sell' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applies variant classes and defaults to type=button', () => {
    render(<Button variant="buy">Buy</Button>);
    const button = screen.getByRole('button', { name: 'Buy' });
    expect(button).toHaveClass('bg-up', 'text-surface');
    expect(button).toHaveAttribute('type', 'button');
  });
});

describe('IconButton', () => {
  it('has an accessible name from label', () => {
    const onClick = vi.fn();
    render(<IconButton label="Add stock" icon={<IconPlus />} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add stock' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('supports disabled and loading', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <IconButton label="Refresh" icon={<IconPlus />} disabled onClick={onClick} />,
    );
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    rerender(<IconButton label="Refresh" icon={<IconPlus />} loading onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Refresh' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

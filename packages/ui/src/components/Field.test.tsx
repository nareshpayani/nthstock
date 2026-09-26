import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Field } from './Field.js';
import { Input } from './Input.js';
import { NumberInput } from './NumberInput.js';
import { OtpInput } from './OtpInput.js';

describe('Field + Input', () => {
  it('labels the control and announces the error via aria-describedby', () => {
    render(
      <Field label="Mobile number" hint="10 digits" error="Enter a valid mobile number">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText('Mobile number');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a valid mobile number 10 digits');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid mobile number');
  });

  it('is valid with only a hint', () => {
    render(
      <Field label="Name" hint="As on PAN" hideLabel>
        <Input leading="@" trailing="unit" aria-describedby="extra" />
      </Field>,
    );
    const input = screen.getByLabelText('Name');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input.getAttribute('aria-describedby')).toMatch(/-hint extra$/);
  });

  it('works without a Field', () => {
    render(<Input aria-label="Search" />);
    expect(screen.getByRole('textbox', { name: 'Search' })).not.toHaveAttribute('aria-invalid');
  });
});

function Qty({ initial = null as number | null, mode = 'integer' as 'integer' | 'price' }) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <>
      <Field label="Value">
        <NumberInput
          mode={mode}
          value={value}
          onChange={setValue}
          max={mode === 'price' ? 1_000_000 : 10}
        />
      </Field>
      <output data-testid="out">{String(value)}</output>
    </>
  );
}

describe('NumberInput', () => {
  it('steps integers with buttons and arrow keys within min/max', () => {
    render(<Qty initial={9} />);
    const input = screen.getByLabelText('Value');
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(screen.getByTestId('out')).toHaveTextContent('10');
    expect(screen.getByRole('button', { name: 'Increase quantity' })).toBeDisabled();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByTestId('out')).toHaveTextContent('8');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('out')).toHaveTextContent('8');
  });

  it('parses typed integers and rejects decimals', () => {
    render(<Qty />);
    const input = screen.getByLabelText('Value');
    fireEvent.change(input, { target: { value: '7' } });
    expect(screen.getByTestId('out')).toHaveTextContent('7');
    fireEvent.change(input, { target: { value: '7.5' } });
    expect(screen.getByTestId('out')).toHaveTextContent('null');
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(screen.getByTestId('out')).toHaveTextContent('1');
  });

  it('holds prices as paise, steps by the tick and snaps on blur', () => {
    render(<Qty mode="price" initial={184000} />);
    const input = screen.getByLabelText('Value');
    expect(input).toHaveValue('1840.00');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getByTestId('out')).toHaveTextContent('184005');
    fireEvent.change(input, { target: { value: '1840.07' } });
    expect(screen.getByTestId('out')).toHaveTextContent('184007');
    fireEvent.blur(input);
    expect(screen.getByTestId('out')).toHaveTextContent('184005');
    expect(input).toHaveValue('1840.05');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease rupees' }));
    expect(screen.getByTestId('out')).toHaveTextContent('184000');
  });
});

function Otp({ onComplete }: { onComplete: (code: string) => void }) {
  const [code, setCode] = useState('');
  return (
    <Field label="OTP" error={code === '000000' ? 'Wrong code' : undefined}>
      <OtpInput value={code} onChange={setCode} onComplete={onComplete} />
    </Field>
  );
}

describe('OtpInput', () => {
  it('fills all six boxes when 123456 is pasted', () => {
    const onComplete = vi.fn();
    render(<Otp onComplete={onComplete} />);
    const boxes = screen.getAllByRole('textbox');
    expect(boxes).toHaveLength(6);
    fireEvent.paste(boxes[0] as HTMLElement, { clipboardData: { getData: () => '123456' } });
    expect(boxes.map((box) => (box as HTMLInputElement).value)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('advances on typing, goes back on Backspace and ignores letters', () => {
    render(<Otp onComplete={vi.fn()} />);
    const boxes = screen.getAllByRole('textbox') as HTMLInputElement[];
    fireEvent.change(boxes[0] as HTMLElement, { target: { value: '4' } });
    expect(boxes[1]).toHaveFocus();
    fireEvent.change(boxes[1] as HTMLElement, { target: { value: 'a' } });
    expect(boxes[1]?.value).toBe('');
    fireEvent.keyDown(boxes[1] as HTMLElement, { key: 'Backspace' });
    expect(boxes[0]).toHaveFocus();
    expect(boxes[0]?.value).toBe('');
    fireEvent.keyDown(boxes[0] as HTMLElement, { key: 'ArrowRight' });
    expect(boxes[1]).toHaveFocus();
    fireEvent.keyDown(boxes[1] as HTMLElement, { key: 'ArrowLeft' });
    expect(boxes[0]).toHaveFocus();
  });

  it('accepts a whole code typed into one box (autofill) and announces errors', () => {
    render(<Otp onComplete={vi.fn()} />);
    const boxes = screen.getAllByRole('textbox') as HTMLInputElement[];
    fireEvent.change(boxes[0] as HTMLElement, { target: { value: '000000' } });
    expect(boxes[0]).toHaveAttribute('aria-invalid', 'true');
    expect(boxes[0]).toHaveAccessibleDescription('Wrong code');
    expect(screen.getByLabelText('OTP')).toBe(boxes[0]);
  });
});

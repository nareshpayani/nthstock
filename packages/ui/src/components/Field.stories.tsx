import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { IconSearch } from '../icons/icons.js';
import { Field } from './Field.js';
import { Input } from './Input.js';
import { NumberInput } from './NumberInput.js';
import { OtpInput } from './OtpInput.js';

const meta = {
  title: 'Forms/Field',
  component: Field,
  args: { label: 'Mobile number', children: null },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TextInput: Story = {
  render: () => (
    <Field label="Mobile number" hint="We send a 6-digit OTP to this number" className="max-w-sm">
      <Input inputMode="numeric" placeholder="98765 43210" />
    </Field>
  ),
};

export const WithError: Story = {
  render: () => (
    <Field label="Mobile number" error="Enter a 10-digit mobile number" className="max-w-sm">
      <Input defaultValue="12345" />
    </Field>
  ),
};

export const Search: Story = {
  render: () => (
    <Field label="Search stocks" hideLabel className="max-w-sm">
      <Input
        leading={<IconSearch size={18} />}
        placeholder="Search eg: INFY, Reliance"
        trailing="/"
      />
    </Field>
  ),
};

function QuantityAndPrice() {
  const [qty, setQty] = useState<number | null>(10);
  const [price, setPrice] = useState<number | null>(184000);
  return (
    <div className="grid max-w-xs gap-4">
      <Field label="Quantity" hint="Shares, whole numbers only">
        <NumberInput mode="integer" value={qty} onChange={setQty} />
      </Field>
      <Field label="Limit price" hint="Tick ₹0.05">
        <NumberInput mode="price" value={price} onChange={setPrice} />
      </Field>
    </div>
  );
}

export const NumberInputs: Story = { render: () => <QuantityAndPrice /> };

function Otp({ error }: { error?: string }) {
  const [code, setCode] = useState('');
  return (
    <Field label="Enter OTP" hint="Sent to +91 98765 43210" error={error}>
      <OtpInput value={code} onChange={setCode} />
    </Field>
  );
}

export const OneTimePassword: Story = { render: () => <Otp /> };
export const OneTimePasswordError: Story = {
  render: () => <Otp error="Incorrect OTP. 2 attempts left." />,
};

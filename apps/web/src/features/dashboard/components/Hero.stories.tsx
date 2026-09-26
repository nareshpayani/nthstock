import type { Meta, StoryObj } from '@storybook/react-vite';
import { fromIst } from '@nthstock/utils';
import { useState } from 'react';
import { StoryAuthProviders } from '@/mocks/storyAuth';
import { signIn, signOut, testSession } from '@/test/session';
import { Hero } from './Hero';

type DemoProps = { name: string | null; signedIn: boolean; istHour: number };

function Demo({ name, signedIn, istHour }: DemoProps) {
  useState(() => {
    if (signedIn) signIn(testSession({ name }));
    else signOut();
    return null;
  });
  return (
    <StoryAuthProviders>
      <div className="bg-canvas p-4">
        <Hero now={fromIst(2026, 9, 25, istHour * 60)} />
      </div>
    </StoryAuthProviders>
  );
}

const meta = {
  title: 'Dashboard/Hero',
  component: Demo,
  parameters: { layout: 'fullscreen' },
  args: { name: 'Asha Rao', signedIn: false, istHour: 8 },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 08:00 IST, signed out: the greeting and the onboarding call to action (T-093). */
export const SignedOutMorning: Story = {};
/** 13:00 IST, signed in: the first name from the session and a link to funds. */
export const SignedInAfternoon: Story = { args: { signedIn: true, istHour: 13 } };
/** 19:00 IST, signed in without a profile name: the plain greeting. */
export const SignedInNoNameEvening: Story = {
  args: { signedIn: true, name: null, istHour: 19 },
};

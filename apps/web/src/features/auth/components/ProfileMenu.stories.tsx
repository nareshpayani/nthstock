import type { KycStatus } from '@nthstock/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { StoryAuthProviders } from '@/mocks/storyAuth';
import { signIn, signOut, testSession } from '@/test/session';
import { KycBadge, ProfileMenu } from './ProfileMenu';

type DemoProps = { name: string | null; kycStatus: KycStatus; signedIn: boolean };

function Demo({ name, kycStatus, signedIn }: DemoProps) {
  useState(() => {
    if (signedIn) signIn(testSession({ name, kycStatus }));
    else signOut();
    return null;
  });
  return (
    <StoryAuthProviders>
      <div className="flex justify-end bg-surface p-4">
        <ProfileMenu />
      </div>
    </StoryAuthProviders>
  );
}

const meta = {
  title: 'Auth/ProfileMenu',
  component: Demo,
  args: { name: 'Asha Rao', kycStatus: 'VERIFIED', signedIn: true },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Initials; the menu shows the name, masked mobile, mocked KYC badge and Log out (T-090). */
export const SignedIn: Story = {};
export const NoNameKycPending: Story = { args: { name: null, kycStatus: 'PENDING' } };
export const SignedOut: Story = { args: { signedIn: false } };

/** Every mocked KYC state: icon and words, never colour alone. */
export const KycBadges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 bg-surface p-4">
      <KycBadge status="VERIFIED" />
      <KycBadge status="PENDING" />
      <KycBadge status="NOT_STARTED" />
    </div>
  ),
};

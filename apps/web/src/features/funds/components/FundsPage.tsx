import { IconWallet } from '@nthstock/ui';
import { PlaceholderPage } from '@/shared/components/PlaceholderPage';
import { strings } from '../strings';

export function FundsPage() {
  return (
    <PlaceholderPage
      title={strings.title}
      description={strings.description}
      emptyTitle={strings.emptyTitle}
      emptyBody={strings.emptyBody}
      icon={<IconWallet size={24} />}
    />
  );
}

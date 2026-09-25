import { IconClock } from '@nthstock/ui';
import { PlaceholderPage } from '@/shared/components/PlaceholderPage';
import { strings } from '../strings';

export function OrdersPage() {
  return (
    <PlaceholderPage
      title={strings.title}
      description={strings.description}
      emptyTitle={strings.emptyTitle}
      emptyBody={strings.emptyBody}
      icon={<IconClock size={24} />}
    />
  );
}

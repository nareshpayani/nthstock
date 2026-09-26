import { IconChart } from '@nthstock/ui';
import { PlaceholderPage } from '@/shared/components/PlaceholderPage';
import { strings } from '../strings';

export function PositionsPage() {
  return (
    <PlaceholderPage
      title={strings.title}
      description={strings.description}
      emptyTitle={strings.emptyTitle}
      emptyBody={strings.emptyBody}
      icon={<IconChart size={24} />}
    />
  );
}

import { IconBriefcase } from '@nthstock/ui';
import { PlaceholderPage } from '@/shared/components/PlaceholderPage';
import { strings } from '../strings';

export function PortfolioPage() {
  return (
    <PlaceholderPage
      title={strings.title}
      description={strings.description}
      emptyTitle={strings.emptyTitle}
      emptyBody={strings.emptyBody}
      icon={<IconBriefcase size={24} />}
    />
  );
}

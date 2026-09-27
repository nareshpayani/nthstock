import { Button, ErrorState, IconRefresh, useToast } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { holdingsQuery } from '@/features/holdings';
import { positionsQuery } from '@/features/positions';
import { Card } from '@/shared/components/Card';
import { PageHeader } from '@/shared/components/PageHeader';
import { SkeletonRows } from '@/shared/components/SkeletonRows';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { fundsSummaryQuery } from '../api/fundsQuery';
import { useResetFunds } from '../hooks/useResetFunds';
import { describeResetError } from '../model/resetError';
import { strings } from '../strings';
import { FundsSummaryCard } from './FundsSummaryCard';
import { LedgerList } from './LedgerList';
import { ResetFundsDialog } from './ResetFundsDialog';

/**
 * Funds (T-158 to T-160): the summary (available, blocked, invested, total and the ₹10,00,000
 * opening balance), the virtualised ledger, and Reset paper balance behind a danger dialog that
 * needs RESET typed. Paper money only.
 */
export function FundsPage() {
  const api = useApiClient();
  const toast = useToast();
  const funds = useQuery(fundsSummaryQuery(api));
  const positions = useQuery(positionsQuery(api));
  const holdings = useQuery(holdingsQuery(api));
  const reset = useResetFunds();
  const [confirming, setConfirming] = useState(false);

  const confirmReset = () => {
    reset.mutate(undefined, {
      onSuccess: (summary) => {
        setConfirming(false);
        toast.show({
          title: strings.reset.done,
          description: strings.reset.doneBody(formatInr(summary.available)),
          tone: 'success',
        });
      },
      onError: (error) => {
        toast.show({
          title: strings.reset.failed,
          description: describeResetError(error),
          tone: 'error',
        });
      },
    });
  };

  let summary;
  if (funds.isError || positions.isError || holdings.isError) {
    summary = (
      <div className="rounded-lg border border-line bg-surface">
        <ErrorState
          title={strings.loadError.title}
          description={strings.loadError.body}
          retryLabel={strings.loadError.retry}
          onRetry={() => {
            void funds.refetch();
            void positions.refetch();
            void holdings.refetch();
          }}
        />
      </div>
    );
  } else if (funds.isPending || positions.isPending || holdings.isPending) {
    summary = (
      <div className="rounded-lg border border-line bg-surface px-4">
        <SkeletonRows count={2} label={strings.loading} />
      </div>
    );
  } else {
    summary = (
      <FundsSummaryCard
        funds={funds.data}
        positions={positions.data.items}
        holdings={holdings.data.items}
      />
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6">
      <PageHeader
        title={strings.title}
        description={strings.description}
        actions={
          <ResetFundsDialog
            trigger={
              <Button variant="secondary" icon={<IconRefresh size={16} />} className="text-down">
                {strings.reset.open}
              </Button>
            }
            open={confirming}
            onOpenChange={setConfirming}
            resetting={reset.isPending}
            onConfirm={confirmReset}
          />
        }
      />
      {summary}
      <Card title={strings.ledger.title}>
        <LedgerList />
      </Card>
    </div>
  );
}

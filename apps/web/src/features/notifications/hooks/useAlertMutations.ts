import type { CreatePriceAlertRequest, NotificationsResponse } from '@nthstock/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { alertsKeys, notificationsKeys } from '@/shared/lib/queryKeys';

/** `POST /v1/alerts`; the list refetches. */
export function useCreateAlert() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePriceAlertRequest) => api.request('priceAlertCreate', { body }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: alertsKeys.all }),
  });
}

/** `DELETE /v1/alerts/:id`; the list refetches. */
export function useCancelAlert() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.request('priceAlertCancel', { params: { id } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: alertsKeys.all }),
  });
}

/** `POST /v1/notifications/read`, all of them when `ids` is left out; the answer is the new list. */
export function useMarkNotificationsRead() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) =>
      api.request('notificationsMarkRead', { body: ids ? { ids } : {} }),
    onSuccess: (list: NotificationsResponse) => {
      queryClient.setQueryData(notificationsKeys.list(), list);
    },
  });
}

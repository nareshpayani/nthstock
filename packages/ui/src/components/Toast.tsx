import { Toast as ToastPrimitive } from 'radix-ui';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { IconClose } from '../icons/icons.js';
import { cn } from '../lib/cn.js';

export type ToastTone = 'info' | 'success' | 'error';

export type ToastMessage = {
  title: string;
  description?: string;
  tone?: ToastTone;
};

type ToastEntry = ToastMessage & { id: number };

type ToastApi = { show: (message: ToastMessage) => void };

const ToastContext = createContext<ToastApi | null>(null);

const toneClass: Record<ToastTone, string> = {
  info: 'border-l-brand',
  success: 'border-l-up',
  error: 'border-l-down',
};

/** Hosts toasts (mutation errors, order confirmations) in a polite live region. */
export function ToastProvider({
  children,
  duration = 5000,
}: {
  children: ReactNode;
  duration?: number;
}) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const show = useCallback((message: ToastMessage) => {
    setToasts((current) => [...current, { ...message, id: Date.now() + current.length }]);
  }, []);
  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      <ToastPrimitive.Provider duration={duration} swipeDirection="right">
        {children}
        {toasts.map((toast) => (
          <ToastPrimitive.Root
            key={toast.id}
            type={toast.tone === 'error' ? 'foreground' : 'background'}
            onOpenChange={(open) => {
              if (!open) setToasts((current) => current.filter((t) => t.id !== toast.id));
            }}
            className={cn(
              'flex items-start gap-3 rounded-md border border-l-4 border-line bg-surface p-3 shadow-overlay data-[state=open]:animate-pop-in',
              toneClass[toast.tone ?? 'info'],
            )}
          >
            <div className="grid flex-1 gap-0.5">
              <ToastPrimitive.Title className="text-body font-semibold text-ink">
                {toast.title}
              </ToastPrimitive.Title>
              {toast.description ? (
                <ToastPrimitive.Description className="text-label text-ink-muted">
                  {toast.description}
                </ToastPrimitive.Description>
              ) : null}
            </div>
            <ToastPrimitive.Close aria-label="Dismiss" className="text-ink-muted hover:text-ink">
              <IconClose size={16} />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed right-4 bottom-4 z-(--nth-z-toast) grid w-[min(360px,calc(100vw-32px))] gap-2 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

/** Returns { show } for the nearest ToastProvider. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}

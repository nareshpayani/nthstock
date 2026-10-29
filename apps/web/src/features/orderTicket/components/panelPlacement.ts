import type { SheetProps } from '@nthstock/ui';
import {
  useDockedPanels,
  useLandscapePhone,
  usePhoneLayout,
  useTouchScreen,
} from '@/shared/hooks/usePhoneLayout';
import { useSession } from '@/shared/hooks/useSession';
import { usePositionEditorStore } from '@/shared/lib/positionEditorStore';
import { useTicketIntentStore } from '@/shared/lib/ticketIntentStore';
import { useTrailingSheetStore } from '@/shared/lib/trailingSheetStore';

/**
 * In landscape the sheet takes the full height with its button pinned (SPEC-CR-1 §6.2), and is
 * kept to a readable width in the middle of the wide screen.
 */
const LANDSCAPE_SHEET = 'mx-auto h-dvh max-h-dvh w-full max-w-[560px] rounded-t-none';

export type PanelPlacement = Pick<SheetProps, 'side' | 'docked' | 'className' | 'touchSize'>;

/**
 * Where a trading panel (the order ticket, the trailing stop, the position editor) opens
 * (SPEC-CR-1 §6.2): a bottom sheet on a phone, full height in landscape, docked beside the page
 * from 600 to 1023 px, and a slide-over `desktopClass` wide from 1024 px (touch-sized on a tablet).
 */
export function usePanelPlacement(desktopClass: string): PanelPlacement {
  const phone = usePhoneLayout();
  const landscape = useLandscapePhone();
  const docked = useDockedPanels();
  const touchScreen = useTouchScreen();
  if (docked) return { side: 'right', docked: true };
  if (landscape) return { side: 'bottom', className: LANDSCAPE_SHEET };
  if (phone) return { side: 'bottom' };
  // A large tablet keeps the slide-over, with touch-size controls.
  return { side: 'right', className: desktopClass, touchSize: touchScreen };
}

/** Whether a trading panel is docked open, so the shell makes room for it beside the page. */
export function useDockedPanelOpen(): boolean {
  const docked = useDockedPanels();
  const { status } = useSession();
  const ticket = useTicketIntentStore((s) => s.intent !== null);
  const trailing = useTrailingSheetStore((s) => s.target !== null);
  const editor = usePositionEditorStore((s) => s.target !== null);
  return docked && status === 'authenticated' && (ticket || trailing || editor);
}

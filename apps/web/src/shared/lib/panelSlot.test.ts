import { afterEach, describe, expect, it } from 'vitest';
import { initialPositionEditorState, usePositionEditorStore } from './positionEditorStore';
import { initialTicketIntentState, useTicketIntentStore } from './ticketIntentStore';
import { initialTrailingSheetState, useTrailingSheetStore } from './trailingSheetStore';

afterEach(() => {
  useTicketIntentStore.setState(initialTicketIntentState);
  useTrailingSheetStore.setState(initialTrailingSheetState);
  usePositionEditorStore.setState(initialPositionEditorState);
});

const sheet = { symbol: 'INFY', exchange: 'NSE', token: 1 } as const;

describe('trading panel slot (SPEC-CR-1 §6.2)', () => {
  it('opening the trailing stop closes the ticket', () => {
    useTicketIntentStore.getState().openTicket({ symbol: 'INFY', exchange: 'NSE', side: 'BUY' });
    useTrailingSheetStore.getState().openSheet(sheet);
    expect(useTicketIntentStore.getState().intent).toBeNull();
    expect(useTrailingSheetStore.getState().target).not.toBeNull();
  });

  it('opening the editor closes the ticket and the trailing stop', () => {
    useTicketIntentStore.getState().openTicket({ symbol: 'INFY', exchange: 'NSE', side: 'BUY' });
    useTrailingSheetStore.getState().openSheet(sheet);
    usePositionEditorStore.getState().openEditor({ ...sheet, product: 'DELIVERY' });
    expect(useTicketIntentStore.getState().intent).toBeNull();
    expect(useTrailingSheetStore.getState().target).toBeNull();
    expect(usePositionEditorStore.getState().target).not.toBeNull();
  });

  it('opening the ticket closes the editor', () => {
    usePositionEditorStore.getState().openEditor({ ...sheet, product: 'DELIVERY' });
    useTicketIntentStore.getState().openTicket({ symbol: 'INFY', exchange: 'NSE', side: 'SELL' });
    expect(usePositionEditorStore.getState().target).toBeNull();
    expect(useTicketIntentStore.getState().intent?.side).toBe('SELL');
  });
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './Button.js';
import { Dialog, Sheet } from './Dialog.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './DropdownMenu.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs.js';
import { ToastProvider, useToast } from './Toast.js';
import { Tooltip, TooltipProvider } from './Tooltip.js';

describe.each([
  ['Dialog', Dialog],
  ['Sheet', Sheet],
] as const)('%s', (_name, Overlay) => {
  it('traps focus inside, closes on Esc and returns focus to the trigger', async () => {
    render(
      <Overlay
        title="Confirm order"
        description="Buy 10 INFY"
        trigger={<Button>Open</Button>}
        footer={<Button>Confirm</Button>}
      >
        <input aria-label="Quantity" />
      </Overlay>,
    );
    const trigger = screen.getByRole('button', { name: 'Open' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'Confirm order' });
    expect(dialog).toHaveAccessibleDescription('Buy 10 INFY');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    // Everything outside is hidden from assistive tech while open (focus trap + aria-hidden).
    expect(trigger.closest('[aria-hidden="true"]')).not.toBeNull();

    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('closes from the close button', async () => {
    render(<Overlay title="Help" defaultOpen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('Sheet', () => {
  it('can slide from the left', async () => {
    render(<Sheet title="Menu" side="left" defaultOpen />);
    expect(await screen.findByRole('dialog', { name: 'Menu' })).toHaveClass('left-0');
  });
});

describe('Tabs', () => {
  it('switches panels', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList aria-label="Lists">
          <TabsTrigger value="a">Gainers</TabsTrigger>
          <TabsTrigger value="b">Losers</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Gainers panel</TabsContent>
        <TabsContent value="b">Losers panel</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole('tab', { name: 'Gainers' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Losers' }), { button: 0 });
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Losers panel');
  });
});

describe('DropdownMenu', () => {
  it('opens from the keyboard and lists items', async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>More</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Account</DropdownMenuLabel>
          <DropdownMenuItem>Settings</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Log out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), { key: 'Enter' });
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Settings',
      'Log out',
    ]);
  });
});

describe('Tooltip', () => {
  it('shows its content on focus', async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip content="Keyboard shortcuts">
          <Button>?</Button>
        </Tooltip>
      </TooltipProvider>,
    );
    fireEvent.focus(screen.getByRole('button', { name: '?' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Keyboard shortcuts');
  });
});

function ToastButton() {
  const toast = useToast();
  return (
    <Button
      onClick={() =>
        toast.show({ title: 'Order placed', description: 'Buy 10 INFY', tone: 'success' })
      }
    >
      Place
    </Button>
  );
}

describe('Toast', () => {
  it('shows a toast and dismisses it', async () => {
    render(
      <ToastProvider>
        <ToastButton />
      </ToastProvider>,
    );
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Place' }));
    });
    expect((await screen.findAllByText('Order placed')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument(),
    );
  });

  it('throws outside a provider', () => {
    expect(() => render(<ToastButton />)).toThrow(/ToastProvider/);
  });
});

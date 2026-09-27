import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button.js';
import { Dialog, Sheet } from './Dialog.js';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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

  it('leaves Esc to a control whose own popup is open', async () => {
    render(
      <Overlay title="Menu" defaultOpen>
        <input aria-label="Search" role="combobox" aria-expanded="true" aria-controls="list" />
        <div id="list" role="listbox" aria-label="Results" />
      </Overlay>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Menu' });
    const search = screen.getByRole('combobox', { name: 'Search' });
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(dialog).toBeInTheDocument();
    search.setAttribute('aria-expanded', 'false');
    fireEvent.keyDown(search, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
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

  it('returns focus to returnFocus when opened without a trigger, over a light overlay', async () => {
    function Ticket() {
      const buy = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button ref={buy} onClick={() => setOpen(true)}>
            Buy INFY
          </Button>
          <Sheet
            title="Trade INFY"
            open={open}
            onOpenChange={setOpen}
            returnFocus={buy}
            overlay="light"
          >
            <input aria-label="Quantity" />
          </Sheet>
        </>
      );
    }
    render(<Ticket />);
    const buy = screen.getByRole('button', { name: 'Buy INFY' });
    buy.focus();
    fireEvent.click(buy);
    const dialog = await screen.findByRole('dialog', { name: 'Trade INFY' });
    expect(document.querySelector('[data-overlay="light"]')).toHaveClass('bg-ink/10');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(buy).toHaveFocus());
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

  it('draws a focus ring on the panel, which is a Tab stop (T-167)', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList aria-label="Lists">
          <TabsTrigger value="a">Gainers</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Gainers panel</TabsContent>
      </Tabs>,
    );
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('tabindex', '0');
    expect(panel.className).toContain('focus-visible:ring-2');
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

describe('DropdownMenu radio and checkbox items', () => {
  it('marks the chosen radio item and toggles checkbox items', async () => {
    const onValueChange = vi.fn();
    const onCheckedChange = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Sort</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="name" onValueChange={onValueChange}>
            <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="ltp">Last price</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuCheckboxItem checked onCheckedChange={onCheckedChange}>
            Banks
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Sort' }), { key: 'Enter' });
    const name = await screen.findByRole('menuitemradio', { name: 'Name' });
    expect(name).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Last price' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('menuitemcheckbox', { name: 'Banks' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Last price' }));
    expect(onValueChange).toHaveBeenCalledWith('ltp');
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

  it('renders an action next to the message', async () => {
    const onView = vi.fn();
    function ActionButton() {
      const toast = useToast();
      return (
        <Button
          onClick={() =>
            toast.show({
              title: 'Order executed',
              tone: 'success',
              action: {
                altText: 'Open Orders from the main navigation',
                element: (
                  <a
                    href="/orders"
                    onClick={(event) => {
                      event.preventDefault();
                      onView();
                    }}
                  >
                    View orders
                  </a>
                ),
              },
            })
          }
        >
          Place
        </Button>
      );
    }
    render(
      <ToastProvider>
        <ActionButton />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Place' }));
    const link = await screen.findByRole('link', { name: 'View orders' });
    expect(link).toHaveAttribute('href', '/orders');
    fireEvent.click(link);
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('throws outside a provider', () => {
    expect(() => render(<ToastButton />)).toThrow(/ToastProvider/);
  });
});

describe('initialFocus', () => {
  it('focuses the given element when the sheet opens', async () => {
    function Drawer() {
      const ref = useRef<HTMLInputElement>(null);
      return (
        <Sheet title="Menu" side="left" defaultOpen initialFocus={ref}>
          <button type="button">First</button>
          <input aria-label="Search" ref={ref} />
        </Sheet>
      );
    }
    render(<Drawer />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Search' })).toHaveFocus());
  });
});

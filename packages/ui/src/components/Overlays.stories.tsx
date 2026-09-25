import type { Meta, StoryObj } from '@storybook/react-vite';
import { IconLogout, IconMore, IconSettings } from '../icons/icons.js';
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
import { IconButton } from './IconButton.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs.js';
import { ToastProvider, useToast } from './Toast.js';
import { Tooltip, TooltipProvider } from './Tooltip.js';

const meta = {
  title: 'Overlays/Radix wrappers',
  component: Dialog,
  args: { title: 'Confirm order' },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DialogStory: Story = {
  name: 'Dialog',
  render: () => (
    <Dialog
      title="Confirm order"
      description="Buy 10 INFY at market price (paper trade)."
      trigger={<Button>Review order</Button>}
      footer={
        <>
          <Button variant="secondary">Cancel</Button>
          <Button variant="buy">Confirm buy</Button>
        </>
      }
    >
      <p className="text-body text-ink-muted">
        Required ₹18,423.50 · Available ₹10,00,000.00 (virtual)
      </p>
    </Dialog>
  ),
};

export const SheetStory: Story = {
  name: 'Sheet',
  render: () => (
    <Sheet
      title="Buy INFY"
      description="NSE · ₹1,842.35"
      trigger={<Button variant="buy">Buy</Button>}
      footer={
        <Button variant="buy" block>
          Buy INFY
        </Button>
      }
    >
      <p className="p-4 text-body text-ink-muted">Order ticket content goes here.</p>
    </Sheet>
  ),
};

export const TabsStory: Story = {
  name: 'Tabs',
  render: () => (
    <Tabs defaultValue="gainers" className="max-w-md">
      <TabsList aria-label="Market movers">
        <TabsTrigger value="gainers">Top gainers</TabsTrigger>
        <TabsTrigger value="losers">Top losers</TabsTrigger>
        <TabsTrigger value="active">Most active</TabsTrigger>
      </TabsList>
      <TabsContent value="gainers">Gainers list</TabsContent>
      <TabsContent value="losers">Losers list</TabsContent>
      <TabsContent value="active">Most active list</TabsContent>
    </Tabs>
  ),
};

export const DropdownMenuStory: Story = {
  name: 'DropdownMenu',
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="More" icon={<IconMore />} variant="secondary" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Account</DropdownMenuLabel>
        <DropdownMenuItem>
          <IconSettings size={16} /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <IconLogout size={16} /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const TooltipStory: Story = {
  name: 'Tooltip',
  render: () => (
    <TooltipProvider delayDuration={200}>
      <Tooltip content="Keyboard shortcuts (?)">
        <Button variant="secondary">Hover or focus me</Button>
      </Tooltip>
    </TooltipProvider>
  ),
};

function ToastDemo() {
  const toast = useToast();
  return (
    <div className="flex gap-2">
      <Button
        variant="buy"
        onClick={() =>
          toast.show({
            title: 'Order placed',
            description: 'Buy 10 INFY at market',
            tone: 'success',
          })
        }
      >
        Success toast
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast.show({ title: 'Order rejected', description: 'Market is closed.', tone: 'error' })
        }
      >
        Error toast
      </Button>
    </div>
  );
}

export const ToastStory: Story = {
  name: 'Toast',
  render: () => (
    <ToastProvider>
      <ToastDemo />
    </ToastProvider>
  ),
};

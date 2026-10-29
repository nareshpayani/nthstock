import { IconButton, IconSound, IconSoundOff } from '@nthstock/ui';
import { useOrderSounds } from '@/shared/motion/orderCues';

const LABEL = 'Order sounds';

/**
 * The mute switch for order sounds (A17), beside the buttons that make them: a speaker that shows
 * on or off, announced as a toggle ("Order sounds, pressed"). Haptics have their own setting.
 */
export function SoundToggle({ className }: { className?: string }) {
  const [enabled, setEnabled] = useOrderSounds();
  return (
    <IconButton
      label={LABEL}
      aria-pressed={enabled}
      title={enabled ? `${LABEL}: on` : `${LABEL}: off`}
      icon={enabled ? <IconSound /> : <IconSoundOff />}
      onClick={() => setEnabled(!enabled)}
      {...(className ? { className } : {})}
    />
  );
}

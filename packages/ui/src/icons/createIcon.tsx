import type { ReactNode, SVGProps } from 'react';

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  /** Pixel size of the square icon. Defaults to 20. */
  size?: number;
  /** Accessible name. Without it the icon is decorative (aria-hidden). */
  title?: string;
};

export type IconComponent = ((props: IconProps) => ReactNode) & { iconName: string };

/**
 * Builds a 24×24 stroke icon drawn in currentColor. Each icon is its own named export marked pure,
 * and its drawing is a function (not an element built at import time), so bundlers drop the icons an
 * app never imports.
 */
export function createIcon(name: string, draw: () => ReactNode): IconComponent {
  function Icon({ size = 20, title, ...rest }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        data-icon={name}
        role={title ? 'img' : undefined}
        aria-hidden={title ? undefined : true}
        focusable="false"
        {...rest}
      >
        {title ? <title>{title}</title> : null}
        {draw()}
      </svg>
    );
  }
  Icon.iconName = name;
  return Icon;
}

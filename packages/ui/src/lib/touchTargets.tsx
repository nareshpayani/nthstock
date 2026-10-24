import { createContext, useContext, type ReactNode } from 'react';

const TouchTargetsContext = createContext(false);

/**
 * Inside a phone surface (a bottom sheet), controls take their touch size: every tap target at
 * least 44 × 44 px (SPEC-TFC-1 §9.4, REQ-MOB-04). The desktop sizes stay as they are elsewhere.
 */
export function TouchTargets({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  return <TouchTargetsContext.Provider value={enabled}>{children}</TouchTargetsContext.Provider>;
}

/** True inside `TouchTargets`: controls should render at their touch size. */
export function useTouchTargets(): boolean {
  return useContext(TouchTargetsContext);
}

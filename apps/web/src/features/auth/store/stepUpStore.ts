import { create } from 'zustand';

/** An open step-up request: the dialog settles it. */
export type StepUpRequest = {
  /** The user has two-factor on, so the dialog also asks for an authenticator code. */
  totpRequired: boolean;
  resolve: () => void;
  reject: (reason: Error) => void;
};

type StepUpState = {
  request: StepUpRequest | null;
  /** Epoch ms the last step-up lasts until (from the server), so a page can step up first. */
  steppedUpUntil: number | null;
  /** Opens the dialog; resolves once the user has stepped up, rejects if they cancel. */
  ask: (totpRequired: boolean) => Promise<void>;
  settle: (outcome: { steppedUpUntil: number } | 'cancelled') => void;
};

/** Thrown into the action when the user closes the step-up dialog instead of confirming. */
export class StepUpCancelledError extends Error {
  constructor() {
    super('Step-up cancelled');
    this.name = 'StepUpCancelledError';
  }
}

/**
 * The step-up dialog's request (NSTOCK-0219). A Zustand store because the action that needs the
 * step-up (a mutation deep in a card) and the dialog (mounted once on the page) are far apart. It
 * holds no secret: the PIN, OTP and code stay in the dialog's own state.
 */
export const useStepUpStore = create<StepUpState>()((set, get) => ({
  request: null,
  steppedUpUntil: null,
  ask: (totpRequired) =>
    new Promise<void>((resolve, reject) => {
      // A second ask while one is open replaces it; the first caller sees a cancel.
      get().request?.reject(new StepUpCancelledError());
      set({ request: { totpRequired, resolve, reject } });
    }),
  settle: (outcome) => {
    const { request } = get();
    if (!request) return;
    if (outcome === 'cancelled') {
      set({ request: null });
      request.reject(new StepUpCancelledError());
      return;
    }
    set({ request: null, steppedUpUntil: outcome.steppedUpUntil });
    request.resolve();
  },
}));

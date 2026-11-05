import type { AppContext } from '../app/context';

export interface ScreenEnv {
  ctx: AppContext;
  /** Parameter der aktuellen Route, z. B. `ziel` bei „gewohnheit-neu“. */
  params: URLSearchParams;
  /** Nach dem ersten Start zu „Heute“ wechseln. */
  onboardingDone(): void;
}

/** Ein Screen liefert seinen Inhalt; der Rahmen setzt ihn ein und kümmert sich um den Fokus. */
export type Screen = (env: ScreenEnv) => Promise<HTMLElement>;

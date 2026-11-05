import type { LiveRepository } from '../data/repository';
import type { Clock } from '../platform/clock';

/** Abhängigkeiten der Use Cases. In Tests mit fester Uhr und fake-indexeddb befüllt. */
export interface AppContext {
  repo: LiveRepository;
  clock: Clock;
  newId: () => string;
}

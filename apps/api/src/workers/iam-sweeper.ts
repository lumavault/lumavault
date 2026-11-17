import type { ApiModule, ModuleContext } from "#/modules.js";
import { expireReservations } from "#/services/quotas/index.js";

// Abandoned uploads give their bytes back within this long after their 24-hour expiry.
export const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

export interface Sweeper {
  start(): void;
  /** Stops the timer and waits for a sweep in progress to finish. */
  stop(): Promise<void>;
}

export function createSweeper(
  ctx: Pick<ModuleContext, "db">,
  intervalMs: number = SWEEP_INTERVAL_MS,
  onError: (err: unknown) => void = (err) => console.error("reservation sweep failed", err),
): Sweeper {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();
  const tick = () => {
    running = running.then(() => expireReservations(ctx).then(() => undefined, onError));
  };
  return {
    start() {
      tick();
      timer = setInterval(tick, intervalMs);
      timer.unref();
    },
    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}

let sweeper: Sweeper | undefined;

export const module: ApiModule = {
  name: "iam-sweeper",
  start(ctx) {
    sweeper = createSweeper(ctx);
    sweeper.start();
  },
  async stop() {
    await sweeper?.stop();
  },
};

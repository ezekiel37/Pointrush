import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../database/schema.js';
import { safeErrorSummary } from '../database/safe-error.js';
import { createResendPayloadSender } from '../auth/auth.email.js';
import { EmailWorker } from '../auth/email-worker.js';
import { PaymentsService } from '../payments/payments.service.js';
import type { PaymentProvider } from '../payments/provider.js';

export interface PeriodicTask {
  name: string;
  everyMs: number;
  run: () => Promise<Record<string, unknown> | undefined>;
}

type Write = (line: string) => void;

// Runs each task on its own timer inside the server process. A task never
// overlaps itself; a slow run delays its next start instead of stacking.
// Results are logged only when something happened, failures always.
export class PeriodicRunner {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly running = new Set<Promise<void>>();
  private stopped = false;

  constructor(
    private readonly tasks: PeriodicTask[],
    private readonly write: Write = (line) => process.stdout.write(line),
    private readonly writeError: Write = (line) => process.stderr.write(line),
  ) {}

  start(firstDelayMs = 5000): void {
    for (const task of this.tasks) this.schedule(task, firstDelayMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    await Promise.allSettled([...this.running]);
  }

  private schedule(task: PeriodicTask, delayMs: number): void {
    if (this.stopped) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      const run = this.runOnce(task).finally(() => {
        this.running.delete(run);
        this.schedule(task, task.everyMs);
      });
      this.running.add(run);
    }, delayMs);
    timer.unref();
    this.timers.add(timer);
  }

  private async runOnce(task: PeriodicTask): Promise<void> {
    try {
      const result = await task.run();
      if (result)
        this.write(JSON.stringify({ event: task.name, ...result }) + '\n');
    } catch (error) {
      this.writeError(
        JSON.stringify({
          level: 'error',
          event: `${task.name}_failed`,
          cause: safeErrorSummary(error),
        }) + '\n',
      );
    }
  }
}

export function inlineWorkerTasks(options: {
  db: NodePgDatabase<typeof schema>;
  email?: { resendApiKey: string; encryptionKey: string };
  payments?: PaymentProvider;
}): PeriodicTask[] {
  const tasks: PeriodicTask[] = [];
  if (options.email) {
    const worker = new EmailWorker(
      options.db,
      options.email.encryptionKey,
      createResendPayloadSender(options.email.resendApiKey),
    );
    let lastPrune = 0;
    tasks.push({
      name: 'auth_email_batch',
      everyMs: 10_000,
      run: async () => {
        const outcomes: Record<string, number> = {};
        for (let count = 0; count < 25; count++) {
          const result = await worker.runOne();
          if (result === 'idle') break;
          outcomes[result] = (outcomes[result] ?? 0) + 1;
        }
        if (Date.now() - lastPrune > 3_600_000) {
          await worker.prune();
          lastPrune = Date.now();
        }
        return Object.keys(outcomes).length ? { outcomes } : undefined;
      },
    });
  }
  if (options.payments) {
    const service = new PaymentsService(options.db, options.payments);
    tasks.push({
      name: 'payout_batch',
      everyMs: 60_000,
      run: async () => {
        const result = await service.submitPendingWithdrawals(50);
        const busy = Object.values(result).some(
          (value) => typeof value === 'number' && value > 0,
        );
        return busy ? result : undefined;
      },
    });
  }
  return tasks;
}

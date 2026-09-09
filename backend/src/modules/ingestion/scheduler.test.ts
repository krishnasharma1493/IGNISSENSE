import { describe, it, expect, vi } from 'vitest';
import { serializeRuns } from './scheduler';

/** A promise the test resolves by hand, so a run can be held open. */
const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('serializeRuns', () => {
  it('drops a tick that fires while the previous run is still in flight', async () => {
    const gate = deferred();
    const task = vi.fn(() => gate.promise);
    const onSkip = vi.fn();
    const run = serializeRuns(task, onSkip);

    const first = run();
    await run();
    await run();

    expect(task).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(2);

    gate.resolve();
    await first;
  });

  it('accepts the next tick once the run has finished', async () => {
    const gate = deferred();
    const task = vi.fn(() => gate.promise);
    const run = serializeRuns(task);

    const first = run();
    gate.resolve();
    await first;

    await run();
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('does not wedge the loop shut when a run throws', async () => {
    // A cycle that rejects must release the guard, or one transient failure
    // would silence the ingestion loop for the lifetime of the process.
    const task = vi.fn().mockRejectedValueOnce(new Error('FIRMS 503')).mockResolvedValue(undefined);
    const run = serializeRuns(task);

    await expect(run()).rejects.toThrow('FIRMS 503');
    await run();

    expect(task).toHaveBeenCalledTimes(2);
  });
});

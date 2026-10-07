/** Serial task queue: every state mutation and Chrome reconciliation runs one at a time. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T> | T): Promise<T> {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

export type Debounced<A extends unknown[]> = ((...args: A) => void) & { flush: () => void };

export const debounce = <A extends unknown[]>(fn: (...args: A) => void, wait: number, maxWait = wait * 4): Debounced<A> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let first: number | undefined;
  let lastArgs: A;
  const fire = () => {
    timer = undefined;
    first = undefined;
    fn(...lastArgs);
  };
  const debounced = ((...args: A) => {
    lastArgs = args;
    const now = Date.now();
    first ??= now;
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, now - first >= maxWait ? 0 : wait);
  }) as Debounced<A>;
  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      fire();
    }
  };
  return debounced;
};

export const withTimeout = async <T>(p: Promise<T>, ms: number, label = 'operation'): Promise<T> => {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(t);
  }
};

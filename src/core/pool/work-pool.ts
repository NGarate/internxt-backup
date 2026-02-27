export type PoolResult<T, R> =
  | { item: T; success: true; value: R }
  | { item: T; success: false; error: Error };

export async function processPool<T, R>(
  items: T[],
  handler: (item: T) => Promise<R>,
  maxConcurrency: number,
): Promise<Array<PoolResult<T, R>>> {
  if (items.length === 0) {
    return [];
  }

  const requestedConcurrency = Number.isFinite(maxConcurrency)
    ? Math.floor(maxConcurrency)
    : 1;
  const concurrency = Math.max(1, Math.min(requestedConcurrency, items.length));
  let nextIndex = 0;
  const results = Array.from({ length: items.length }) as Array<
    PoolResult<T, R>
  >;

  const worker = async (): Promise<void> => {
    while (true) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) {
        return;
      }

      try {
        const value = await handler(items[currentIndex]);
        results[currentIndex] = {
          item: items[currentIndex],
          success: true,
          value,
        };
      } catch (error) {
        const resolvedError =
          error instanceof Error ? error : new Error(String(error));
        results[currentIndex] = {
          item: items[currentIndex],
          success: false,
          error: resolvedError,
        };
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

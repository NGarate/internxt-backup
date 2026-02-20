export async function processPool<T>(
  items: T[],
  handler: (item: T) => Promise<unknown>,
  maxConcurrency: number,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const requestedConcurrency = Number.isFinite(maxConcurrency)
    ? Math.floor(maxConcurrency)
    : 1;
  const concurrency = Math.max(1, Math.min(requestedConcurrency, items.length));
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) {
        return;
      }

      try {
        await handler(items[currentIndex]);
      } catch {
        // Keep processing remaining items, matching existing behavior.
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

import { describe, it, expect } from 'bun:test';
import { processPool } from './work-pool';

describe('processPool', () => {
  it('should process all items', async () => {
    const results: number[] = [];
    await processPool(
      [1, 2, 3, 4, 5],
      async (item) => {
        results.push(item);
      },
      3,
    );
    expect(results.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('should handle empty items', async () => {
    const results: number[] = [];
    await processPool(
      [],
      async (item: number) => {
        results.push(item);
      },
      3,
    );
    expect(results).toEqual([]);
  });

  it('should respect max concurrency', async () => {
    let activeTasks = 0;
    let maxActive = 0;

    await processPool(
      [1, 2, 3, 4, 5, 6],
      async () => {
        activeTasks++;
        maxActive = Math.max(maxActive, activeTasks);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeTasks--;
      },
      2,
    );

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('should continue processing after errors', async () => {
    const processed: number[] = [];

    await processPool(
      [1, 2, 3],
      async (item) => {
        if (item === 2) {
          throw new Error('test error');
        }
        processed.push(item);
      },
      2,
    );

    expect(processed).toContain(1);
  });

  it('should fallback to one worker for invalid concurrency', async () => {
    const processed: number[] = [];

    await processPool(
      [1, 2, 3],
      async (item) => {
        processed.push(item);
      },
      0,
    );

    expect(processed.sort()).toEqual([1, 2, 3]);
  });
});

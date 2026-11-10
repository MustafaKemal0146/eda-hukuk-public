// @tk TK-23
// KK-P03c-17 (KK-002-12): worker `maintenance` tüketemez; jobs yalnız `maintenance` tüketir.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUEUES } from '@eda/contracts/queues';
import { describe, expect, it } from 'vitest';
import { assertConsumerQueues, QueueOwnershipError } from '../src/config/queues.ts';

describe('KK-P03c-17: süreç-kuyruk sahipliği', () => {
  it('worker maintenance içeren listeyi reddeder', () => {
    expect(() => assertConsumerQueues('worker', ['chat', 'maintenance'])).toThrow(
      QueueOwnershipError,
    );
    expect(() => assertConsumerQueues('worker', ['maintenance'])).toThrow(/maintenance/);
  });

  it('worker maintenance dışındaki tüm kuyrukları kabul eder', () => {
    const others = QUEUES.filter((q) => q !== 'maintenance');
    expect(assertConsumerQueues('worker', others)).toEqual(others);
  });

  it('jobs yalnız maintenance kabul eder; başka kuyruk veya ek kuyruk reddedilir', () => {
    expect(assertConsumerQueues('jobs', ['maintenance'])).toEqual(['maintenance']);
    for (const q of QUEUES.filter((x) => x !== 'maintenance')) {
      expect(() => assertConsumerQueues('jobs', [q])).toThrow(QueueOwnershipError);
      expect(() => assertConsumerQueues('jobs', ['maintenance', q])).toThrow(QueueOwnershipError);
    }
  });

  it('boş veya yinelenen liste reddedilir', () => {
    expect(() => assertConsumerQueues('jobs', [])).toThrow(QueueOwnershipError);
    expect(() => assertConsumerQueues('jobs', ['maintenance', 'maintenance'])).toThrow(
      QueueOwnershipError,
    );
  });

  it('worker girişi bakım koduna ve eda_jobs havuzuna içe aktarma yapmaz', () => {
    const main = readFileSync(join(import.meta.dirname, '..', 'src', 'main.ts'), 'utf8');
    expect(main).not.toMatch(/processors\/maintenance|db\/jobs-pool|@eda\/db\/jobs|from '\.\/jobs/);
  });
});

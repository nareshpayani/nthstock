import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonLogger, silentLogger } from './logger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('jsonLogger', () => {
  it('writes one JSON line per entry, info to stdout and warnings and errors to stderr', () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    jsonLogger.info('hello', { port: 1 });
    jsonLogger.warn('careful');
    jsonLogger.error('broken', { code: 'X' });
    expect(JSON.parse(String(out.mock.calls[0]?.[0]))).toMatchObject({
      level: 'info',
      msg: 'hello',
      port: 1,
    });
    expect(err.mock.calls.map((call) => JSON.parse(String(call[0])).level)).toEqual([
      'warn',
      'error',
    ]);
  });

  it('has a silent twin for tests', () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    silentLogger.info('x');
    silentLogger.warn('x');
    silentLogger.error('x');
    expect(out).not.toHaveBeenCalled();
  });
});

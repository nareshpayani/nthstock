import { describe, expect, it, vi } from 'vitest';
import { WORKER_RELOAD_KEY, ensureWorkerControl } from './workerControl';

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const worker = { state: 'activated' } as unknown as ServiceWorker;

describe('ensureWorkerControl', () => {
  it('does nothing where service workers are unsupported', () => {
    const reload = vi.fn();
    expect(ensureWorkerControl({ serviceWorker: undefined, reload, storage: undefined })).toBe(
      'unsupported',
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once after a hard reload left the page without the worker', () => {
    const reload = vi.fn();
    const storage = memoryStorage();
    const env = { serviceWorker: { controller: null }, reload, storage };
    expect(ensureWorkerControl(env)).toBe('reloading');
    expect(reload).toHaveBeenCalledTimes(1);

    // Still uncontrolled after that reload: report it instead of reloading in a loop.
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(ensureWorkerControl(env)).toBe('uncontrolled');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('does not control this page'));
    error.mockRestore();
  });

  it('clears the reload flag once the worker controls the page', () => {
    const reload = vi.fn();
    const storage = memoryStorage();
    storage.setItem(WORKER_RELOAD_KEY, '1');
    expect(ensureWorkerControl({ serviceWorker: { controller: worker }, reload, storage })).toBe(
      'controlled',
    );
    expect(storage.getItem(WORKER_RELOAD_KEY)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });
});

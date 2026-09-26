import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { injectBackend, scenarioAddress } from './injectBackend.js';

describe('injectBackend', () => {
  it('sends JSON bodies, maps empty bodies to null and closes the app', async () => {
    const app = Fastify();
    // Returns a value computed from the body rather than echoing it back.
    app.post('/sum', (request) => {
      const { a, b } = request.body as { a: number; b: number };
      return { sum: Number(a) + Number(b) };
    });
    app.delete('/empty', (_request, reply) => reply.status(204).send());
    const backend = injectBackend(app);

    expect(await backend.send({ method: 'POST', url: '/sum', body: { a: 1, b: 2 } })).toEqual({
      status: 200,
      body: { sum: 3 },
    });
    expect(await backend.send({ method: 'DELETE', url: '/empty' })).toEqual({
      status: 204,
      body: null,
    });

    await backend.close?.();
    await expect(app.inject({ method: 'POST', url: '/sum', payload: {} })).rejects.toThrow();
  });
});

describe('injectBackend scopes', () => {
  it('forwards headers, returns Set-Cookie lines and gives each scope its own client IP', async () => {
    const app = Fastify();
    app.get('/who', (request, reply) => {
      void reply.header('set-cookie', ['a=1; Path=/', 'b=2; Path=/']);
      return { ip: request.ip, flavour: request.headers['x-flavour'] ?? null };
    });
    const advanced: number[] = [];
    const backend = injectBackend(app, { advanceTime: (ms) => advanced.push(ms) });

    const scoped = await backend.scope?.(3)?.send({
      method: 'GET',
      url: '/who',
      headers: { 'x-flavour': 'mint' },
    });
    const root = await backend.send({ method: 'GET', url: '/who' });
    await backend.advanceTime?.(5);

    expect(scoped).toEqual({
      status: 200,
      body: { ip: scenarioAddress(3), flavour: 'mint' },
      setCookies: ['a=1; Path=/', 'b=2; Path=/'],
    });
    expect(root.body).toEqual({ ip: '127.0.0.1', flavour: null });
    expect(scenarioAddress(3)).not.toBe(scenarioAddress(4));
    expect(advanced).toEqual([5]);
    await backend.close?.();
  });
});

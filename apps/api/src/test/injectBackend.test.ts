import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { injectBackend } from './injectBackend.js';

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

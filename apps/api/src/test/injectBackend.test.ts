import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { injectBackend } from './injectBackend.js';

describe('injectBackend', () => {
  it('sends JSON bodies, maps empty bodies to null and closes the app', async () => {
    const app = Fastify();
    app.post('/echo', (request) => request.body);
    app.delete('/empty', (_request, reply) => reply.status(204).send());
    const backend = injectBackend(app);

    expect(await backend.send({ method: 'POST', url: '/echo', body: { a: 1 } })).toEqual({
      status: 200,
      body: { a: 1 },
    });
    expect(await backend.send({ method: 'DELETE', url: '/empty' })).toEqual({
      status: 204,
      body: null,
    });

    await backend.close?.();
    await expect(app.inject({ method: 'POST', url: '/echo', payload: {} })).rejects.toThrow();
  });
});

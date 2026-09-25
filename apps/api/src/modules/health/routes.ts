import type { FastifyPluginAsync } from 'fastify';

export interface HealthResponse {
  status: 'ok';
  uptimeSeconds: number;
}

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (): Promise<HealthResponse> => {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  });
};

/** The few log calls the realtime server makes; tests pass a silent or recording logger. */
export type Logger = {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
};

const line = (level: string, message: string, fields?: Record<string, unknown>) =>
  JSON.stringify({ level, time: new Date().toISOString(), msg: message, ...fields });

/** One JSON line per entry on stdout/stderr, the same shape Fastify's logger uses in apps/api. */
export const jsonLogger: Logger = {
  info: (message, fields) => process.stdout.write(`${line('info', message, fields)}\n`),
  warn: (message, fields) => process.stderr.write(`${line('warn', message, fields)}\n`),
  error: (message, fields) => process.stderr.write(`${line('error', message, fields)}\n`),
};

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

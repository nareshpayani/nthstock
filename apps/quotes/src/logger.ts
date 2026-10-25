/** One JSON line per event on stdout (warnings on stderr), as apps/realtime logs. */
export const jsonLogger = {
  info(message: string, fields: Record<string, unknown> = {}) {
    process.stdout.write(`${JSON.stringify({ level: 'info', msg: message, ...fields })}\n`);
  },
  warn(message: string, fields: Record<string, unknown> = {}) {
    process.stderr.write(`${JSON.stringify({ level: 'warn', msg: message, ...fields })}\n`);
  },
  error(message: string, fields: Record<string, unknown> = {}) {
    process.stderr.write(`${JSON.stringify({ level: 'error', msg: message, ...fields })}\n`);
  },
};

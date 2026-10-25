import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openApiText } from './modules/docs/index.js';

// `npm run openapi` (T-236): writes the OpenAPI document the API serves at
// /v1/docs/openapi.json to docs/api/openapi.json. CI regenerates it and fails when the committed
// copy differs (T-237), and apps/api's docs route test compares the two as well.
export const OPENAPI_FILE = fileURLToPath(
  new URL('../../../docs/api/openapi.json', import.meta.url),
);

writeFileSync(OPENAPI_FILE, openApiText());
process.stdout.write(`Wrote ${OPENAPI_FILE}\n`);

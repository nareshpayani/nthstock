import { describe, expect, it } from 'vitest';
import {
  OPENAPI_PATH,
  buildOpenApiDocument,
  renderOpenApiDocument,
  toOpenApiPath,
  type OpenApiOperation,
} from './openapi.js';
import { routes, type RouteDef } from './routes.js';

const doc = buildOpenApiDocument({ version: '1.2.3' });
const operations = Object.entries(doc.paths).flatMap(([path, item]) =>
  Object.entries(item).map(([method, op]) => ({ path, method, op: op as OpenApiOperation })),
);
const routeEntries = Object.entries(routes) as Array<[string, RouteDef]>;

/** Every `$ref` in the document, wherever it sits. */
function refsIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refsIn);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === '$ref' && typeof child === 'string' ? [child] : refsIn(child),
  );
}

describe('OpenAPI document (T-235)', () => {
  it('is OpenAPI 3.1 with the given version', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.version).toBe('1.2.3');
    expect(buildOpenApiDocument().info.version).toBe('0.0.0');
  });

  it('lists every route in the map exactly once, with its method, path and auth', () => {
    expect(operations).toHaveLength(routeEntries.length);
    for (const [name, def] of routeEntries) {
      const matches = operations.filter((entry) => entry.op.operationId === name);
      expect(matches, name).toHaveLength(1);
      const [match] = matches;
      expect(match?.path, name).toBe(toOpenApiPath(def.path));
      expect(match?.method, name).toBe(def.method.toLowerCase());
      expect(match?.op['x-auth'], name).toBe(def.auth);
      expect(match?.op.security, name).toEqual(
        def.auth === 'user' ? [{ cookieAuth: [] }, { bearerAuth: [] }] : [],
      );
    }
  });

  it('documents path params, query, bodies and responses from the schemas', () => {
    for (const [name, def] of routeEntries) {
      const op = operations.find((entry) => entry.op.operationId === name)?.op;
      const pathParams = [...def.path.matchAll(/:([A-Za-z]+)/g)].map((match) => match[1]);
      const documented = (op?.parameters ?? []).filter((p) => p.in === 'path').map((p) => p.name);
      expect(documented.sort(), name).toEqual(pathParams.sort());
      expect(Boolean(op?.requestBody), name).toBe(Boolean(def.body));
      expect(op?.responses['200'], name).toBeDefined();
    }
    const place = operations.find((entry) => entry.op.operationId === 'orderPlace')?.op;
    const body = place?.requestBody?.content['application/json'].schema;
    expect(body?.['required']).toEqual(expect.arrayContaining(['token', 'side', 'qty']));
    const search = operations.find((entry) => entry.op.operationId === 'marketSearch')?.op;
    expect(search?.parameters).toContainEqual(
      expect.objectContaining({ name: 'q', in: 'query', required: true }),
    );
  });

  it('answers every route with the ApiError envelope on errors', () => {
    for (const { op } of operations) {
      expect(op.responses['default']).toEqual({ $ref: '#/components/responses/ApiError' });
    }
    expect(doc.components.schemas['ApiError']).toMatchObject({ type: 'object' });
  });

  it('declares the cookie and bearer security schemes', () => {
    expect(Object.keys(doc.components.securitySchemes).sort()).toEqual([
      'bearerAuth',
      'cookieAuth',
    ]);
  });

  it('resolves every $ref inside the document', () => {
    for (const ref of refsIn(doc)) {
      const [, section, kind, id] = ref.split('/');
      expect(section, ref).toBe('components');
      const group = doc.components[kind as keyof typeof doc.components] as Record<string, unknown>;
      expect(group[id ?? ''], ref).toBeDefined();
    }
  });

  it('has no unique ids, dialect markers or Express-style params left over', () => {
    const text = renderOpenApiDocument();
    expect(text).not.toContain('"$schema"');
    expect(text).not.toContain('"$id"');
    expect(Object.keys(doc.paths).some((path) => path.includes(':'))).toBe(false);
    expect(doc.paths[OPENAPI_PATH]).toBeUndefined();
  });

  it('renders the same text every time', () => {
    expect(renderOpenApiDocument()).toBe(renderOpenApiDocument());
    expect(renderOpenApiDocument().endsWith('}\n')).toBe(true);
  });
});

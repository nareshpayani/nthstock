import { z } from 'zod';
import * as account from './account.js';
import * as alerts from './alerts.js';
import * as auth from './auth.js';
import * as market from './market.js';
import * as orders from './orders.js';
import * as portfolio from './portfolio.js';
import * as primitives from './primitives.js';
import { routes, type RouteDef } from './routes.js';
import * as routeSchemas from './routes.js';
import * as trailingStops from './trailingStops.js';
import * as watchlist from './watchlist.js';

/**
 * OpenAPI 3.1 for the REST API (T-235, spec backend-core §11), built from the route map with Zod's
 * own `z.toJSONSchema()`. Nothing is written by hand: a route added to `routes` shows up here, in
 * `GET /v1/docs/openapi.json` and in the committed `docs/api/openapi.json` (`npm run openapi`).
 */

/** A JSON Schema object as `z.toJSONSchema` emits it (draft 2020-12, which OpenAPI 3.1 uses). */
export type JsonSchema = Record<string, unknown>;

export type OpenApiParameter = {
  name: string;
  in: 'path' | 'query';
  required: boolean;
  schema: JsonSchema;
  description?: string;
};

export type OpenApiOperation = {
  operationId: string;
  tags: string[];
  summary: string;
  security: Array<Record<string, string[]>>;
  parameters?: OpenApiParameter[];
  requestBody?: {
    required: true;
    content: { 'application/json': { schema: JsonSchema } };
  };
  responses: Record<string, unknown>;
  /** `public` or `user`, as declared in the route map (contract tests read it back). */
  'x-auth': RouteDef['auth'];
};

export type OpenApiDocument = {
  openapi: '3.1.0';
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string; description: string }>;
  tags: Array<{ name: string }>;
  paths: Record<string, Partial<Record<Lowercase<RouteDef['method']>, OpenApiOperation>>>;
  components: {
    schemas: Record<string, JsonSchema>;
    responses: Record<string, unknown>;
    securitySchemes: Record<string, unknown>;
  };
};

export type OpenApiOptions = {
  /** `info.version`, e.g. the API version `GET /v1/health` reports. */
  version?: string;
};

/** Security schemes: the httpOnly access cookie the web app uses, or the same JWT as a Bearer. */
export const OPENAPI_SECURITY = {
  cookieAuth: {
    type: 'apiKey',
    in: 'cookie',
    name: auth.AUTH_COOKIES.access,
    description: `Access JWT cookie set by the auth routes. State-changing requests must also send the session's CSRF token in the ${auth.AUTH_CSRF_HEADER} header.`,
  },
  bearerAuth: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'The same access JWT as an Authorization header (no CSRF header needed).',
  },
} as const;

/** The path outside the route map that serves this document. */
export const OPENAPI_PATH = '/v1/docs/openapi.json';

const API_ERROR_REF = '#/components/responses/ApiError';
const schemaRef = (id: string) => `#/components/schemas/${id}`;

/** Exported Zod schemas by their export name; these become `components.schemas`. */
const SCHEMA_MODULES = [
  primitives,
  market,
  auth,
  watchlist,
  orders,
  trailingStops,
  alerts,
  portfolio,
  account,
  routeSchemas,
];

function namedSchemas(): Map<z.ZodType, string> {
  const names = new Map<z.ZodType, string>();
  for (const module of SCHEMA_MODULES) {
    for (const [name, value] of Object.entries(module)) {
      // PascalCase exports only: constants (UPPER_SNAKE) and helpers are not schemas.
      if (!(value instanceof z.ZodType) || !/^[A-Z][a-z]/.test(name)) continue;
      if (!names.has(value)) names.set(value, name);
    }
  }
  return names;
}

/** Drops the `$schema` dialect and `$id` keys: the document's own `openapi` field sets the dialect. */
const stripDialect = (schema: JsonSchema): JsonSchema =>
  Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$schema' && key !== '$id'));

/** `/v1/watchlists/:id/items/:token` → `/v1/watchlists/{id}/items/{token}`. */
export const toOpenApiPath = (path: string) => path.replace(/:([A-Za-z]+)/g, '{$1}');

/** `orderPlace` → "Order place". */
const summaryOf = (name: string) => {
  const words = name.replace(/([A-Z])/g, ' $1').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** `/v1/market/instruments/:symbol` → `market`. */
const tagOf = (path: string) => path.split('/')[2] ?? 'root';

/**
 * Path and query parameters from a params or query object schema: one parameter per property,
 * required as the schema says (path parameters are always required).
 */
function parametersOf(schema: z.ZodType | undefined, where: 'path' | 'query'): OpenApiParameter[] {
  if (!schema) return [];
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema;
  const properties = (json['properties'] ?? {}) as Record<string, JsonSchema>;
  const required = new Set((json['required'] ?? []) as string[]);
  return Object.entries(properties).map(([name, property]) => {
    const { description, ...rest } = property;
    return {
      name,
      in: where,
      required: where === 'path' || required.has(name),
      schema: rest,
      ...(typeof description === 'string' ? { description } : {}),
    };
  });
}

/** Builds the OpenAPI 3.1 document for every route in the map. Deterministic for a given map. */
export function buildOpenApiDocument(options: OpenApiOptions = {}): OpenApiDocument {
  const names = namedSchemas();
  // Responses are documented as the client receives them (io: output) and point at the named
  // component schemas; params, query and bodies as the client sends them (io: input), inline.
  const registry = z.registry<{ id: string }>();
  const used = new Set<string>(['ApiError']);
  for (const def of Object.values(routes) as RouteDef[]) {
    const name = names.get(def.response);
    if (name) used.add(name);
  }
  for (const [schema, name] of names) {
    if (used.has(name)) registry.add(schema, { id: name });
  }
  const components = z.toJSONSchema(registry, {
    io: 'output',
    unrepresentable: 'any',
    uri: schemaRef,
  }) as { schemas: Record<string, JsonSchema> };
  const schemas: Record<string, JsonSchema> = {};
  for (const id of Object.keys(components.schemas).sort()) {
    schemas[id] = stripDialect(components.schemas[id] ?? {});
  }

  const paths: OpenApiDocument['paths'] = {};
  const tags = new Set<string>();
  for (const [name, def] of Object.entries(routes) as Array<[string, RouteDef]>) {
    const tag = tagOf(def.path);
    tags.add(tag);
    const responseName = names.get(def.response);
    const responseSchema = responseName
      ? { $ref: schemaRef(responseName) }
      : stripDialect(
          z.toJSONSchema(def.response, { io: 'output', unrepresentable: 'any' }) as JsonSchema,
        );
    const parameters = [...parametersOf(def.params, 'path'), ...parametersOf(def.query, 'query')];
    const operation: OpenApiOperation = {
      operationId: name,
      tags: [tag],
      summary: summaryOf(name),
      security: def.auth === 'user' ? [{ cookieAuth: [] }, { bearerAuth: [] }] : [],
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(def.body
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: stripDialect(
                    z.toJSONSchema(def.body, { io: 'input', unrepresentable: 'any' }) as JsonSchema,
                  ),
                },
              },
            },
          }
        : {}),
      responses: {
        '200': {
          description: 'Success',
          content: { 'application/json': { schema: responseSchema } },
        },
        default: { $ref: API_ERROR_REF },
      },
      'x-auth': def.auth,
    };
    const path = toOpenApiPath(def.path);
    const method = def.method.toLowerCase() as Lowercase<RouteDef['method']>;
    const item = (paths[path] ??= {});
    if (item[method]) throw new Error(`Two routes share ${def.method} ${def.path}`);
    item[method] = operation;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'nthstock API',
      version: options.version ?? '0.0.0',
      description:
        'REST API of nthstock, a paper-trading platform on simulated NSE/BSE data. Money is integer paise; times are UTC ISO 8601. Every non-2xx response uses the ApiError envelope. Generated from packages/contracts; do not edit by hand.',
    },
    servers: [{ url: '/', description: 'The API origin (paths include /v1)' }],
    tags: [...tags].sort().map((tag) => ({ name: tag })),
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    components: {
      schemas,
      responses: {
        ApiError: {
          description: 'Error (the ApiError envelope)',
          content: { 'application/json': { schema: { $ref: schemaRef('ApiError') } } },
        },
      },
      securitySchemes: OPENAPI_SECURITY,
    },
  };
}

/** The document as `npm run openapi` writes it and the API serves it: 2-space JSON, newline. */
export const renderOpenApiDocument = (options: OpenApiOptions = {}) =>
  `${JSON.stringify(buildOpenApiDocument(options), null, 2)}\n`;

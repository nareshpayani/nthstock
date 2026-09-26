import {
  WS_PROTOCOL_VERSION,
  WsClientMessage,
  type WsErrorCode,
  type WsServerMessage,
} from '@nthstock/contracts';

export type ParsedClientMessage =
  { ok: true; message: WsClientMessage } | { ok: false; code: WsErrorCode; message: string };

/**
 * Parses one client frame. Control messages are JSON text (T-074); anything else, a version other
 * than the current one, or a shape the contracts reject is an error the caller reports back.
 */
export function parseClientMessage(data: string | null): ParsedClientMessage {
  if (data === null) {
    return { ok: false, code: 'INVALID_MESSAGE', message: 'Control messages must be JSON text' };
  }
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return { ok: false, code: 'INVALID_MESSAGE', message: 'Message is not valid JSON' };
  }
  if (
    typeof json === 'object' &&
    json !== null &&
    'v' in json &&
    (json as { v: unknown }).v !== WS_PROTOCOL_VERSION
  ) {
    return {
      ok: false,
      code: 'UNSUPPORTED_VERSION',
      message: `Protocol version ${WS_PROTOCOL_VERSION} is required`,
    };
  }
  const parsed = WsClientMessage.safeParse(json);
  if (!parsed.success) {
    return { ok: false, code: 'INVALID_MESSAGE', message: 'Message does not match the protocol' };
  }
  return { ok: true, message: parsed.data };
}

export function errorMessage(
  code: WsErrorCode,
  message: string,
  symbols?: readonly string[],
): WsServerMessage {
  return {
    v: WS_PROTOCOL_VERSION,
    type: 'error',
    code,
    message,
    ...(symbols && symbols.length > 0 ? { symbols: [...symbols] } : {}),
  };
}

export interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** 32 random bytes, base64. Encrypts Google tokens at rest. */
  TOKEN_ENC_KEY: string;
  /** "1" allows http://localhost and 127.0.0.1 origins. */
  DEV?: string;
}

/** What the API middleware puts in context.data. */
export interface RequestData {
  /** The request's Origin header if it is allowed, else null. */
  origin: string | null;
  [key: string]: unknown;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "error") {
    super(message);
  }
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

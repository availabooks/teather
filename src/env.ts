export interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** 32 random bytes, base64. Encrypts Google tokens at rest. */
  TOKEN_ENC_KEY: string;
  /** Private Ed25519 JWK (JSON text) that signs identity tokens for sites. */
  ID_SIGNING_KEY?: string;
  /** Key id published with it in /.well-known/jwks.json. */
  ID_SIGNING_KID?: string;
  /** Optional JSON array of retired public JWKs, still published while tokens they signed may be in use. */
  ID_SIGNING_OLD_PUBLIC?: string;
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

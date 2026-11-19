import { SignJWT, jwtVerify } from "jose";

const ISSUER = "store-builder-api";
const AUDIENCE = "store-builder";

export interface SessionClaims {
  userId: string;
  authVersion: number;
}

/** Session token: HS256 JWT carrying only the user id (`sub`) and the user's authVersion (`av`). */
export class TokenService {
  private readonly key: Uint8Array;
  constructor(secret: string, private readonly maxAgeSeconds: number) {
    this.key = new TextEncoder().encode(secret);
  }

  sign(claims: SessionClaims): Promise<string> {
    return new SignJWT({ av: claims.authVersion })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.maxAgeSeconds}s`)
      .sign(this.key);
  }

  /** Null for anything that is not a valid, unexpired token signed with our key (algorithm pinned to HS256). */
  async verify(token: string): Promise<SessionClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE });
      if (typeof payload.sub !== "string" || typeof payload.av !== "number" || !Number.isInteger(payload.av)) return null;
      return { userId: payload.sub, authVersion: payload.av };
    } catch {
      return null;
    }
  }
}

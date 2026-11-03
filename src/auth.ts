import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { jwtCallback } from "@/modules/auth/callbacks";
import { getClientIp } from "@/modules/auth/rate-limit";
import { authenticate } from "@/modules/auth/service";

export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export class RateLimitedError extends CredentialsSignin {
  code = "rate_limited";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials, request) {
        const result = await authenticate(credentials, { ip: getClientIp(request.headers) });
        if (!result.ok) {
          if (result.reason === "rate_limited") throw new RateLimitedError();
          return null; // generic CredentialsSignin
        }
        return { ...result.user, authVersion: result.authVersion };
      },
    }),
  ],
  callbacks: {
    jwt: jwtCallback,
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
  // Log only the error class, never stacks/payloads that could carry credentials.
  logger: {
    error(error) {
      console.error("[auth]", (error as { type?: string }).type ?? "UnknownError");
    },
    warn() {},
  },
});

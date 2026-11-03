import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    authVersion?: number;
  }
  interface Session {
    user: { id: string; name?: string | null; email?: string | null };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    authVersion?: number;
  }
}

import { redirect } from "next/navigation";
import { auth, type SessionUser } from "@/auth";

export type SafeUser = SessionUser;

/** Current user from the validated session (the API checked the token and authVersion), or null. */
export async function getCurrentUser(): Promise<SafeUser | null> {
  return (await auth())?.user ?? null;
}

/** Server-side guard for pages, layouts and server actions. */
export async function requireUser(): Promise<SafeUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

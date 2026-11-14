import type { MetadataRoute } from "next";

/**
 * robots.txt of the PLATFORM host (the root domain). Store subdomains are rewritten by the proxy to their own robots.txt route,
 * and every unknown host is a 404 before it gets here. The landing page stays indexable; the application never is.
 * /login and /register are deliberately NOT disallowed: crawlers must be able to fetch them to read their `noindex, nofollow`
 * directive (a disallowed URL can still be indexed from links). Authentication and authorization, not robots.txt, protect the app.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: ["/dashboard", "/preview", "/api/"] } };
}

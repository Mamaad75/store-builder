import type { StarterCopy } from "@/lib/business-categories";
import type { PageDefinition } from "@/templates/section-parse";

/**
 * Category-based starter text, applied ONLY while a store is being created. Structure and section ids come from the
 * theme's default pages; this only replaces the wording of sections that already exist (home hero, home image+text,
 * about page text). It never adds, removes or reorders sections, and it is never run again when the category changes.
 */
export function applyStarterCopy(pages: PageDefinition[], copy: StarterCopy): PageDefinition[] {
  return pages.map((page) => ({
    ...page,
    sections: page.sections.map((s) => {
      const props = s.props as Record<string, unknown>;
      if (page.type === "HOME" && s.type === "hero") {
        return { ...s, props: { ...props, title: copy.heroTitle, subtitle: copy.heroSubtitle, ...(props.buttonText ? { buttonText: copy.cta } : {}) } };
      }
      if (page.type === "HOME" && s.type === "imageText") return { ...s, props: { ...props, title: copy.aboutTitle, body: copy.aboutBody } };
      if (page.type === "ABOUT" && s.type === "richText") return { ...s, props: { ...props, title: copy.aboutTitle, body: copy.aboutBody } };
      return s;
    }),
  })) as PageDefinition[];
}

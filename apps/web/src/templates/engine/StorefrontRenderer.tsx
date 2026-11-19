import type { ReactElement } from "react";
import { isCoreSectionType } from "../section-registry";
import type { PageSection } from "../section-parse";
import type { RenderContext, SectionComponent, TemplateModule } from "../types";

function renderSection(template: TemplateModule, section: PageSection, ctx: RenderContext): ReactElement | null {
  if (isCoreSectionType(section.type)) {
    // The map is indexed by the section's own type, so props and component always agree.
    const Component = template.sections[section.type] as SectionComponent<typeof section.type> | undefined;
    return Component ? <Component key={section.id} section={section as never} ctx={ctx} /> : null;
  }
  // Theme-specific section: rendered only if THIS theme implements it; otherwise skipped (it is dormant data, never a crash).
  const Extra = template.extraSections[section.type];
  return Extra ? <Extra key={section.id} section={section as never} ctx={ctx} /> : null;
}

/** Generic renderer: chrome from the template's Layout, body from the page's sections. No business logic. */
export default function StorefrontRenderer({ template, ctx }: { template: TemplateModule; ctx: RenderContext }) {
  const { Layout } = template;
  return <Layout ctx={ctx}>{ctx.page.sections.map((s) => renderSection(template, s, ctx))}</Layout>;
}

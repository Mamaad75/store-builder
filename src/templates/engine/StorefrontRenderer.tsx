import type { ReactElement } from "react";
import type { Section } from "../sections";
import type { RenderContext, SectionComponent, TemplateModule } from "../types";

function renderSection(template: TemplateModule, section: Section, ctx: RenderContext): ReactElement | null {
  // The map is indexed by the section's own type, so props and component always agree.
  const Component = template.sections[section.type] as SectionComponent<typeof section.type> | undefined;
  if (!Component) return null; // a section type this template does not implement is skipped, never crashes the page
  return <Component key={section.id} section={section as never} ctx={ctx} />;
}

/** Generic renderer: chrome from the template's Layout, body from the page's sections. No business logic. */
export default function StorefrontRenderer({ template, ctx }: { template: TemplateModule; ctx: RenderContext }) {
  const { Layout } = template;
  return <Layout ctx={ctx}>{ctx.page.sections.map((s) => renderSection(template, s, ctx))}</Layout>;
}

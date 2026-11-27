import type { ReactElement } from "react";
import { isCoreSectionType } from "@store-builder/shared/templates/section-registry";
import type { PageSection } from "@store-builder/shared/templates/section-parse";
import type { RenderContext, SectionComponent, TemplateModule } from "../types";
import ProductReviews from "../common/ProductReviews";
import BlogView from "../common/BlogView";
import InfoView from "../common/InfoView";
import InfoLinks from "../common/InfoLinks";
import AnnouncementBar from "../common/AnnouncementBar";
import ListFilters from "../common/ListFilters";

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
  // Reviews are live data of a published store (its own host: no base path); previews and theme demos have none.
  const reviews = ctx.page.type === "PRODUCT_DETAIL" && ctx.product && ctx.basePath === "" ? <ProductReviews slug={ctx.product.slug} /> : null;
  // Around every page: the announcement above the theme's layout, and the links to the store's information pages at the end of its content.
  const body = ctx.blog ? <BlogView ctx={ctx} /> : ctx.info ? <InfoView ctx={ctx} /> : <><ListFilters ctx={ctx} />{ctx.page.sections.map((s) => renderSection(template, s, ctx))}{reviews}</>;
  return (
    <>
      <AnnouncementBar ctx={ctx} />
      <Layout ctx={ctx}>{body}<InfoLinks ctx={ctx} /></Layout>
    </>
  );
}

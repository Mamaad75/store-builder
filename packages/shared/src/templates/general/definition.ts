import type { ThemeDefinition } from "../theme.js";
import { generalEditor } from "./editor.js";

export const generalTheme: ThemeDefinition = {
  key: "general",
  version: 1,
  meta: { name: "ساده و همه‌منظوره", description: "چیدمان خنثی و روشن که برای هر نوع فروشگاهی مناسب است." },
  sectionDefinitions: [],
  editor: generalEditor,
  legacy: true,
};

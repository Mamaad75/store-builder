import type { ThemeDefinition } from "../theme";
import { generalEditor } from "./editor";

export const generalTheme: ThemeDefinition = {
  key: "general",
  version: 1,
  meta: { name: "ساده و همه‌منظوره", description: "چیدمان خنثی و روشن که برای هر نوع فروشگاهی مناسب است." },
  sectionDefinitions: [],
  editor: generalEditor,
};

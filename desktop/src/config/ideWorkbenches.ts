export const CODEX_WORKBENCH_PATH = "/app/codex";
export const LEGACY_AGENTS_PATH = "/app/agents";

export type IdeWorkbenchId = "codex";

export interface IdeWorkbenchNavEntry {
  id: IdeWorkbenchId;
  path: string;
  legacyPaths?: string[];
  labelKey: string;
  tooltipKey: string;
}

export const IDE_WORKBENCH_NAV: IdeWorkbenchNavEntry[] = [
  {
    id: "codex",
    path: CODEX_WORKBENCH_PATH,
    legacyPaths: [LEGACY_AGENTS_PATH],
    labelKey: "nav.codex",
    tooltipKey: "nav.tooltip_codex",
  },
];

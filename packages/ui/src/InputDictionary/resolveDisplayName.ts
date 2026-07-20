/**
 * resolveInputDisplayName — the ONE rule for naming a declared input
 * (presentation consistency).
 *
 * Two writers share `input_node` stages and disagree about where the
 * human name lives: the hand editor authors it into `config_json.name`
 * (the stage-level display_name freezes at creation — P-N3 / WA-2),
 * while the workbook builder writes the machine slug into
 * `config_json.name` and puts the spec's `label` on the stage's
 * `display_name`. Readers that trust either field alone render slugs
 * for the other writer's plans.
 *
 * The disambiguation is semantic, not historical: a "name" identical
 * to the field key carries zero display information, so it yields to
 * the stage-level name; a name that DIFFERS was authored by a person.
 * Every surface (Inputs tab, gate prose, API Lab, Run form, input
 * schema) resolves through this rule so one fact renders one way.
 */
export function resolveInputDisplayName(args: {
  /** The runtime field key (normalized `source_path` / slug). */
  readonly fieldKey: string;
  /** `config_json.name` — display name (editor) OR slug (builder). */
  readonly configName?: string | null | undefined;
  /** Stage-level `display_name` — the workbook label, when built. */
  readonly stageDisplayName?: string | null | undefined;
}): string {
  const cfg = args.configName?.trim();
  if (cfg && cfg !== args.fieldKey) return cfg;
  const stage = args.stageDisplayName?.trim();
  if (stage && stage !== args.fieldKey) return stage;
  return cfg || stage || args.fieldKey;
}

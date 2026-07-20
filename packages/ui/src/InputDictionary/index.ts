/**
 * InputDictionary — Brief 52 declared-input authoring surface.
 * Public surface for rate-lab to mount + wire to input_node stages.
 */

// Brief 61 D4 — the standard right-drawer editor (replaced the Brief 52
// inline-expand <InputDictionaryEditor>, now deleted).
export { InputEditorDrawer } from "./InputEditorDrawer";
export type { InputEditorDrawerProps } from "./InputEditorDrawer";
export {
  DATA_TYPE_GROUPS,
  DATA_TYPE_LABEL,
  SOURCE_OPTIONS,
  SOURCE_LABEL,
  fieldNameToStageId,
  humanizeFieldName,
  isDeclarableFieldName,
  isNumericType,
  validateDictionary,
} from "./types";
export type {
  InputDictEntry,
  InputSourceKindValue,
  DictIssue,
  DataTypeGroup,
  DataTypeOption,
  SourceOption,
} from "./types";
export { resolveInputDisplayName } from "./resolveDisplayName";
export { seedInputsFromCsv } from "./seedFromCsv";
export type { SeedFromCsvOptions } from "./seedFromCsv";
export { parseInputDictJson } from "./parseJson";
export type { ParseResult } from "./parseJson";
// Brief 58 Pillar C — durable bulk-add queue (survives navigation).
export {
  enqueuePendingDeclarations,
  peekPendingDeclarations,
  dequeuePendingDeclaration,
  clearPendingDeclarations,
  drainPendingDeclarations,
} from "./pendingQueue";
export type { DrainResult } from "./pendingQueue";

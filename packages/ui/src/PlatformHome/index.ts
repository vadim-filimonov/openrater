export { StateHero } from "./StateHero";
export type { StateHeroProps, HeroTone } from "./StateHero";
export { NavLabs } from "./NavLabs";
export type { NavLabsProps, NavLabItem } from "./NavLabs";
export {
  computePlatformAttention,
  summarizeAttention,
  isAlarm,
  isSetup,
} from "./computePlatformAttention";
export type {
  AttentionGroup,
  AttentionKind,
  AttentionSeverity,
  PlanFacts,
  ConnectorFacts,
} from "./computePlatformAttention";
export { AttentionList } from "./AttentionList";
export type { AttentionListProps } from "./AttentionList";
export {
  statusLineFor,
  attentionCopy,
  doorCopy,
  firstRunCopy,
  exhibitsCopy,
  planRowNextStep,
  referencePlanNote,
  REFERENCE_PLAN_NOTES,
} from "./platformCopy";
export type { StatusLine, AttentionSummary, PlanRowFacts } from "./platformCopy";

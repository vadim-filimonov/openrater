export { ChainFactorDrawer } from "./ChainFactorDrawer";
export type { ChainFactorDrawerProps } from "./ChainFactorDrawer";

// M4.3.8a — pure adapter that maps FactorDraft to the backend
// mutation the route should dispatch. See ADR-0016.
export { factorDraftToMutation } from "./factorDraftAdapter";
export type {
  FactorDraftAdapterContext,
  FactorDraftMutation,
} from "./factorDraftAdapter";

// M4.3.9 — reverse adapter, used by the route's edit-factor flow.
export { factorLookupToDraft } from "./factorLookupToDraft";

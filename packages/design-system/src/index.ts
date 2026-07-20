/**
 * @openrater/design-system — public API surface.
 *
 * Imports:
 *   - Tokens (CSS): `import "@openrater/design-system/tokens.css"` (once per app)
 *   - Primitives:   `import { Button, Chip, ... } from "@openrater/design-system"`
 *
 * Each primitive ships with its own colocated CSS, which Vite (or any
 * bundler resolving the package) inlines automatically on import.
 */

export { Button } from "./primitives/Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./primitives/Button";

export { IconButton } from "./primitives/IconButton";
export type { IconButtonProps } from "./primitives/IconButton";

export { Input } from "./primitives/Input";
export type { InputProps, InputSize } from "./primitives/Input";

export { Chip } from "./primitives/Chip";
export type { ChipProps, ChipTone, ChipVariant } from "./primitives/Chip";

export { Card } from "./primitives/Card";
export type { CardProps, CardVariant } from "./primitives/Card";

export { Kbd } from "./primitives/Kbd";
export type { KbdProps } from "./primitives/Kbd";

export { Divider } from "./primitives/Divider";
export type { DividerProps } from "./primitives/Divider";

export { Label } from "./primitives/Label";
export type { LabelProps } from "./primitives/Label";

export { Num } from "./primitives/Num";
export type { NumProps, NumFormat, NumDelta } from "./primitives/Num";

export { ToastProvider, useToast } from "./primitives/Toast";

// Global save-failure surface. The root host and
// the `apiErrorBus` channel the data layer (@openrater/hooks) pushes into.
// NOT for FYI messages (that's Toast); NOT for plan-content issues
// (that's PlanStatusBar). A failed save lands here.
export { GlobalErrorSurface, apiErrorBus, MAX_NOTICES } from "./primitives/GlobalErrorSurface";
export type { ApiErrorNotice, ApiErrorInput } from "./primitives/GlobalErrorSurface";

export { Drawer } from "./primitives/Drawer";
export type { DrawerProps } from "./primitives/Drawer";

// Canonical empty-state pattern: hero icon, title, lede, optional CTA,
// and optional cue.
export { EmptyState } from "./primitives/EmptyState";
export type { EmptyStateProps } from "./primitives/EmptyState";

export { Modal } from "./primitives/Modal";
export type { ModalProps, ModalSize } from "./primitives/Modal";

export { Tooltip } from "./primitives/Tooltip";
export type { TooltipProps, TooltipPlacement } from "./primitives/Tooltip";

export { Tabs } from "./primitives/Tabs";
export type {
  TabsProps,
  TabsListProps,
  TabsTriggerProps,
  TabsPanelProps,
} from "./primitives/Tabs";

export { Menu } from "./primitives/Menu";
export type {
  MenuProps,
  MenuTriggerProps,
  MenuItemsProps,
  MenuItemProps,
} from "./primitives/Menu";

export { Combobox } from "./primitives/Combobox";
export type {
  ComboboxProps,
  ComboboxOption,
  ComboboxRenderOptionState,
} from "./primitives/Combobox";

export { ProgressBar } from "./primitives/ProgressBar";
export type { ProgressBarProps, ProgressBarTone } from "./primitives/ProgressBar";

// Segmented control. Replaces the bespoke
// `.rater-pc-pill-group` (Parametrize Canvas/Saved) and
// `.rater-dsp-toggle` (Inputs CSV/Webhook) patterns.
export { InlineEdit } from "./primitives/InlineEdit";
export type { InlineEditProps, InlineEditVariant } from "./primitives/InlineEdit";

export { SearchField } from "./primitives/SearchField";
export type { SearchFieldProps, SearchFieldSize } from "./primitives/SearchField";

export { Switch } from "./primitives/Switch";
export type { SwitchProps, SwitchSize } from "./primitives/Switch";

export { Checkbox } from "./primitives/Checkbox";
export type { CheckboxProps } from "./primitives/Checkbox";

export { Segmented } from "./primitives/Segmented";
export type {
  SegmentedProps,
  SegmentedItem,
  SegmentedSize,
} from "./primitives/Segmented";

export const PACKAGE_NAME = "@openrater/design-system" as const;

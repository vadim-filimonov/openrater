/**
 * Icon name → lucide component resolver.
 *
 * The converter writes icon NAMES (strings) into TowerNode.icon and
 * InventoryItem.icon. This module maps the closed-vocabulary names
 * to lucide-react components for the UI primitives.
 *
 * Adding a new icon: pick the closest lucide name, add it here, use
 * the string from the converter. Unknown names fall back to a
 * neutral "Hash" glyph.
 */

import {
  Anchor,
  Boxes,
  Brain,
  Building,
  Calculator,
  Calendar,
  ChevronDown,
  Circle,
  CircleHelp,
  Cog,
  DollarSign,
  Droplets,
  FormInput,
  Gauge,
  Hash,
  LineChart,
  Link2,
  MapPin,
  Package,
  Play,
  Plus,
  Search,
  Shield,
  Sliders,
  Sparkles,
  Tag,
  Target,
  ToggleRight,
  TrendingUp,
  Variable,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";

const ICON_BY_NAME: Record<string, LucideIcon> = {
  // Inputs
  DollarSign,
  Package,
  Gauge,
  Calendar,
  ToggleRight,
  FormInput,
  Variable,
  // Transforms (dimension lookups)
  Tag,
  MapPin,
  Building,
  Shield,
  Droplets,
  // Lookups
  LineChart,
  Search,
  // Math
  Target,
  Calculator,
  Plus,
  // Loadings / gates
  Sliders,
  TrendingUp,
  Sparkles,
  Anchor,
  // Output
  Circle,
  Hash,
  // Models
  Brain,
  // UI affordances
  Cog,
  Link2,
  ChevronDown,
  X,
  Play,
  Workflow,
  Boxes,
};

/**
 * Resolve an icon name to a lucide component. Falls back to
 * `CircleHelp` for unknown names — a friendly visible hint that
 * the converter wrote a name we don't have.
 */
export function resolveIcon(name: string): LucideIcon {
  return ICON_BY_NAME[name] ?? CircleHelp;
}

export type { LucideIcon };

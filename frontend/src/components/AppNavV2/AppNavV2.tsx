/**
 * AppNavV2 — the top navigation (Interface Guide v2, Foundation F1;
 * grouped by Brief 88 P1).
 *
 * The bar is the org chart of the business, not the repo: the two CORES
 * (Rate Lab · Portfolio) read first and one step stronger, a hairline
 * divides them from the SUPPORTING room (Integrations), and the whole
 * set stays text-only per the constitution
 * (V2_INTERFACE_SPEC §2.1). Below 900px the supporting group folds into
 * a "More" menu — collapse is grouping, never icon substitution, so
 * full-text labels hold at every width (F10).
 *
 * Plus: brand mark → Home, the ⌘K affordance, and the theme toggle.
 * Token-only BEM.
 */

import { Link, useNavigate } from "react-router-dom";
import { Sun, Moon, Search, ChevronDown } from "lucide-react";
import { IconButton, Menu } from "@openrater/design-system";
import "./AppNavV2.css";

export interface NavItemV2 {
  label: string;
  to: string;
}

export interface AppNavV2Props {
  /** The two cores (Brief 88 P1) — strongest resting weight. */
  coreItems: readonly NavItemV2[];
  /** The supporting rooms — fold into "More" below 900px. */
  supportingItems: readonly NavItemV2[];
  /** Current location pathname, for the active state. */
  activePath: string;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  /** V2_INTERFACE_SPEC §2.4 — opens the command palette (⌘K). */
  onSearchClick?: () => void;
  /** Suffix appended to nav links so the v2 experience stays sticky. */
  linkSuffix?: string;
}

function isActivePath(activePath: string, to: string): boolean {
  return activePath === to || activePath.startsWith(`${to}/`);
}

function NavLinks({
  items,
  activePath,
  linkSuffix,
  core,
}: {
  items: readonly NavItemV2[];
  activePath: string;
  linkSuffix: string;
  core?: boolean;
}): JSX.Element {
  return (
    <>
      {items.map((item) => {
        const active = isActivePath(activePath, item.to);
        return (
          <Link
            key={item.to}
            to={`${item.to}${linkSuffix}`}
            className={`rater-nav2__item${core ? " rater-nav2__item--core" : ""}${
              active ? " rater-nav2__item--active" : ""
            }`}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

export function AppNavV2({
  coreItems,
  supportingItems,
  activePath,
  theme,
  onToggleTheme,
  onSearchClick,
  linkSuffix = "",
}: AppNavV2Props): JSX.Element {
  const navigate = useNavigate();
  const supportingActive = supportingItems.some((i) =>
    isActivePath(activePath, i.to),
  );
  return (
    <header className="rater-nav2">
      <Link
        to={`/${linkSuffix}`}
        className="rater-nav2__brand"
        aria-label="OpenRater home"
      >
        <span className="rater-nav2__mark" aria-hidden>
          <svg viewBox="0 0 24 24">
            <rect x="6" y="6.5" width="12" height="2.6" rx="1.3" />
            <rect x="7.6" y="10.7" width="8.8" height="2.6" rx="1.3" />
            <rect x="9.2" y="14.9" width="5.6" height="2.6" rx="1.3" />
          </svg>
        </span>
        <span className="rater-nav2__wordmark">OpenRater</span>
      </Link>

      <nav className="rater-nav2__items" aria-label="Core">
        <NavLinks
          items={coreItems}
          activePath={activePath}
          linkSuffix={linkSuffix}
          core
        />
      </nav>

      <span className="rater-nav2__divider" aria-hidden />

      <nav
        className="rater-nav2__items rater-nav2__items--supporting"
        aria-label="Supporting"
      >
        <NavLinks
          items={supportingItems}
          activePath={activePath}
          linkSuffix={linkSuffix}
        />
      </nav>

      {/* F10 — below 900px the supporting group lives here instead.
          A nav-item-styled trigger (not a standard button) + the
          design-system Menu. */}
      <span className="rater-nav2__more">
        <Menu>
          <Menu.Trigger>
            <button
              type="button"
              className={`rater-nav2__item rater-nav2__more-trigger${
                supportingActive ? " rater-nav2__item--active" : ""
              }`}
            >
              More
              <ChevronDown className="rater-nav2__more-chevron" aria-hidden />
            </button>
          </Menu.Trigger>
          <Menu.Items aria-label="Supporting rooms">
            {supportingItems.map((item) => (
              <Menu.Item
                key={item.to}
                onSelect={() => navigate(`${item.to}${linkSuffix}`)}
              >
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Items>
        </Menu>
      </span>

      <span className="rater-nav2__spacer" />

      <button
        type="button"
        className="rater-nav2__cmdk"
        aria-label="Search and commands"
        onClick={onSearchClick}
      >
        <Search className="rater-nav2__cmdk-ico" aria-hidden />
        <span className="rater-nav2__cmdk-label">Search</span>
        <kbd className="rater-nav2__kbd">⌘K</kbd>
      </button>

      <IconButton
        variant="ghost"
        size="md"
        onClick={onToggleTheme}
        aria-label="Toggle light/dark theme"
        aria-pressed={theme === "dark"}
        icon={theme === "dark" ? <Sun /> : <Moon />}
      />
    </header>
  );
}

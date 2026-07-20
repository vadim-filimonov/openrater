/**
 * <Menu> — dropdown menu anchored to a trigger.
 *
 * Composition pattern:
 *
 *   <Menu>
 *     <Menu.Trigger>
 *       <IconButton icon={<MoreHorizontal />} aria-label="More" />
 *     </Menu.Trigger>
 *     <Menu.Items aria-label="Plan actions">
 *       <Menu.Item onSelect={...}>Compare versions</Menu.Item>
 *       <Menu.Item onSelect={...}>Export</Menu.Item>
 *       <Menu.Separator />
 *       <Menu.Item onSelect={...} danger>Delete</Menu.Item>
 *     </Menu.Items>
 *   </Menu>
 *
 * Used in V1 by:
 *   - Brief 12's Plan Control Tower "Compare versions / Compare to
 *     filed / Export" menu
 *   - Per-row actions in lists (edit / duplicate / delete)
 *   - Brief 17's plan-line picker (when editing the LOB set)
 *
 * Behavior:
 *   - Click trigger to open; click trigger or outside to close
 *   - Escape closes; focus returns to trigger
 *   - ArrowDown / ArrowUp navigate items (skip separators + disabled)
 *   - Enter / Space activates the focused item
 *   - Home / End jump to first / last item
 *   - First item auto-focuses on open
 *   - Portal-rendered so overflow:hidden ancestors don't clip
 *
 * ARIA:
 *   - Trigger: aria-haspopup="menu", aria-expanded={open}
 *   - Menu: role="menu", aria-label (or aria-labelledby from trigger)
 *   - Items: role="menuitem"
 *   - Separator: role="separator"
 *
 * BEM class names:
 *   .rater-menu                              (the dropdown panel)
 *   .rater-menu__item                        (one item)
 *   .rater-menu__item--danger                (red text for destructive)
 *   .rater-menu__item--disabled
 *   .rater-menu__separator                   (visual divider line)
 *   .rater-menu-anchor                       (wrapper around trigger)
 *
 * Tokens consumed:
 *   - --rater-surface-1, --rater-surface-2 (panel + hover)
 *   - --rater-text-default, --rater-text-strong, --rater-text-muted
 *   - --rater-border-default
 *   - --rater-r-6, --rater-r-4
 *   - --rater-shadow-floating, --rater-z-popover
 *   - --rater-d-140, --rater-ease-soft
 *   - --rater-focus-ring
 *   - --rater-feedback-error (for danger items)
 */

import {
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import "./Menu.css";

interface MenuContextValue {
  readonly open: boolean;
  readonly setOpen: (next: boolean) => void;
  readonly anchorRef: React.RefObject<HTMLSpanElement>;
  readonly menuId: string;
}

const MenuContext = createContext<MenuContextValue | null>(null);

function useMenuContext(component: string): MenuContextValue {
  const ctx = useContext(MenuContext);
  if (ctx === null) {
    throw new Error(
      `<${component}> must be used inside <Menu>. Did you forget to wrap it?`,
    );
  }
  return ctx;
}

export interface MenuProps {
  readonly children: ReactNode;
  /** When supplied, the menu becomes controlled. */
  readonly open?: boolean;
  /** Required if `open` is supplied. Receives the next open state. */
  readonly onOpenChange?: (next: boolean) => void;
}

export function Menu({ children, open: controlledOpen, onOpenChange }: MenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (onOpenChange) onOpenChange(next);
      if (controlledOpen === undefined) setUncontrolledOpen(next);
    },
    [controlledOpen, onOpenChange],
  );
  const anchorRef = useRef<HTMLSpanElement>(null);
  const menuId = useId();

  return (
    <MenuContext.Provider value={{ open, setOpen, anchorRef, menuId }}>
      {children}
    </MenuContext.Provider>
  );
}

export interface MenuTriggerProps {
  /** The element that opens the menu. Must be a single ReactElement
   *  (typically Button or IconButton). The wrapper attaches click +
   *  ARIA attributes; the child's existing props are preserved. */
  readonly children: ReactElement;
}

function MenuTrigger({ children }: MenuTriggerProps) {
  const ctx = useMenuContext("Menu.Trigger");
  if (!isValidElement(children)) return children;
  return (
    <span ref={ctx.anchorRef} className="rater-menu-anchor">
      {cloneElement(children, {
        "aria-haspopup": "menu",
        "aria-expanded": ctx.open,
        "aria-controls": ctx.menuId,
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          ctx.setOpen(!ctx.open);
          // Preserve any onClick on the child
          const childOnClick = (
            children.props as { onClick?: (e: React.MouseEvent) => void }
          ).onClick;
          if (childOnClick) childOnClick(e);
        },
      } as Partial<unknown>)}
    </span>
  );
}

interface MenuPosition {
  readonly top: number;
  readonly left: number;
  /** True when the panel flipped ABOVE the trigger (viewport-bottom
   *  collision) — drives transform-origin so the entrance grows from
   *  the anchored edge instead of animating away from it. */
  readonly flipped: boolean;
  /** True when the panel right-aligned to the trigger (viewport-right
   *  collision) — same purpose, horizontal. */
  readonly alignedRight: boolean;
}

export interface MenuItemsProps extends HTMLAttributes<HTMLDivElement> {
  /** A11y label for the menu. */
  readonly "aria-label": string;
  readonly children: ReactNode;
}

function MenuItems({
  children,
  "aria-label": ariaLabel,
  className,
  ...rest
}: MenuItemsProps) {
  const ctx = useMenuContext("Menu.Items");
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  // Position synchronously after layout — drop down from the trigger, and
  // keep the menu on-screen. The menu first renders off-screen (position
  // null → top/left: -9999px), so by the time this layout effect runs its
  // width is measurable: if a left-aligned menu would spill past the right
  // edge (a trigger near the right of the screen — e.g. a "⋯" overflow), we
  // right-align it to the trigger so it opens leftward, clamped to the
  // viewport. Vertical likewise flips above the trigger when it'd overflow
  // the bottom. Computed in viewport coords, then offset to document coords
  // for the absolutely-positioned portal.
  useLayoutEffect(() => {
    // While closing (open=false but the exit animation is playing) we keep
    // the LAST computed position — nulling it would teleport the closing
    // panel to -9999px mid-fade.
    if (!ctx.open) return;
    const anchor = ctx.anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const GAP = 4;
    const MARGIN = 8;
    const menu = menuRef.current;
    const menuWidth = menu?.offsetWidth ?? 0;
    const menuHeight = menu?.offsetHeight ?? 0;

    // Horizontal: prefer left-aligned; right-align (open leftward) on overflow.
    let left = rect.left;
    let alignedRight = false;
    if (menuWidth > 0 && left + menuWidth > window.innerWidth - MARGIN) {
      left = Math.max(MARGIN, rect.right - menuWidth);
      alignedRight = true;
    }

    // Vertical: prefer below; flip above if it'd overflow the bottom.
    let top = rect.bottom + GAP;
    let flipped = false;
    if (
      menuHeight > 0 &&
      top + menuHeight > window.innerHeight - MARGIN &&
      rect.top - GAP - menuHeight >= MARGIN
    ) {
      top = rect.top - GAP - menuHeight;
      flipped = true;
    }

    setPosition({
      top: top + window.scrollY,
      left: left + window.scrollX,
      flipped,
      alignedRight,
    });
  }, [ctx.open, ctx.anchorRef]);

  // ── Exit phase (Shell v3 polish) ─────────────────────────────────
  // The entrance animates, so a synchronous unmount on close reads as
  // cheap. When open flips false we hold the panel one more beat with
  // the --closing modifier (plays rater-menu-out, faster than the
  // entrance per the standard exit ratio) and unmount on animationend,
  // with a timeout fallback for environments where CSS animations
  // never fire (jsdom; display:none ancestors).
  const [closing, setClosing] = useState(false);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (ctx.open) {
      wasOpen.current = true;
      setClosing(false);
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    setClosing(true);
    const fallback = setTimeout(() => setClosing(false), 150);
    return () => clearTimeout(fallback);
  }, [ctx.open]);

  // Auto-focus the first menuitem on open.
  useEffect(() => {
    if (!ctx.open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const first = menu.querySelector<HTMLElement>(
      '[role="menuitem"]:not([aria-disabled="true"])',
    );
    first?.focus();
  }, [ctx.open]);

  // Close on outside click.
  useEffect(() => {
    if (!ctx.open) return;
    const handler = (e: globalThis.MouseEvent) => {
      const menu = menuRef.current;
      const anchor = ctx.anchorRef.current;
      const target = e.target as Node | null;
      if (!target) return;
      if (menu?.contains(target)) return;
      if (anchor?.contains(target)) return;
      ctx.setOpen(false);
    };
    // mousedown fires before click, so we beat the click handler that
    // would otherwise re-toggle via the trigger.
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ctx.open, ctx.setOpen, ctx.anchorRef]);

  // Escape closes + returns focus to trigger.
  useEffect(() => {
    if (!ctx.open) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        ctx.setOpen(false);
        const anchor = ctx.anchorRef.current;
        const button = anchor?.querySelector<HTMLButtonElement>("button");
        button?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [ctx.open, ctx.setOpen, ctx.anchorRef]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const menu = menuRef.current;
      if (!menu) return;
      const items = Array.from(
        menu.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([aria-disabled="true"])',
        ),
      );
      if (items.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const i = active ? items.indexOf(active) : -1;
      let nextIndex = -1;
      switch (e.key) {
        case "ArrowDown":
          nextIndex = i === -1 || i === items.length - 1 ? 0 : i + 1;
          break;
        case "ArrowUp":
          nextIndex = i <= 0 ? items.length - 1 : i - 1;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = items.length - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      items[nextIndex]?.focus();
    },
    [],
  );

  if (!ctx.open && !closing) return null;

  return createPortal(
    <div
      ref={menuRef}
      id={ctx.menuId}
      role="menu"
      aria-label={ariaLabel}
      className={[
        "rater-menu",
        closing ? "rater-menu--closing" : null,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-flipped={position?.flipped ? "" : undefined}
      data-aligned={position?.alignedRight ? "right" : undefined}
      style={
        position
          ? { top: `${position.top}px`, left: `${position.left}px` }
          : { top: "-9999px", left: "-9999px" }
      }
      onKeyDown={onKeyDown}
      onAnimationEnd={(e) => {
        if (e.animationName === "rater-menu-out") setClosing(false);
      }}
      {...rest}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface MenuItemProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onSelect"> {
  /** Called when the item is activated (click, Enter, Space). The
   *  menu closes automatically after onSelect returns. */
  readonly onSelect: () => void;
  /** Red text for destructive actions. */
  readonly danger?: boolean;
  readonly children: ReactNode;
}

function MenuItem({
  onSelect,
  danger = false,
  disabled = false,
  children,
  className,
  ...rest
}: MenuItemProps) {
  const ctx = useMenuContext("Menu.Item");
  const onClick = useCallback(() => {
    if (disabled) return;
    onSelect();
    ctx.setOpen(false);
    // Return focus to trigger after activation.
    const button = ctx.anchorRef.current?.querySelector<HTMLButtonElement>("button");
    button?.focus();
  }, [disabled, onSelect, ctx]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick();
      }
    },
    [onClick],
  );

  const classes = [
    "rater-menu__item",
    danger ? "rater-menu__item--danger" : null,
    disabled ? "rater-menu__item--disabled" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      role="menuitem"
      aria-disabled={disabled || undefined}
      className={classes}
      onClick={onClick}
      onKeyDown={onKeyDown}
      tabIndex={-1}
      {...rest}
    >
      {children}
    </button>
  );
}

function MenuSeparator() {
  return <div role="separator" className="rater-menu__separator" />;
}

Menu.Trigger = MenuTrigger;
Menu.Items = MenuItems;
Menu.Item = MenuItem;
Menu.Separator = MenuSeparator;

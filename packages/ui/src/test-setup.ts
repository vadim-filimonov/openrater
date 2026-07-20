/**
 * Shared Vitest setup for @openrater/ui.
 *
 * - Wires @testing-library/jest-dom matchers into expect()
 * - Polyfills browser APIs missing from jsdom that @xyflow/react
 *   needs at mount time (ResizeObserver, DOMMatrixReadOnly).
 *   The polyfills are no-ops — they keep the library from throwing
 *   at construction; tests don't observe geometry under jsdom.
 * - cleanup() after each test
 */

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// ── jsdom polyfills for @xyflow/react ─────────────────────────
//
// @xyflow/react relies on ResizeObserver to track viewport size and
// DOMMatrixReadOnly to decode transform strings. Both are unavailable
// in jsdom; the library throws at mount otherwise.
//
// Stubs only — we don't assert on viewport / pan-zoom behavior in
// jsdom. See packages/ui/src/Canvas/Canvas.test.tsx for the
// rationale.

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

if (typeof globalThis.DOMMatrixReadOnly === "undefined") {
  class DOMMatrixReadOnlyStub {
    m22 = 1;
    constructor(_transform?: string) {
      // no-op; identity matrix is fine for jsdom
    }
  }
  globalThis.DOMMatrixReadOnly =
    DOMMatrixReadOnlyStub as unknown as typeof DOMMatrixReadOnly;
}

// @xyflow/react reads element.offsetHeight / offsetWidth to detect
// whether the viewport has rendered. jsdom returns 0; we make it
// non-zero so the library proceeds past its size-zero guard.
if (
  typeof HTMLElement !== "undefined" &&
  typeof Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")
    ?.get !== "function"
) {
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: {
      get(this: HTMLElement) {
        return parseFloat(this.style.height) || 1;
      },
    },
    offsetWidth: {
      get(this: HTMLElement) {
        return parseFloat(this.style.width) || 1;
      },
    },
  });
}

afterEach(() => {
  cleanup();
});

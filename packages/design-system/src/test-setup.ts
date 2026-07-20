/**
 * Shared Vitest setup for @openrater/design-system.
 *
 * - Wires @testing-library/jest-dom matchers into expect()
 * - cleanup() after each test (auto in @testing-library/react 16+,
 *   but explicit reset here for safety)
 */

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

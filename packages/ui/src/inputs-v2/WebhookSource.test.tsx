/**
 * <WebhookSource> (P2.1) — the v2 webhook data-source config.
 *
 * Covers the progressive shape: the common-case URL + Fetch sample line,
 * the inferred-field → onChange write, the "Use a CSV instead" mode switch,
 * and the Advanced reveal (method / auth env-fields + the no-secret note /
 * headers). Auth is env-var-NAME based — these tests assert no secret value
 * is ever asked for inline.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { WebhookSource, type WebhookInferResult } from "./WebhookSource";
import { emptyWebhookConfig } from "../InputsWorkspace";
import type { WebhookConfig } from "../InputsWorkspace";

function cfg(over: Partial<WebhookConfig> = {}): WebhookConfig {
  return { ...emptyWebhookConfig(), ...over };
}

describe("<WebhookSource>", () => {
  it("disables Fetch sample until the URL is a valid http(s) URL", () => {
    const onInfer = vi.fn<(config: WebhookConfig) => Promise<WebhookInferResult>>();
    render(
      <WebhookSource
        value={cfg({ url: "not-a-url" })}
        onChange={() => {}}
        onInfer={onInfer}
        editable
      />,
    );
    expect(screen.getByRole("button", { name: "Fetch sample" })).toBeDisabled();
  });

  it("fetches a sample, writes the inferred fields, and reports the count", async () => {
    const onChange = vi.fn();
    const onInfer = vi
      .fn<(config: WebhookConfig) => Promise<WebhookInferResult>>()
      .mockResolvedValue({
        ok: true,
        fields: [
          { name: "tiv", dtype: "number" },
          { name: "state", dtype: "string" },
        ],
      });

    render(
      <WebhookSource
        value={cfg({ url: "https://api.example.com/book" })}
        onChange={onChange}
        onInfer={onInfer}
        editable
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Fetch sample" }));

    await waitFor(() =>
      expect(screen.getByText(/2 fields detected/)).toBeInTheDocument(),
    );
    expect(onInfer).toHaveBeenCalledOnce();
    // The fields are written back onto payload_schema.fields.
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        payload_schema: expect.objectContaining({
          fields: [
            { name: "tiv", dtype: "number" },
            { name: "state", dtype: "string" },
          ],
        }),
      }),
    );
  });

  it("surfaces the error when inference fails", async () => {
    const onInfer = vi
      .fn<(config: WebhookConfig) => Promise<WebhookInferResult>>()
      .mockResolvedValue({ ok: false, error: "HTTP 404" });

    render(
      <WebhookSource
        value={cfg({ url: "https://api.example.com/missing" })}
        onChange={() => {}}
        onInfer={onInfer}
        editable
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fetch sample" }));
    await waitFor(() =>
      expect(screen.getByText("HTTP 404")).toBeInTheDocument(),
    );
  });

  it("switches back to a CSV via the inline link", () => {
    const onUseCsv = vi.fn();
    render(
      <WebhookSource
        value={cfg()}
        onChange={() => {}}
        editable
        onUseCsv={onUseCsv}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use a CSV instead" }));
    expect(onUseCsv).toHaveBeenCalledOnce();
  });

  it("hides method / auth / headers behind Advanced", () => {
    render(<WebhookSource value={cfg()} onChange={() => {}} editable />);
    // Collapsed by default — no auth control on screen.
    expect(screen.queryByLabelText("Method")).not.toBeInTheDocument();
    expect(screen.queryByText(/Auth/)).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /Advanced — method, auth, headers/ }),
    );
    expect(screen.getByText("Method")).toBeInTheDocument();
    expect(screen.getByText("Auth")).toBeInTheDocument();
    expect(screen.getByText("Headers")).toBeInTheDocument();
  });

  it("asks for an env-var NAME (not a secret) and shows the no-secret note", () => {
    const onChange = vi.fn();
    render(
      <WebhookSource
        value={cfg({ auth: { kind: "bearer", token_env: "" } })}
        onChange={onChange}
        editable
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Advanced — method, auth, headers/ }),
    );
    // The bearer mode exposes a token ENV-VAR field + the security note.
    expect(screen.getByText("Token env var")).toBeInTheDocument();
    expect(
      screen.getByText(/no\s+secret is ever stored in the plan/i),
    ).toBeInTheDocument();
  });

  it("is read-only when not editable (no Fetch, no inline controls)", () => {
    render(
      <WebhookSource
        value={cfg({ url: "https://api.example.com/book" })}
        onChange={() => {}}
        editable={false}
        onUseCsv={() => {}}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Fetch sample" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Use a CSV instead" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Advanced/ }),
    ).not.toBeInTheDocument();
  });
});

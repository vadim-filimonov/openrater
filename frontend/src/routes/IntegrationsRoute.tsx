// Copyright 2026 Vadim Filimonov and the OpenRater contributors
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
/**
 * /integrations — the Hub's home (Brief 77 §2, L4).
 *
 * One card per paired platform: peer name, status chip, plans live,
 * paired-at. The empty state teaches the concept in two sentences +
 * one CTA (the house empty-state form). Creating an integration lands
 * you in its Hub at step 1 (Pair) — the journey starts immediately.
 */

import { useCallback, useEffect, useState, type JSX } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@openrater/design-system";
import { SurfaceHeader, isoDate } from "@openrater/ui";
import {
  createIntegration,
  listIntegrations,
  type IntegrationSummary,
} from "../api/integrations";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import "./IntegrationsRoute.css";

//  — absolute dates are ISO everywhere.
const day = (iso: string | null): string => (iso ? isoDate(iso) : "—");

export function IntegrationsRoute(): JSX.Element {
  useDocumentTitle("Integrations");
  const navigate = useNavigate();
  const [rows, setRows] = useState<IntegrationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    listIntegrations()
      .then((data) => {
        setRows(data);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const created = await createIntegration(name.trim());
      navigate(`/integrations/${created.integration_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed.");
      setCreating(false);
    }
  };

  return (
    <div className="ints">
      {/* Brief 88 §3.3 (88.3) — the standardized greeting; the create
          affordance rides the actions slot, the sub sits below the row. */}
      <SurfaceHeader
        title="Integrations"
        actions={
          rows !== null && rows.length > 0 && !showForm ? (
            <Button variant="primary" onClick={() => setShowForm(true)}>
              New integration
            </Button>
          ) : undefined
        }
      />
      <p className="ints__sub">
        Paired platforms that quote your published plans and report what the
        market did.
      </p>

      {error && <div className="ints__error">{error}</div>}

      {(showForm || (rows !== null && rows.length === 0)) && (
        <section
          className={rows?.length === 0 ? "ints__empty" : "ints__create"}
          aria-label="New integration"
        >
          {rows?.length === 0 && (
            <>
              <h2 className="ints__empty-title">Connect a platform</h2>
              {/*  — the empty state names the user's world (a
                  product they have) and promises no ledger before one
                  renders. */}
              <p className="ints__empty-copy">
                Pair your distribution platform and its agents get an
                indicative premium per carrier, computed on your published
                plans. What the market did — quotes, binds — flows back
                here as events.
              </p>
            </>
          )}
          <div className="ints__form">
            <input
              className="ints__input"
              type="text"
              placeholder="Integration name — e.g. Agent portal — production"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
              aria-label="Integration name"
            />
            <Button
              variant="primary"
              onClick={() => void create()}
              disabled={creating || !name.trim()}
            >
              {creating ? "Creating…" : "Create"}
            </Button>
          </div>
        </section>
      )}

      {rows === null && !error && <div className="ints__loading">Loading…</div>}

      {rows !== null && rows.length > 0 && (
        <ul className="ints__list">
          {rows.map((row) => (
            <li key={row.integration_id}>
              <button
                type="button"
                className="ints__card"
                onClick={() => navigate(`/integrations/${row.integration_id}`)}
              >
                <span className="ints__card-id">
                  <span className="ints__card-name">{row.name}</span>
                  <span className="ints__card-sub">
                    {row.paired
                      ? `paired ${day(row.paired_at)}${row.peer_name ? ` · ${row.peer_name}` : ""}${
                          row.catalog_field_count > 0
                            ? ` · ${row.catalog_field_count} fields`
                            : ""
                        }`
                      : `created ${day(row.created_at)} · awaiting pairing`}
                  </span>
                </span>
                <span className="ints__card-cells">
                  {row.events_error > 0 && (
                    <span
                      className="ints__cell ints__cell--alert"
                      title={`${row.events_error} event${row.events_error === 1 ? "" : "s"} from the peer failed to apply — open Live for the detail.`}
                    >
                      <i />
                      feed errors
                    </span>
                  )}
                  <span className="ints__cell">
                    {row.plans_live}/{row.plans_exposed} plans live
                  </span>
                  <span
                    className={`ints__chip ${row.paired ? "ints__chip--live" : "ints__chip--pending"}`}
                  >
                    <i />
                    {row.plans_live > 0
                      ? "Live"
                      : row.paired
                        ? "Paired"
                        : "Awaiting pairing"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

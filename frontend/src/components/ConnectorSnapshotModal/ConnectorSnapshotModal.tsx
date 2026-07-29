/**
 * <ConnectorSnapshotModal> — the frozen replay record behind a
 * connector-sourced IRPM step (Brief 62.6 §4, "replay-snapshot-as-filing-
 * record").
 *
 * When a connector resolves a policy's IRPM, the engine reads the LIVE API
 * once and freezes the request + response into an append-only snapshot. The
 * filed premium then replays from THAT snapshot — never the live API — so a
 * re-score months later reproduces the exact number that was filed. This
 * modal is the "show me the receipt" affordance: the build-up's `snapshot`
 * button opens it.
 *
 * App-local (not a `@openrater/ui` primitive) because it FETCHES — labs-ui
 * stays HTTP-free. Reuses the design-system <Modal>; secrets are never in a
 * snapshot (the backend excludes them at capture), so the raw request is safe
 * to show.
 */

import { useQuery } from "@tanstack/react-query";
import { Modal } from "@openrater/design-system";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import {
  getConnectorSnapshot,
  ApiLabError,
  type ConnectorSnapshot,
} from "../../api/connectors";
import "./ConnectorSnapshotModal.css";

export interface ConnectorSnapshotModalProps {
  /** The snapshot to show, or `null` to keep the modal closed. */
  readonly snapshotId: string | null;
  readonly onClose: () => void;
}

/** A labelled monospace JSON block (the frozen request/response bodies). */
function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="conn-snapshot__block">
      <span className="conn-snapshot__block-label">{label}</span>
      <pre className="conn-snapshot__json">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

function SnapshotBody({ snapshot }: { snapshot: ConnectorSnapshot }) {
  return (
    <div className="conn-snapshot">
      <p className="conn-snapshot__provenance">
        <ShieldCheck size={14} aria-hidden="true" />
        <span>
          This is the <strong>frozen filing record</strong>. Re-scores replay
          this snapshot — they never re-call the live connector.
        </span>
      </p>

      <dl className="conn-snapshot__meta">
        <div className="conn-snapshot__meta-row">
          <dt>Captured</dt>
          <dd>{snapshot.fetched_at}</dd>
        </div>
        <div className="conn-snapshot__meta-row">
          <dt>Status</dt>
          <dd>HTTP {snapshot.status_code}</dd>
        </div>
        <div className="conn-snapshot__meta-row">
          <dt>Cost</dt>
          <dd>${snapshot.cost_usd.toFixed(4)}</dd>
        </div>
        {snapshot.vendor_request_id ? (
          <div className="conn-snapshot__meta-row">
            <dt>Vendor request</dt>
            <dd className="conn-snapshot__mono">{snapshot.vendor_request_id}</dd>
          </div>
        ) : null}
        <div className="conn-snapshot__meta-row">
          <dt>Content hash</dt>
          <dd className="conn-snapshot__mono">{snapshot.content_hash}</dd>
        </div>
      </dl>

      <JsonBlock
        label={`Request · ${snapshot.request.method} ${snapshot.request.url}`}
        value={
          snapshot.request.json_body ?? snapshot.request.params ?? {}
        }
      />
      <JsonBlock label="Response" value={snapshot.response.json_body} />
    </div>
  );
}

export function ConnectorSnapshotModal({
  snapshotId,
  onClose,
}: ConnectorSnapshotModalProps) {
  const query = useQuery({
    queryKey: ["connector-snapshot", snapshotId],
    queryFn: () => getConnectorSnapshot(snapshotId as string),
    enabled: snapshotId !== null,
  });

  if (snapshotId === null) return null;

  const subtitle = query.data
    ? `${query.data.connector_id} · ${query.data.connector_version}`
    : snapshotId;

  return (
    <Modal open onClose={onClose} title="Frozen response" subtitle={subtitle} size="md">
      <Modal.Body>
        {query.isPending ? (
          <p className="conn-snapshot__status">Loading the frozen record…</p>
        ) : query.isError ? (
          <p className="conn-snapshot__status conn-snapshot__status--error" role="alert">
            <AlertTriangle size={14} aria-hidden="true" />{" "}
            {query.error instanceof ApiLabError
              ? query.error.message
              : "Could not load this snapshot."}
          </p>
        ) : query.data ? (
          <SnapshotBody snapshot={query.data} />
        ) : null}
      </Modal.Body>
    </Modal>
  );
}

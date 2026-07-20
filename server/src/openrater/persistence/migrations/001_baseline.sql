-- 001_baseline.sql — the OpenRater schema baseline.
--
-- This is a consolidated baseline containing the schema OpenRater needs.
-- It intentionally excludes tables for retired product surfaces:
--   · models, model_eval_snapshots (021 — Model Lab registry)
--   · model_audit_log              (022)
--   · data_lab_sources / _files / _file_rows (043 — Data Lab)
-- Everything else — plans + stages + dimensions + factor tables,
-- snapshots/publish, connectors + integrations,
-- plan runs + build reports, API keys,
-- quote ledger, and audit tables — is represented in this baseline.
--
-- Migration history starts here. Future migrations append as
-- 002_*.sql and are exercised against POPULATED data by
-- server/tests/test_migrations_populated.py (anchor = this baseline).

CREATE TABLE _migration_placeholder (
  id INTEGER PRIMARY KEY
);

CREATE TABLE rating_plan_stage_inputs (
    rating_plan_id    TEXT NOT NULL,
    stage_id          TEXT NOT NULL,
    input_name        TEXT NOT NULL,
    input_source      TEXT NOT NULL,
    input_path        TEXT NOT NULL,
    data_type         TEXT NOT NULL,
    required          INTEGER NOT NULL DEFAULT 1,
    default_value     TEXT,
    PRIMARY KEY (rating_plan_id, stage_id, input_name),
    CHECK (input_source IN ('context', 'stage_output', 'form_input', 'literal')),
    CHECK (required IN (0, 1)),
    CHECK (data_type IN ('number', 'string', 'bool', 'enum', 'array', 'object')),
    FOREIGN KEY (rating_plan_id, stage_id)
        REFERENCES rating_plan_stages(rating_plan_id, stage_id)
        ON DELETE CASCADE
);

CREATE INDEX idx_plan_stage_inputs_path
    ON rating_plan_stage_inputs(input_source, input_path);

CREATE TABLE rating_plan_stage_outputs (
    rating_plan_id    TEXT NOT NULL,
    stage_id          TEXT NOT NULL,
    output_name       TEXT NOT NULL,
    data_type         TEXT NOT NULL,
    description       TEXT,
    PRIMARY KEY (rating_plan_id, stage_id, output_name),
    CHECK (data_type IN ('number', 'string', 'bool', 'enum', 'array', 'object')),
    FOREIGN KEY (rating_plan_id, stage_id)
        REFERENCES rating_plan_stages(rating_plan_id, stage_id)
        ON DELETE CASCADE
);

CREATE INDEX idx_plan_stage_outputs_name
    ON rating_plan_stage_outputs(output_name);

CREATE TABLE draft_sessions (
    draft_session_id  TEXT PRIMARY KEY,
    entity_kind       TEXT NOT NULL,
    entity_id         TEXT NOT NULL,
    operator_id       TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'draft',
    created_at        TEXT NOT NULL,
    promoted_at       TEXT,
    note              TEXT,
    CHECK (entity_kind IN ('plan', 'factor_table', 'dimension', 'input_mapping')),
    CHECK (status IN ('draft', 'promoting', 'promoted', 'discarded'))
);

CREATE INDEX idx_draft_sessions_entity
    ON draft_sessions(entity_kind, entity_id, status);

CREATE INDEX idx_draft_sessions_operator
    ON draft_sessions(operator_id, status, created_at DESC);

CREATE TABLE rating_plan_signoffs (
    signoff_id        TEXT PRIMARY KEY,
    rating_plan_id    TEXT NOT NULL,
    signed_off_by     TEXT NOT NULL,
    signed_off_at     TEXT NOT NULL,
    note              TEXT NOT NULL DEFAULT '',
    revoked_at        TEXT,
    revoked_by        TEXT,
    revoke_reason     TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX idx_rating_plan_signoffs_active
    ON rating_plan_signoffs (rating_plan_id)
    WHERE revoked_at IS NULL;

CREATE INDEX idx_rating_plan_signoffs_plan
    ON rating_plan_signoffs (rating_plan_id, signed_off_at);

CREATE TABLE idempotency_keys (
    
    
    idempotency_key TEXT NOT NULL,

    
    request_method TEXT NOT NULL,

    
    request_path TEXT NOT NULL,

    
    
    request_hash TEXT NOT NULL,

    
    
    
    response_status INTEGER NOT NULL,

    
    
    
    
    
    response_body TEXT NOT NULL,

    
    
    
    response_headers TEXT NOT NULL,

    
    response_media_type TEXT,

    
    created_at TEXT NOT NULL,

    
    
    expires_at TEXT NOT NULL,

    PRIMARY KEY (idempotency_key, request_method, request_path)
);

CREATE INDEX idx_idempotency_keys_expires_at
    ON idempotency_keys (expires_at);

CREATE TABLE plan_factor_tables (
    rating_plan_id     TEXT NOT NULL,
    
    table_id           TEXT NOT NULL,
    display_name       TEXT NOT NULL,
    slug               TEXT NOT NULL,
    description        TEXT,
    
    
    
    key_dimensions_json TEXT NOT NULL DEFAULT '[]',
    
    draft_status       TEXT,
    source_pdf_url     TEXT,
    source_page        INTEGER,
    
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    content_hash       TEXT, interpolation_json TEXT,
    PRIMARY KEY (rating_plan_id, table_id),
    FOREIGN KEY (rating_plan_id) REFERENCES rating_plans(rating_plan_id) ON DELETE CASCADE,
    CHECK (
        draft_status IS NULL
        OR draft_status IN ('extracted', 'reviewed', 'committed')
    )
);

CREATE INDEX idx_plan_factor_tables_by_plan
    ON plan_factor_tables(rating_plan_id);

CREATE INDEX idx_plan_factor_tables_slug
    ON plan_factor_tables(rating_plan_id, slug);

CREATE TABLE plan_factor_table_cells (
    rating_plan_id     TEXT NOT NULL,
    table_id           TEXT NOT NULL,
    
    
    
    
    cell_key           TEXT NOT NULL,
    value              REAL NOT NULL,
    updated_at         TEXT NOT NULL,
    PRIMARY KEY (rating_plan_id, table_id, cell_key),
    FOREIGN KEY (rating_plan_id, table_id)
        REFERENCES plan_factor_tables(rating_plan_id, table_id)
        ON DELETE CASCADE
);

CREATE INDEX idx_plan_factor_table_cells_by_table
    ON plan_factor_table_cells(rating_plan_id, table_id);

CREATE TABLE plan_input_mappings (
    rating_plan_id     TEXT NOT NULL PRIMARY KEY,
    
    
    
    mapping_json       TEXT NOT NULL,
    
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    
    content_hash       TEXT,
    FOREIGN KEY (rating_plan_id) REFERENCES rating_plans(rating_plan_id) ON DELETE CASCADE
);

CREATE TABLE plan_templates (
    template_id        TEXT NOT NULL PRIMARY KEY,
    display_name       TEXT NOT NULL,
    description        TEXT,
    
    
    
    line_of_business   TEXT NOT NULL,
    coverages_json     TEXT,
    
    
    recipe_json        TEXT NOT NULL,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);

CREATE TABLE "rating_plan_stages" (
    rating_plan_id    TEXT NOT NULL,
    stage_id          TEXT NOT NULL,
    sequence          INTEGER NOT NULL,
    stage_kind        TEXT NOT NULL,
    display_name      TEXT NOT NULL,
    config_json       TEXT NOT NULL DEFAULT '{}',
    citation_rule     TEXT,
    citation_page     TEXT,
    source_filing_id  TEXT,
    x_position        REAL,
    y_position        REAL,
    PRIMARY KEY (rating_plan_id, stage_id),
    CHECK (sequence > 0),
    CHECK (stage_kind IN (
        
        'classification_lookup',
        'eligibility_evaluator',
        'territory_resolver',
        'multiplicative_chain',
        'additive',
        'flat_factor',
        'deferred_zero',
        'clamp',
        'irpm_apply',
        'round',
        'input_node',
        'formula',
        'case_node',
        'ml_model',
        'api_enrichment',
        
        'eligibility.gate',
        'modifier.schedule',
        'endorsement.factor',
        'endorsement.additive',
        'endorsement.sublimit',
        
        'endorsement.rate_branch',
        'modifier.model'
    )),
    FOREIGN KEY (rating_plan_id) REFERENCES rating_plans(rating_plan_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_plan_stages_sequence
    ON rating_plan_stages(rating_plan_id, sequence);

CREATE INDEX idx_plan_stages_kind
    ON rating_plan_stages(stage_kind, rating_plan_id);

CREATE TABLE plan_snapshots (
    snapshot_id        TEXT NOT NULL PRIMARY KEY,
    plan_id            TEXT NOT NULL REFERENCES rating_plans(rating_plan_id),
    display_name       TEXT NOT NULL,
    notes              TEXT,
    
    body_json          TEXT NOT NULL,
    
    created_at         TEXT NOT NULL,
    created_by         TEXT NOT NULL, published_at TEXT, published_by TEXT,
    UNIQUE (plan_id, display_name)
);

CREATE INDEX idx_plan_snapshots_plan_id
    ON plan_snapshots (plan_id);

CREATE INDEX idx_plan_snapshots_created_at
    ON plan_snapshots (created_at DESC);

CREATE TABLE "plan_dimensions" (
    rating_plan_id     TEXT NOT NULL,
    dim_id             TEXT NOT NULL,
    display_name       TEXT NOT NULL,
    slug               TEXT NOT NULL,
    data_type          TEXT NOT NULL,
    role               TEXT NOT NULL,
    dimension_type     TEXT,
    shape              TEXT,
    description        TEXT,
    levels_json        TEXT NOT NULL DEFAULT '[]',
    axes_json          TEXT,
    source_field       TEXT,
    
    geo_granularity        TEXT,
    geo_scope_json         TEXT,
    geo_territories_json   TEXT,
    
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    content_hash       TEXT, class_library_id TEXT, derived_from_json TEXT, classification_mapping_json TEXT, options_json TEXT, monotonicity_expected_json TEXT,
    PRIMARY KEY (rating_plan_id, dim_id),
    FOREIGN KEY (rating_plan_id) REFERENCES rating_plans(rating_plan_id) ON DELETE CASCADE,
    CHECK (data_type IN ('string', 'number', 'boolean', 'date')),
    CHECK (shape IS NULL OR shape IN ('categorical', 'banded', 'geographic', 'composite')),
    
    CHECK (geo_granularity IS NULL OR geo_granularity IN ('state', 'county', 'zip')),
    
    
    CHECK (
        CASE
            WHEN dimension_type = 'geographic' THEN geo_granularity IS NOT NULL
            ELSE geo_granularity IS NULL
        END
    )
);

CREATE INDEX idx_plan_dimensions_by_plan
    ON plan_dimensions(rating_plan_id);

CREATE INDEX idx_plan_dimensions_slug
    ON plan_dimensions(rating_plan_id, slug);

CREATE TABLE connector_snapshots (
    snapshot_id         TEXT NOT NULL PRIMARY KEY,
    connector_id        TEXT NOT NULL,
    connector_version   TEXT NOT NULL,
    request_json        TEXT NOT NULL,
    response_json       TEXT NOT NULL,
    status_code         INTEGER NOT NULL,
    vendor_request_id   TEXT,
    fetched_at          TEXT NOT NULL,
    content_hash        TEXT NOT NULL,
    cost_usd            REAL NOT NULL DEFAULT 0
);

CREATE INDEX idx_connector_snapshots_connector_id
    ON connector_snapshots (connector_id);

CREATE INDEX idx_connector_snapshots_fetched_at
    ON connector_snapshots (fetched_at DESC);

CREATE INDEX idx_connector_snapshots_content_hash
    ON connector_snapshots (content_hash);

CREATE TABLE connector_mappings (
    mapping_id        TEXT NOT NULL PRIMARY KEY,
    plan_id           TEXT NOT NULL,
    connector_id      TEXT NOT NULL,
    output_port       TEXT NOT NULL,
    target_input_key  TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    created_by        TEXT NOT NULL,
    UNIQUE (plan_id, target_input_key)
);

CREATE INDEX idx_connector_mappings_plan_id
    ON connector_mappings (plan_id);

CREATE TABLE connector_manifests (
    connector_id       TEXT NOT NULL PRIMARY KEY,
    display_name       TEXT NOT NULL,
    vendor             TEXT NOT NULL,
    category           TEXT NOT NULL,
    kind               TEXT NOT NULL DEFAULT 'rest',
    version            TEXT NOT NULL DEFAULT 'v1',
    method             TEXT NOT NULL DEFAULT 'POST',
    endpoint           TEXT NOT NULL,
    secret_env         TEXT,
    secret_param       TEXT,
    request_json       TEXT,           
    request_query      TEXT NOT NULL DEFAULT '{}',  
    inputs_json        TEXT NOT NULL DEFAULT '[]',  
    outputs_json       TEXT NOT NULL DEFAULT '[]',  
    cost_per_call_usd  REAL NOT NULL DEFAULT 0,
    ttl_seconds        INTEGER NOT NULL DEFAULT 0,
    docs_url           TEXT,
    created_at         TEXT NOT NULL,
    created_by         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
, secret_in TEXT NOT NULL DEFAULT 'query', secret_prefix TEXT);

CREATE INDEX idx_connector_manifests_vendor
    ON connector_manifests (vendor);

CREATE TABLE connector_input_bindings (
    binding_id    TEXT NOT NULL PRIMARY KEY,
    plan_id       TEXT NOT NULL,
    connector_id  TEXT NOT NULL,
    input_name    TEXT NOT NULL,
    source_kind   TEXT NOT NULL,   
    source_value  TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    created_by    TEXT NOT NULL,
    UNIQUE (plan_id, connector_id, input_name)
);

CREATE INDEX idx_connector_input_bindings_plan_id
    ON connector_input_bindings (plan_id);

CREATE TABLE enrichment_routes (
    route_id       TEXT NOT NULL PRIMARY KEY,
    plan_id        TEXT NOT NULL,
    connection_id  TEXT NOT NULL,          
    name           TEXT NOT NULL,
    bindings_json  TEXT NOT NULL DEFAULT '[]',  
    pushes_json    TEXT NOT NULL DEFAULT '[]',  
    created_at     TEXT NOT NULL,
    created_by     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);

CREATE INDEX idx_enrichment_routes_plan
    ON enrichment_routes (plan_id);

CREATE TABLE plan_input_values (
    plan_id      TEXT NOT NULL,
    input_key    TEXT NOT NULL,
    value_json   TEXT,                      
    source       TEXT NOT NULL DEFAULT '',  
    snapshot_id  TEXT,                      
    updated_at   TEXT NOT NULL,
    updated_by   TEXT NOT NULL,
    PRIMARY KEY (plan_id, input_key)
);

CREATE TABLE plan_class_codes (
    rating_plan_id       TEXT NOT NULL,
    class_code           TEXT NOT NULL,
    display_name         TEXT NOT NULL,
    family               TEXT,
    description          TEXT,
    naics_code           TEXT,
    sic_code             TEXT,
    eligible_for_json    TEXT NOT NULL DEFAULT '[]',
    exposure_bases_json  TEXT NOT NULL DEFAULT '[]',
    attributes_json      TEXT NOT NULL DEFAULT '{}',
    source               TEXT NOT NULL DEFAULT 'custom',
    note                 TEXT,
    citation_rule        TEXT,
    citation_page        TEXT,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL,
    content_hash         TEXT,
    PRIMARY KEY (rating_plan_id, class_code),
    FOREIGN KEY (rating_plan_id) REFERENCES rating_plans(rating_plan_id) ON DELETE CASCADE,
    CHECK (source IN ('iso', 'custom'))
);

CREATE INDEX idx_plan_class_codes_by_plan
    ON plan_class_codes(rating_plan_id);

CREATE INDEX idx_plan_class_codes_family
    ON plan_class_codes(rating_plan_id, family);

CREATE TABLE connector_secrets (
    connector_id TEXT PRIMARY KEY,
    ciphertext   TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by   TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_plan_snapshots_published
    ON plan_snapshots (plan_id, published_at);


CREATE TABLE plan_policy_tail (
    rating_plan_id     TEXT NOT NULL PRIMARY KEY,
    
    tail_json          TEXT NOT NULL,
    
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    
    content_hash       TEXT,
    FOREIGN KEY (rating_plan_id) REFERENCES rating_plans(rating_plan_id) ON DELETE CASCADE
);

CREATE TABLE plan_api_keys (
    key_id          TEXT NOT NULL PRIMARY KEY,
    rating_plan_id  TEXT NOT NULL,
    
    key_hash        TEXT NOT NULL,
    
    secret_prefix   TEXT NOT NULL,
    label           TEXT,
    created_at      TEXT NOT NULL,
    created_by      TEXT,
    last_used_at    TEXT,
    revoked_at      TEXT,
    FOREIGN KEY (rating_plan_id) REFERENCES rating_plans(rating_plan_id) ON DELETE CASCADE
);

CREATE INDEX idx_plan_api_keys_plan
    ON plan_api_keys (rating_plan_id);

CREATE UNIQUE INDEX idx_plan_api_keys_hash
    ON plan_api_keys (key_hash);

CREATE TABLE integrations (
    integration_id  TEXT NOT NULL PRIMARY KEY,
    name            TEXT NOT NULL,
    
    peer_name       TEXT,
    
    
    
    peer_catalog    TEXT,
    paired_at       TEXT,
    created_at      TEXT NOT NULL,
    created_by      TEXT
);

CREATE TABLE integration_pairing_codes (
    code_id         TEXT NOT NULL PRIMARY KEY,
    integration_id  TEXT NOT NULL,
    
    code_hash       TEXT NOT NULL,
    code_prefix     TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    created_by      TEXT,
    expires_at      TEXT NOT NULL,
    
    used_at         TEXT,
    
    revoked_at      TEXT,
    FOREIGN KEY (integration_id) REFERENCES integrations(integration_id) ON DELETE CASCADE
);

CREATE INDEX idx_pairing_codes_integration
    ON integration_pairing_codes (integration_id);

CREATE UNIQUE INDEX idx_pairing_codes_hash
    ON integration_pairing_codes (code_hash);

CREATE TABLE integrator_keys (
    key_id          TEXT NOT NULL PRIMARY KEY,
    integration_id  TEXT NOT NULL,
    key_hash        TEXT NOT NULL,
    secret_prefix   TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    last_used_at    TEXT,
    
    revoked_at      TEXT,
    FOREIGN KEY (integration_id) REFERENCES integrations(integration_id) ON DELETE CASCADE
);

CREATE INDEX idx_integrator_keys_integration
    ON integrator_keys (integration_id);

CREATE UNIQUE INDEX idx_integrator_keys_hash
    ON integrator_keys (key_hash);

CREATE TABLE integration_exposed_plans (
    exposed_id      TEXT NOT NULL PRIMARY KEY,
    integration_id  TEXT NOT NULL,
    rating_plan_id  TEXT NOT NULL,
    
    plan_ref        TEXT NOT NULL,
    
    
    carrier_label   TEXT NOT NULL,
    
    
    
    mapping         TEXT NOT NULL DEFAULT '[]',
    
    trace_policy    TEXT NOT NULL DEFAULT 'summary'
                    CHECK (trace_policy IN ('none', 'summary', 'full')),
    validity_days   INTEGER NOT NULL DEFAULT 30,
    live            INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL, last_test_at TEXT, last_test_premium_cents INTEGER, last_test_snapshot_id TEXT,
    FOREIGN KEY (integration_id) REFERENCES integrations(integration_id) ON DELETE CASCADE,
    FOREIGN KEY (rating_plan_id) REFERENCES rating_plans(rating_plan_id) ON DELETE CASCADE,
    UNIQUE (integration_id, carrier_label),
    UNIQUE (integration_id, rating_plan_id),
    UNIQUE (integration_id, plan_ref)
);

CREATE INDEX idx_exposed_plans_integration
    ON integration_exposed_plans (integration_id);

CREATE TABLE quote_ledger (
    quote_id        TEXT NOT NULL PRIMARY KEY,
    
    quote_set_id    TEXT,
    created_at      TEXT NOT NULL,
    source          TEXT NOT NULL
                    CHECK (source IN ('plan_owner', 'integration_seam')),
    
    rating_plan_id  TEXT NOT NULL,          
    snapshot_id     TEXT,                   
    version_kind    TEXT,                   
    content_hash    TEXT,                   
    
    integration_id  TEXT,                   
    risk_ref        TEXT,                   
    request_hash    TEXT,                   
    carrier_label   TEXT,                   
    plan_ref        TEXT,                   
    
    as_of           TEXT,
    row_status      TEXT NOT NULL CHECK (row_status IN ('ok', 'error')),
    premium         REAL,                   
    tier            TEXT,
    
    request_json    TEXT NOT NULL,          
    outcome_json    TEXT                    
, risk_id TEXT);

CREATE INDEX idx_quote_ledger_plan
    ON quote_ledger (rating_plan_id, created_at DESC);

CREATE INDEX idx_quote_ledger_integration
    ON quote_ledger (integration_id, created_at DESC);

CREATE INDEX idx_quote_ledger_risk
    ON quote_ledger (integration_id, risk_ref);

CREATE INDEX idx_quote_ledger_created
    ON quote_ledger (created_at DESC);

CREATE TABLE "audit_log" (
    audit_id          TEXT PRIMARY KEY,
    
    rating_plan_id    TEXT,
    entity_kind       TEXT NOT NULL DEFAULT 'plan',
    entity_id         TEXT,
    operator_id       TEXT NOT NULL,
    event_kind        TEXT NOT NULL,
    event_at          TEXT NOT NULL,
    before_json       TEXT,
    after_json        TEXT,
    note              TEXT,
    CHECK (entity_kind IN ('plan', 'factor_table', 'dimension', 'input_mapping', 'preview_risk')),
    CHECK (event_kind IN (
        'fork',
        'duplicate',
        'edit',
        'promote',
        'discard',
        'define',
        'retire',
        'nl_patch',
        'rollback',
        'hard_delete',
        'publish',
        'unpublish'
    ))
);

CREATE TRIGGER audit_log_no_update
    BEFORE UPDATE ON audit_log
    BEGIN
        SELECT RAISE(FAIL, 'audit_log is append-only — UPDATE rejected');
    END;

CREATE TRIGGER audit_log_no_delete
    BEFORE DELETE ON audit_log
    BEGIN
        SELECT RAISE(FAIL, 'audit_log is append-only — DELETE rejected');
    END;

CREATE INDEX idx_audit_log_plan_time
    ON audit_log(rating_plan_id, event_at DESC)
    WHERE rating_plan_id IS NOT NULL;

CREATE INDEX idx_audit_log_operator_time
    ON audit_log(operator_id, event_at DESC);

CREATE INDEX idx_audit_log_entity_time
    ON audit_log(entity_kind, entity_id, event_at DESC);


CREATE INDEX idx_quote_ledger_risk_id
    ON quote_ledger (risk_id, created_at DESC)
    WHERE risk_id IS NOT NULL;

CREATE TABLE "integration_events" (
    event_id        TEXT NOT NULL PRIMARY KEY,
    integration_id  TEXT NOT NULL,
    risk_ref        TEXT NOT NULL,
    carrier         TEXT NOT NULL,
    kind            TEXT NOT NULL
                    CHECK (kind IN ('sent','quoted','bound','declined','lost',
                                    'corrected','issued','endorsed',
                                    'cancelled','reinstated')),
    at              TEXT NOT NULL,
    premium_cents   INTEGER,
    effective_on    TEXT,
    term_months     INTEGER,
    reason          TEXT,
    removed         INTEGER NOT NULL DEFAULT 0,
    quote_pins      TEXT,
    
    policy_ref      TEXT,
    endorsement_seq INTEGER,
    submission_id   TEXT,
    ack_status      TEXT NOT NULL,
    detail          TEXT,
    applied_at      TEXT NOT NULL,
    FOREIGN KEY (integration_id) REFERENCES integrations(integration_id) ON DELETE CASCADE
);

CREATE INDEX idx_integration_events_integration
    ON integration_events (integration_id, applied_at);

CREATE INDEX idx_integration_events_risk
    ON integration_events (integration_id, risk_ref, carrier);

CREATE TABLE "plan_runs" (
    run_id             TEXT NOT NULL PRIMARY KEY,
    rating_plan_id     TEXT NOT NULL,
    kind               TEXT NOT NULL CHECK (kind IN ('sample', 'book', 'probe')),
    status             TEXT NOT NULL CHECK (status IN ('running', 'done', 'error')),
    created_at         TEXT NOT NULL,
    finished_at        TEXT,
    as_of              TEXT,
    
    snapshot_id        TEXT,
    plan_content_hash  TEXT,
    book_content_hash  TEXT,
    
    job_id             TEXT,
    
    
    request_json       TEXT NOT NULL,
    
    result_json        TEXT,
    
    error_message      TEXT, scoring_fingerprint TEXT,
    FOREIGN KEY (rating_plan_id) REFERENCES rating_plans(rating_plan_id) ON DELETE CASCADE
);

CREATE INDEX idx_plan_runs_plan_created
    ON plan_runs (rating_plan_id, created_at DESC);

CREATE TABLE plan_build_reports (
  report_id       TEXT PRIMARY KEY,
  rating_plan_id  TEXT NOT NULL REFERENCES rating_plans(rating_plan_id) ON DELETE CASCADE,
  workbook_hash   TEXT NOT NULL,
  filename        TEXT,
  spec_version    TEXT NOT NULL,
  
  
  workbook_plan_id TEXT,
  manifest_json   TEXT NOT NULL,
  issues_json     TEXT NOT NULL,
  vectors_json    TEXT NOT NULL,
  gaps_json       TEXT NOT NULL,
  created_at      TEXT NOT NULL
, workbook_blob BLOB, workbook_version TEXT, diff_json TEXT, drift_json TEXT);

CREATE INDEX idx_build_reports_plan ON plan_build_reports(rating_plan_id);

CREATE INDEX idx_build_reports_hash ON plan_build_reports(workbook_hash);

CREATE TABLE "rating_plans" (
    rating_plan_id    TEXT PRIMARY KEY,

    display_name      TEXT NOT NULL,
    line_of_business  TEXT NOT NULL,
    jurisdiction      TEXT,
    effective_date    TEXT NOT NULL,
    description       TEXT,

    parent_plan_id    TEXT,

    status            TEXT NOT NULL DEFAULT 'draft',

    source_filing_id  TEXT,
    created_at        TEXT NOT NULL,

    preview_inputs_json TEXT,

    draft_session_id  TEXT,

    template_id       TEXT,
    coverages         TEXT,
    section_layout    TEXT,
    last_edited_at    TEXT,
    content_hash      TEXT,
    product           TEXT
    CHECK (
        product IS NULL
        OR product IN (
            'bop', 'cgl', 'do', 'eo', 'wc', 'auto',
            'umbrella', 'excess', 'marine', 'inland_marine',
            'homeowners', 'dwelling', 'other'
        )
    ),

    CHECK (status IN ('draft', 'proposed', 'active', 'archived')),
    CHECK (line_of_business IN ('bop', 'cgl', 'wc', 'auto', 'umbrella')),
    CHECK (length(jurisdiction) = 2 OR jurisdiction IS NULL),
    FOREIGN KEY (parent_plan_id) REFERENCES rating_plans(rating_plan_id)
);

CREATE INDEX idx_rating_plans_draft_session
    ON rating_plans(draft_session_id) WHERE draft_session_id IS NOT NULL;

CREATE INDEX idx_rating_plans_lob_status
    ON rating_plans(line_of_business, status);

CREATE INDEX idx_rating_plans_parent
    ON rating_plans(parent_plan_id)
    WHERE parent_plan_id IS NOT NULL;

CREATE INDEX idx_rating_plans_product
    ON rating_plans(product, status);

CREATE UNIQUE INDEX unique_active_plan_per_product_jurisdiction
    ON rating_plans(product, jurisdiction)
    WHERE status = 'active';

CREATE INDEX idx_build_reports_workbook_plan
    ON plan_build_reports(workbook_plan_id)
    WHERE workbook_plan_id IS NOT NULL;

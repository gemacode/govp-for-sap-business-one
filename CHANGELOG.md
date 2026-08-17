# Changelog

## 0.1.1 — 2026-08-18

- Compute `validUntil` from the SAP document date so idempotent retries keep an identical payload.
- Reject missing or invalid document dates and non-positive validity periods before issuance.
- Extend the deterministic suite with retry stability and configuration validation.

## 0.1.0 — 2026-08-17

- First open candidate for SAP Business One Service Layer OData v4.
- Issue from Delivery, verify from Goods Receipt PO, canonical evidence and stable idempotency.
- Observe mode, UDF links, session reuse, retry policy and deterministic test suite.

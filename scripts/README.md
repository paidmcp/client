# Client scripts

Use these scripts when developing or troubleshooting `paidmcp-client`.

## Structure

- `tests/`: repeatable smoke tests meant to validate expected behavior.
- `debug/`: deeper diagnostics with verbose logs and facilitator probes.

## Quick usage

Run inside `client/`:

- `npm run test:paid-fetch` - end-to-end paid call smoke test
- `npm run debug:x402-base` - detailed Base x402 flow
- `npm run debug:x402-plasma` - detailed Plasma x402 flow
- `npm run debug:plasma-facilitators` - Plasma facilitator comparison
- `npm run debug:facilitator-matrix` - broad Base facilitator probe
- `npm run debug:settle-resource-url` - resource URL settle behavior check

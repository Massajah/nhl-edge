# NHL Edge project instructions

NHL Edge is a full-stack NHL betting analysis application.

## Technology

- React with Vite
- Node.js and Express
- MongoDB Atlas
- JWT authentication
- Google authentication

## Engineering principles

- Audit the existing implementation before making changes.
- Treat the current codebase as the source of truth.
- Preserve authentication, authorization and strict user-level data isolation.
- Never trust a client-provided userId.
- Reuse existing services and business logic instead of duplicating them.
- Keep calculations deterministic, testable and auditable.
- Do not change unrelated features or redesign unrelated pages.
- Keep frontend styling consistent with the existing NHL Edge dark theme.
- Maintain backward compatibility unless the task explicitly requires otherwise.
- Run relevant tests, lint and production builds after changes.
- Report files changed, architectural decisions, test results and known limitations.

## Betting-model principles

- Separate permanent team strength from temporary game-specific conditions.
- Do not use subjective Analyzer-only adjustments in automatic league-wide rating updates.
- Store model versions and calculation inputs for reproducibility.
- Historical simulations must avoid future-data leakage.
- Preview and simulation operations must not modify live ratings without explicit confirmation.

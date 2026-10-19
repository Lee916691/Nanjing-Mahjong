# Repository Guidelines

## Project Structure & Module Organization

This TypeScript monorepo uses npm workspaces:

- `apps/web/src/`: React/Vite client, including `App.tsx` and `styles.css`. Mahjong SVG artwork lives alongside the tile components.
- `cloud/`: Sites Worker HTTP API and D1 persistence; `db/` and `drizzle/`: database schema and migrations.
- `apps/server/src/`: reusable authoritative table logic and original Node server.
- `packages/game-core/src/`: game state, actions, scoring, and rule implementations under `rules/`.
- `packages/game-core/test/`: Vitest unit and integration tests.
- `packages/shared-types/src/`: shared type definitions.
- `docs/`: rules, architecture, state machine, socket protocol, and planning documents.

Keep game-core independent of UI and networking. Follow the documented server-authoritative architecture: clients submit intentions; the server validates actions and exposes safe player views.

## Build, Test, and Development Commands

Run commands from the repository root:

- `npm ci`: install dependencies from the committed lockfile.
- `npm run dev`: start the Workers preview on port 3105 (run `npm run build` and `npm run db:local` first).
- `npm run build`: build the shared packages, web assets, and deployment Worker.
- `npm test`: run workspace test suites, including game-core and the Node server. Use `npm run test:cloud` for D1/API contracts and `npm run test:e2e` for the four-browser cloud flow.
- `npm run typecheck`: check TypeScript across workspaces.
- `npm run lint`: run ESLint.
- `npm run format:check`: check Prettier formatting.
- `npm test -w @nanjing-mahjong/game-core -- test/self-draw.test.ts`: run one test file.

## Coding Style & Naming Conventions

Use strict TypeScript, ES modules, two-space indentation, single quotes, semicolons, and trailing commas. Prettier uses a 100-character print width; format changes with `npx prettier <path> --write`. ESLint enforces consistent type imports and React Hooks rules.

Use camelCase for functions and variables, PascalCase for types and React components, and descriptive filenames matching nearby modules, such as `nanjing-open.ts`.

## Rules & Testing Guidelines

`docs/nanjing-mahjong-rules.md` is the sole authority for rule implementations, tests, and UI wording. Never guess undocumented behavior; record unresolved cases in `docs/open-questions.md`.

For every rule change, update the rule document, then tests, then implementation. Never change rule code without updating documentation and tests.

Name tests `*.test.ts` under `packages/game-core/test/`; use Vitest `describe`, `it`, and `expect`. Cover legal actions, rejected actions, state transitions, and scoring consequences. No numeric coverage threshold is configured.

## Documentation-First Development

Any new feature, behavior change, data-structure change, interface change, or bug fix must begin by checking and creating or updating the relevant documentation before any test code or production code is changed. The documentation must state, at minimum:

- the background and problem being solved;
- expected behavior and boundary conditions;
- affected modules and data flow;
- existing behavior that must not change;
- security, compatibility, and error-handling requirements;
- acceptance criteria and the test plan.

A small, narrowly scoped fix may use a brief change note in an existing relevant document; it does not require a separate long document.

For every development task, Codex must work in this order:

1. Check the existing requirement, architecture, rule, and development-guideline documents.
2. Define the task scope and affected behavior.
3. Update the relevant documentation before changing test code or production code.
4. Implement code and tests from the documented requirements.
5. Check the implementation against the documentation for divergence.
6. At task completion, record actual completion status, test results, and unresolved issues.

If requirements are ambiguous, architecture and documentation disagree, or a major design decision is required, stop implementation and report the issue rather than expanding the task scope without approval.

The reverse order is prohibited: do not modify tests or production code first and add the requirements documentation afterward.

Documentation acceptance criteria must be translatable into automated tests or explicit manual verification steps. If implementation reveals that the design is unsuitable, update the documentation before adjusting the code. Do not leave documentation describing obsolete behavior, change product rules merely to make tests pass, or mark tests as passed unless they were actually run.

At the end of each development task, check whether affected requirement, architecture, and implementation-status documents need synchronization. Update only affected material; do not rewrite unrelated documents or create duplicate summary files.

Keep each task within its explicitly requested development step. Do not implement later steps early or perform opportunistic broad refactors. A documentation-only task must not change business code, tests, build configuration, database migrations, or dependencies.

## Commit & Pull Request Guidelines

Follow the history's Conventional Commit style, for example `feat(game-core): complete di-hu flow` or `fix(game-core): allow peng with three matching tiles`.

Keep changes focused. PRs should describe behavior changes, link relevant issues or rule sections, and report validation results. Include screenshots for visible UI changes. Before requesting review, run tests, typechecking, lint, formatting checks, and the build.

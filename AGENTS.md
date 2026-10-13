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

## Commit & Pull Request Guidelines

Follow the history's Conventional Commit style, for example `feat(game-core): complete di-hu flow` or `fix(game-core): allow peng with three matching tiles`.

Keep changes focused. PRs should describe behavior changes, link relevant issues or rule sections, and report validation results. Include screenshots for visible UI changes. Before requesting review, run tests, typechecking, lint, formatting checks, and the build.

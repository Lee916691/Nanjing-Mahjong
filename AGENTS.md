# Agent Guidelines

- `main` must always remain runnable.
- Complete only the task that was assigned.
- Do not reorganize directories without explicit instruction.
- Do not modify files outside the task scope.
- `packages/game-core` must remain pure TypeScript.
- The client must never be the authoritative source of game state.
- Do not leak a player's hand to other players.
- Changes to core logic must include tests.
- Do not delete or skip tests to hide failures.
- When rules are ambiguous, write the question in `docs/open-questions.md` instead of guessing.

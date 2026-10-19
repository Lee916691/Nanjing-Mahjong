# Room and Match State Machine

> Implemented extension, 2026-10-19: the text below retains the original four-player baseline.
> The two-player mode uses two online ready members, two confirmations to skip the
> 45-second hand review, and eight effective dealer turns with final-turn continuation at turn eight.
> Mode stays fixed across rematches; disconnection pauses and never changes the mode or player count.
> See [two-player design](two-player-mode.md) and authoritative rules chapter 29 in
> [the rules specification](nanjing-mahjong-rules.md). Automated tests pass; natural human play remains pending.

Room waiting → playing → completed (normal) or ended (host termination). completed/ended → waiting through host rematch. Four online prepared members are required for start.

While playing, any disconnected member causes a derived paused state. Seats and pending decisions remain stored. All four online resumes; no timeout passes or AI actions.

Game-core owns hand transitions: initial dealing/replacement → Di Hu decisions → discard/draw/reaction stages → ended. The server advances draws and resolved reactions automatically. It never exposes START_GAME, DRAW_TILE or RESOLVE_REACTION_WINDOW as client commands.

At a hand boundary, completeCurrentHand settles and determines dealer/effective-turn progression exactly once. A non-final result is shown for 45 active seconds, then prepareNextHand and dealing begin. Pauses stop this countdown. Completion of the sixteenth effective dealer turn is decided by Match, not by the host.

Every accepted command is processed synchronously per server process, saved in a SQLite transaction with its receipt, then published. An in-memory room is replaced only after the transaction commits. After process restart all restored seats are offline until their sessions reconnect.

Premature termination preserves settled scores and is explicitly labelled ended. Rematch clears readiness, scores and old action epochs before another start.

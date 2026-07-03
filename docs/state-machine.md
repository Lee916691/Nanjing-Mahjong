# State Machine

## Purpose

Describe authoritative game states once gameplay requirements are confirmed.

## Draft State Areas

- Lobby.
- Seat assignment.
- Game setup.
- Turn progression.
- Hand resolution.
- Match end.

## To Confirm

- Exact state names.
- Allowed transitions.
- Server-side validation requirements.
- Reconnection behavior.

## Notes

The server must be the authoritative state source. The client may display state but must not decide canonical game results.

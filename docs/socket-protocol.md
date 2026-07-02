# Socket Protocol

## Purpose

Define Socket.IO events shared by the client and server.

## Current Events

### Server to Client

- `server:hello`: emitted after a socket connects.

## To Confirm

- Connection authentication, if any.
- Room and table event names.
- Private player payload boundaries.
- Public game state payload boundaries.
- Error event format.

## Notes

Do not send one player's private hand data to other players.

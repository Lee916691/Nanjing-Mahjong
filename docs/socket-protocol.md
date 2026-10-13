# Socket Protocol

## Identity

POST /api/session creates or restores a random HttpOnly SameSite=Strict cookie. The response contains only the current room ID. Socket.IO authenticates this cookie; a replacement connection takes over the seat. Clients never send a player index or authoritative game state.

## Commands

Events: room:create, room:join, room:leave, room:ready, room:start, room:end, room:rematch, game:action.

Each request has a unique commandId. Room commands carry roomId and, when relevant, name or ready. game:action carries only a server-issued token identifying an offered action. Runtime validation rejects unknown fields. Acknowledgements contain commandId, ok, roomId/revision on success or error.code/error.message.

Retry an unacknowledged command with the same commandId. A committed receipt is persistent and replayed without applying the action twice. Failed transactions do not receive a success acknowledgement.

## Views

room:state is a complete per-player RoomView. Only the recipient gets hand and action choices. Tile walls, hidden hands, listening sets, private response queues, session identifiers and internal results never cross the boundary.

Action tokens bind room, hand/action epoch, recipient seat and exact intent. An epoch is retained while collecting independent reaction choices. Players with only pass available are handled internally. Once all decisions are collected, the engine receives them in its required order and resolves priorities.

Declined Di Hu decisions are sent only to the deciding player and the next eligible player while collection continues. Partial reactions are saved and acknowledged only to their owner; they do not increment or broadcast a public room revision. Availability is recomputed after progression.

## Connection and errors

room:left clears the current view. session:replaced stops the old browser connection. A missing player pauses the room and next-hand countdown. Reconnection receives a fresh complete view.

Common errors: BAD_REQUEST, ROOM_NOT_FOUND, ROOM_FULL, FORBIDDEN, NOT_READY, STALE_ACTION, PAUSED, RATE_LIMIT, OPERATION_FAILED. Clients display a message and do not apply speculative game state.

import { createGameState, gameReducer } from './reducer';
import type { GameAction } from './reducer';
import type { GameState } from './state';

export interface GameEngine {
  createGame(): GameState;
  startGame(state: GameState): GameState;
  advanceTurn(state: GameState): GameState;
  applyAction(state: GameState, action: GameAction): GameState;
}

export const gameEngine: GameEngine = {
  createGame,
  startGame,
  advanceTurn,
  applyAction,
};

export function createGame(): GameState {
  return createGameState();
}

export function createInitialGame(): GameState {
  return createGame();
}

export function startGame(state: GameState): GameState {
  return dispatch(state, { type: 'START_GAME' });
}

export function advanceTurn(state: GameState): GameState {
  return dispatch(state, { type: 'DRAW_TILE' });
}

export function applyAction(state: GameState, action: GameAction): GameState {
  return dispatch(state, action);
}

function dispatch(state: GameState, action: GameAction): GameState {
  return gameReducer(state, action);
}

export type { GameAction } from './reducer';

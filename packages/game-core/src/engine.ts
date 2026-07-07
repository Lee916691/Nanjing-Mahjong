import { createGameState, gameReducer } from './reducer';
import type { GameAction, RuleSetOptions } from './reducer';
import type { GameState } from './state';

export interface GameEngine {
  createGame(options?: RuleSetOptions): GameState;
  startGame(state: GameState, options?: RuleSetOptions): GameState;
  advanceTurn(state: GameState): GameState;
  applyAction(state: GameState, action: GameAction): GameState;
}

export const gameEngine: GameEngine = {
  createGame,
  startGame,
  advanceTurn,
  applyAction,
};

export function createGame(options: RuleSetOptions = {}): GameState {
  return createGameState(options);
}

export function createInitialGame(options: RuleSetOptions = {}): GameState {
  return createGame(options);
}

export function startGame(state: GameState, options: RuleSetOptions = {}): GameState {
  return dispatch(state, { type: 'START_GAME', ruleSetId: options.ruleSetId });
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

export type { GameAction, RuleSetOptions } from './reducer';

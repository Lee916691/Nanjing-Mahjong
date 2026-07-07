import { createGameState, gameReducer } from './reducer';
import type { GameAction } from './actions';
import type { GameCreationOptions, StartGameOptions } from './options';
import type { GameState } from './state';

export interface GameEngine {
  createGame(options?: GameCreationOptions): GameState;
  startGame(state: GameState, options?: StartGameOptions): GameState;
  advanceTurn(state: GameState): GameState;
  applyAction(state: GameState, action: GameAction): GameState;
}

export const gameEngine: GameEngine = {
  createGame,
  startGame,
  advanceTurn,
  applyAction,
};

export function createGame(options: GameCreationOptions = {}): GameState {
  return createGameState(options);
}

export function createInitialGame(options: GameCreationOptions = {}): GameState {
  return createGame(options);
}

export function startGame(state: GameState, options: StartGameOptions = {}): GameState {
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

export type { GameAction } from './actions';
export type { GameCreationOptions, RuleSetOptions, StartGameOptions } from './options';

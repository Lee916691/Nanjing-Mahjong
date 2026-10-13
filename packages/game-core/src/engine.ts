import { createGameState, gameReducer } from './reducer.js';
import { updateRacks, packageNaturalWins, forceFourthMeld } from './packages.js';
import type { GameAction } from './actions.js';
import type { GameCreationOptions, StartGameOptions } from './options.js';
import type { GameState } from './state.js';

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
  return dispatch(state, {
    type: 'START_GAME',
    ruleSetId: options.ruleSetId,
    dealerIndex: options.dealerIndex,
    dealerSeat: options.dealerSeat,
  });
}

export function advanceTurn(state: GameState): GameState {
  return dispatch(state, { type: 'DRAW_TILE' });
}

export function applyAction(state: GameState, action: GameAction): GameState {
  return dispatch(state, action);
}

function dispatch(state: GameState, action: GameAction): GameState {
  return forceFourthMeld(
    state,
    packageNaturalWins(state, updateRacks(state, gameReducer(state, action), action)),
  );
}

export type { GameAction } from './actions.js';
export type { GameCreationOptions, RuleSetOptions, StartGameOptions } from './options.js';

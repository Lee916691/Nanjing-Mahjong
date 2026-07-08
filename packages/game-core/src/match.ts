import { createGame, startGame } from './engine';
import { SEATS } from './player';
import type { Seat } from './player';
import { DEFAULT_RULE_SET_ID, getRuleSet } from './rules';
import type { RuleSetId } from './rules';
import type { GameState } from './state';

export type MatchStatus = 'waiting' | 'playing' | 'completed';
export type HandStatus = 'not-started' | 'playing' | 'completed';

export type CompletedHandResult = 'unknown' | 'not-scored-yet';

export interface CompletedHandSummary {
  readonly handIndex: number;
  readonly dealerIndex: number;
  readonly result: CompletedHandResult;
}

export interface MatchState {
  readonly ruleSetId: RuleSetId;
  readonly status: MatchStatus;
  readonly totalEffectiveDealerTurns: number;
  readonly effectiveDealerTurn: number;
  readonly dealerIndex: number;
  readonly currentHandIndex: number;
  readonly currentHandStatus: HandStatus;
  readonly currentHand: GameState;
  readonly cumulativeScores: readonly number[];
  readonly completedHands: readonly CompletedHandSummary[];
  readonly isFinalDealerTurn: boolean;
}

export interface MatchCreationOptions {
  readonly ruleSetId?: RuleSetId;
  readonly dealerIndex?: number;
  readonly dealerSeat?: Seat;
}

export type StartMatchOptions = MatchCreationOptions;
export type CreateInitialHandForMatchOptions = MatchCreationOptions;

const INITIAL_SCORE = 1000;
const FIRST_EFFECTIVE_DEALER_TURN = 1;

export function createMatch(options: MatchCreationOptions = {}): MatchState {
  const ruleSet = getRuleSet(options.ruleSetId ?? DEFAULT_RULE_SET_ID);
  const currentHand = createGame({
    ruleSetId: ruleSet.id,
    dealerIndex: options.dealerIndex,
    dealerSeat: options.dealerSeat,
  });

  return {
    ruleSetId: ruleSet.id,
    status: 'waiting',
    totalEffectiveDealerTurns: ruleSet.totalEffectiveDealerTurns,
    effectiveDealerTurn: FIRST_EFFECTIVE_DEALER_TURN,
    dealerIndex: currentHand.dealerIndex,
    currentHandIndex: 0,
    currentHandStatus: 'not-started',
    currentHand,
    cumulativeScores: SEATS.map(() => INITIAL_SCORE),
    completedHands: [],
    isFinalDealerTurn: FIRST_EFFECTIVE_DEALER_TURN === ruleSet.totalEffectiveDealerTurns,
  };
}

export function createInitialHandForMatch(
  match: MatchState,
  options: CreateInitialHandForMatchOptions = {},
): GameState {
  const dealerIndex =
    options.dealerIndex ?? (options.dealerSeat === undefined ? match.dealerIndex : undefined);

  return createGame({
    ruleSetId: options.ruleSetId ?? match.ruleSetId,
    dealerIndex,
    dealerSeat: options.dealerSeat,
  });
}

export function startMatch(match: MatchState, options: StartMatchOptions = {}): MatchState {
  const hasHandOverride =
    options.ruleSetId !== undefined ||
    options.dealerIndex !== undefined ||
    options.dealerSeat !== undefined;
  const readyHand = hasHandOverride ? createInitialHandForMatch(match, options) : match.currentHand;
  const currentHand = startGame(readyHand, {
    ruleSetId: readyHand.ruleSetId,
    dealerIndex: readyHand.dealerIndex,
  });
  const ruleSet = getRuleSet(currentHand.ruleSetId);

  return {
    ...match,
    ruleSetId: currentHand.ruleSetId,
    status: 'playing',
    totalEffectiveDealerTurns: ruleSet.totalEffectiveDealerTurns,
    dealerIndex: currentHand.dealerIndex,
    currentHandStatus: currentHand.phase === 'ended' ? 'completed' : 'playing',
    currentHand,
    isFinalDealerTurn: match.effectiveDealerTurn === ruleSet.totalEffectiveDealerTurns,
  };
}

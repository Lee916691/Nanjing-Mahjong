import { createGame, startGame } from './engine';
import { copyPlayers, SEATS } from './player';
import type { Seat } from './player';
import { DEFAULT_RULE_SET_ID, getRuleSet } from './rules';
import type { RuleSetId } from './rules';
import type { GameState } from './state';

export type MatchStatus = 'waiting' | 'playing' | 'completed';
export type HandStatus = 'not-started' | 'playing' | 'completed';

export type DealerTransition = 'advance' | 'stay';
export type HandCompletionReason =
  | 'normal-dealer-advance'
  | 'dealer-win'
  | 'draw'
  | 'special-no-dealer-advance'
  | 'final-turn-continuation'
  | 'not-scored-yet';

export interface HandCompletion {
  readonly dealerTransition: DealerTransition;
  readonly reason: HandCompletionReason;
  readonly completedBy?: number;
  readonly notes?: string;
}

export type CompletedHandResult = 'unknown' | 'not-scored-yet';

export interface CompletedHandSummary {
  readonly handIndex: number;
  readonly dealerIndex: number;
  readonly result: CompletedHandResult;
  readonly effectiveDealerTurn?: number;
  readonly dealerTransition?: DealerTransition;
  readonly reason?: HandCompletionReason;
  readonly completedBy?: number;
  readonly notes?: string;
  readonly pendingScoringEventCount?: number;
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

  if (!hasHandOverride) {
    return startCurrentHand(match);
  }

  const readyHand = createInitialHandForMatch(match, options);
  const ruleSet = getRuleSet(readyHand.ruleSetId);

  return startCurrentHand({
    ...match,
    ruleSetId: readyHand.ruleSetId,
    totalEffectiveDealerTurns: ruleSet.totalEffectiveDealerTurns,
    dealerIndex: readyHand.dealerIndex,
    currentHandStatus: 'not-started',
    currentHand: readyHand,
    isFinalDealerTurn: match.effectiveDealerTurn === ruleSet.totalEffectiveDealerTurns,
  });
}

export function startCurrentHand(match: MatchState): MatchState {
  if (match.status === 'completed') {
    throw new Error('Cannot start a hand after the match is completed');
  }

  if (match.currentHandStatus === 'playing') {
    return match;
  }

  if (match.currentHandStatus !== 'not-started') {
    throw new Error('Current hand must be not-started before it can start');
  }

  const currentHand = startGame(match.currentHand, {
    ruleSetId: match.ruleSetId,
    dealerIndex: match.dealerIndex,
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

export function completeCurrentHand(match: MatchState, completion: HandCompletion): MatchState {
  if (match.status !== 'playing') {
    throw new Error('Current match must be playing before a hand can complete');
  }

  if (match.currentHandStatus !== 'playing') {
    throw new Error('Current hand must be playing before it can complete');
  }

  const shouldAdvanceDealer = completion.dealerTransition === 'advance';
  const nextDealerIndex = shouldAdvanceDealer
    ? getNextDealerIndex(match.dealerIndex)
    : match.dealerIndex;
  const nextEffectiveDealerTurn = shouldAdvanceDealer
    ? Math.min(match.effectiveDealerTurn + 1, match.totalEffectiveDealerTurns)
    : match.effectiveDealerTurn;
  const matchCompleted =
    shouldAdvanceDealer && match.effectiveDealerTurn >= match.totalEffectiveDealerTurns;
  const summary: CompletedHandSummary = {
    handIndex: match.currentHandIndex,
    dealerIndex: match.dealerIndex,
    effectiveDealerTurn: match.effectiveDealerTurn,
    result: 'not-scored-yet',
    dealerTransition: completion.dealerTransition,
    reason: completion.reason,
    ...(completion.completedBy === undefined ? {} : { completedBy: completion.completedBy }),
    ...(completion.notes === undefined ? {} : { notes: completion.notes }),
    pendingScoringEventCount: match.currentHand.pendingScoringEvents.length,
  };

  return {
    ...match,
    status: matchCompleted ? 'completed' : 'playing',
    effectiveDealerTurn: nextEffectiveDealerTurn,
    dealerIndex: nextDealerIndex,
    currentHandStatus: 'completed',
    currentHand: syncHandDealer(
      {
        ...match.currentHand,
        phase: 'ended',
        turnStage: 'hand-ended',
        pendingAction: {
          playerIndex: null,
          seat: null,
          type: 'none',
        },
      },
      nextDealerIndex,
    ),
    completedHands: [...match.completedHands, summary],
    isFinalDealerTurn: nextEffectiveDealerTurn === match.totalEffectiveDealerTurns,
  };
}

export function prepareNextHand(match: MatchState): MatchState {
  if (match.status !== 'playing') {
    throw new Error('Match must be playing before preparing the next hand');
  }

  if (match.currentHandStatus !== 'completed') {
    throw new Error('Current hand must be completed before preparing the next hand');
  }

  const currentHand = createInitialHandForMatch(match);

  return {
    ...match,
    dealerIndex: currentHand.dealerIndex,
    currentHandIndex: match.currentHandIndex + 1,
    currentHandStatus: 'not-started',
    currentHand,
    isFinalDealerTurn: match.effectiveDealerTurn === match.totalEffectiveDealerTurns,
  };
}

function syncHandDealer(hand: GameState, dealerIndex: number): GameState {
  return {
    ...hand,
    players: copyPlayers(hand.players).map((player, index) => ({
      ...player,
      isDealer: index === dealerIndex,
    })),
    currentPlayerIndex: dealerIndex,
    dealerIndex,
  };
}

function getNextDealerIndex(dealerIndex: number): number {
  return (dealerIndex + 1) % SEATS.length;
}

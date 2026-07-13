import { applyAction, createGame, startGame } from './engine';
import type { GameAction } from './actions';
import { copyPlayers, SEATS } from './player';
import type { Seat } from './player';
import { DEFAULT_RULE_SET_ID, getRuleSet } from './rules';
import type { RuleSetId } from './rules';
import type { GameState } from './state';

const FLOWER_KONG_KINDS = new Set([
  'red-center',
  'fortune',
  'white-board',
  'plum-orchid-bamboo-chrysanthemum',
  'spring-summer-autumn-winter',
]);
const SCORING_EVENT_CREATION_STAGES = new Set([
  'initial-deal',
  'initial-flower-replacement',
  'runtime-flower-replacement',
]);

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

  return settlePendingScoringEvents({
    ...match,
    ruleSetId: currentHand.ruleSetId,
    status: 'playing',
    totalEffectiveDealerTurns: ruleSet.totalEffectiveDealerTurns,
    dealerIndex: currentHand.dealerIndex,
    currentHandStatus: currentHand.phase === 'ended' ? 'completed' : 'playing',
    currentHand,
    isFinalDealerTurn: match.effectiveDealerTurn === ruleSet.totalEffectiveDealerTurns,
  });
}

export function applyGameActionToMatch(match: MatchState, action: GameAction): MatchState {
  const currentHand = applyAction(match.currentHand, action);
  if (
    currentHand === match.currentHand &&
    Array.isArray(match.currentHand.pendingScoringEvents) &&
    match.currentHand.pendingScoringEvents.length === 0
  ) {
    return match;
  }
  return settlePendingScoringEvents(
    currentHand === match.currentHand ? match : { ...match, currentHand },
  );
}

export function settlePendingScoringEvents(match: MatchState): MatchState {
  const events: unknown = match.currentHand?.pendingScoringEvents;
  if (!Array.isArray(events)) {
    throw settlementError('pendingScoringEvents must be an array');
  }
  if (events.length === 0) return match;

  const players: unknown = match.currentHand?.players;
  const scores: unknown = match.cumulativeScores;
  if (!Array.isArray(players) || players.length !== 4) {
    throw settlementError('players must contain exactly four entries');
  }
  if (
    !Array.isArray(scores) ||
    scores.length !== 4 ||
    scores.length !== players.length ||
    !scores.every((score) => Number.isFinite(score) && Number.isInteger(score))
  ) {
    throw settlementError('cumulativeScores must contain four finite integers');
  }

  const deltas = Array<number>(players.length).fill(0);
  events.forEach((candidate: unknown, eventIndex) => {
    if (!isRecord(candidate)) throw settlementError(`event ${eventIndex} must be an object`);
    if (candidate.status !== 'pending')
      throw settlementError(`event ${eventIndex} status is invalid`);
    const eventDeltas = Array<number>(players.length).fill(0);

    if (candidate.type === 'ming-gang-created') {
      const receiver = validPlayerIndex(candidate.receiverPlayerIndex, players.length, eventIndex);
      const payer = validPlayerIndex(candidate.payerPlayerIndex, players.length, eventIndex);
      if (receiver === payer) throw settlementError(`event ${eventIndex} payer equals receiver`);
      if (typeof candidate.meldId !== 'string' || candidate.meldId.length === 0) {
        throw settlementError(`event ${eventIndex} meldId is invalid`);
      }
    } else if (candidate.type === 'flower-kong-created') {
      const receiver = validPlayerIndex(candidate.playerIndex, players.length, eventIndex);
      const player = players[receiver];
      if (!isRecord(player) || candidate.seat !== player.seat) {
        throw settlementError(`event ${eventIndex} seat is invalid`);
      }
      if (typeof candidate.kind !== 'string' || !FLOWER_KONG_KINDS.has(candidate.kind)) {
        throw settlementError(`event ${eventIndex} flower kind is invalid`);
      }
      if (
        typeof candidate.createdDuring !== 'string' ||
        !SCORING_EVENT_CREATION_STAGES.has(candidate.createdDuring)
      ) {
        throw settlementError(`event ${eventIndex} createdDuring is invalid`);
      }
    } else {
      throw settlementError(`event ${eventIndex} type is invalid`);
    }

    if (!Array.isArray(candidate.transfers) || candidate.transfers.length === 0) {
      throw settlementError(`event ${eventIndex} transfers must be a non-empty array`);
    }
    candidate.transfers.forEach((transfer: unknown, transferIndex) => {
      if (!isRecord(transfer)) {
        throw settlementError(`event ${eventIndex} transfer ${transferIndex} must be an object`);
      }
      const from = validPlayerIndex(
        transfer.fromPlayerIndex,
        players.length,
        eventIndex,
        transferIndex,
      );
      const to = validPlayerIndex(
        transfer.toPlayerIndex,
        players.length,
        eventIndex,
        transferIndex,
      );
      if (from === to) {
        throw settlementError(`event ${eventIndex} transfer ${transferIndex} pays itself`);
      }
      if (
        typeof transfer.amount !== 'number' ||
        !Number.isFinite(transfer.amount) ||
        !Number.isInteger(transfer.amount) ||
        transfer.amount <= 0
      ) {
        throw settlementError(`event ${eventIndex} transfer ${transferIndex} amount is invalid`);
      }
      eventDeltas[from] = (eventDeltas[from] ?? 0) - transfer.amount;
      eventDeltas[to] = (eventDeltas[to] ?? 0) + transfer.amount;
    });

    if (sum(eventDeltas) !== 0) throw settlementError(`event ${eventIndex} delta is not conserved`);
    eventDeltas.forEach((delta, playerIndex) => {
      deltas[playerIndex] = (deltas[playerIndex] ?? 0) + delta;
    });
  });

  if (sum(deltas) !== 0) throw settlementError('batch delta is not conserved');
  const cumulativeScores = scores.map((score, playerIndex) => score + (deltas[playerIndex] ?? 0));
  if (!cumulativeScores.every((score) => Number.isFinite(score) && Number.isInteger(score)))
    throw settlementError('settled score is not finite');
  return {
    ...match,
    cumulativeScores,
    currentHand: { ...match.currentHand, pendingScoringEvents: [] },
  };
}

export function completeCurrentHand(match: MatchState, completion: HandCompletion): MatchState {
  if (match.status !== 'playing') {
    throw new Error('Current match must be playing before a hand can complete');
  }

  if (match.currentHandStatus !== 'playing') {
    throw new Error('Current hand must be playing before it can complete');
  }

  const settledMatch = settlePendingScoringEvents(match);

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
    pendingScoringEventCount: settledMatch.currentHand.pendingScoringEvents.length,
  };

  return {
    ...settledMatch,
    status: matchCompleted ? 'completed' : 'playing',
    effectiveDealerTurn: nextEffectiveDealerTurn,
    dealerIndex: nextDealerIndex,
    currentHandStatus: 'completed',
    currentHand: syncHandDealer(
      {
        ...settledMatch.currentHand,
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

  if (match.currentHand.pendingScoringEvents.length !== 0) {
    throw new Error('Match invariant failed: completed hand has pending scoring events');
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validPlayerIndex(
  value: unknown,
  playerCount: number,
  eventIndex: number,
  transferIndex?: number,
): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 0 || value >= playerCount) {
    const location = transferIndex === undefined ? '' : ` transfer ${transferIndex}`;
    throw settlementError(`event ${eventIndex}${location} player index is invalid`);
  }
  return value;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function settlementError(detail: string): Error {
  return new Error(`Scoring settlement invariant failed: ${detail}`);
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

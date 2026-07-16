import { copyPlayers, createInitialPlayers, SEATS } from './player';
import type { PlayerState } from './player';
import { DEFAULT_RULE_SET_ID, getRuleSet } from './rules';
import type {
  DeclareAnGangAction,
  DeclareBuGangAction,
  DeclareSelfDrawHuAction,
  DiscardAction,
  GameAction,
  ReactionResponseType,
  SubmitDiHuDecisionAction,
} from './actions';
import {
  getWinningTileFaces,
  isValidHuEvaluation,
  isValidMeld,
  isValidOrdinaryTileFace as isValidOrdinaryTileFaceShape,
  ordinaryTileFaceKey,
} from './hu';
import type { GameCreationOptions, StartGameOptions } from './options';
import {
  FOUR_COPY_FLOWER_KINDS,
  FOUR_COPY_INDEXES,
  NUMBER_TILE_RANKS,
  NUMBER_TILE_SUITS,
  PLANT_FLOWER_KINDS,
  SEASON_FLOWER_KINDS,
  WIND_TILE_KINDS,
  isSameOrdinaryTileFace,
} from './state';
import type {
  DrawTileFromWallResult,
  DrawnTileResolutionResult,
  BuGangReactionWindow,
  DiHuDeclaration,
  DiHuDeclarationState,
  DiHuDecisionAvailability,
  DiscardReactionWindow,
  FlowerKongKind,
  FlowerReplacementResult,
  FlowerTile,
  GangPackageState,
  GameState,
  HandProgressFacts,
  HandResult,
  HuEvaluation,
  HuSource,
  MahjongTile,
  NumberTile,
  OrdinaryTileFace,
  OrdinaryHandTile,
  PendingAction,
  PendingScoringEvent,
  PendingSpecialDiscardScoringEvent,
  ReactionAvailability,
  ReactionResponse,
  ReactionWindow,
  ScoringEventCreationStage,
  ScoreTransfer,
  SinglePlayerFlowerReplacementInput,
  SinglePlayerFlowerReplacementResult,
  SelfDrawProvenance,
  SelfDrawSource,
  SpecialDiscardTrackingState,
  TileWall,
  ThreeMouthPlayerState,
  ThreeMouthHuResolution,
  ThreeMouthState,
  WindTile,
} from './state';

export type {
  ClaimReactionAction,
  DeclareAnGangAction,
  DeclareBuGangAction,
  DiscardAction,
  DrawAction,
  GameAction,
  PassReactionAction,
  ReactionAction,
  ReactionResponseType,
  ResolveReactionWindowAction,
  SubmitReactionAction,
  SubmitDiHuDecisionAction,
  StartGameAction,
} from './actions';

export function gameReducer(state: GameState, action: GameAction): GameState {
  if (validThreeMouthState(state) === null) return state;
  if (action.type !== 'START_GAME' && validGangPackageState(state) === null) return state;
  switch (action.type) {
    case 'START_GAME':
      return startGameState(state, {
        ruleSetId: action.ruleSetId,
        dealerIndex: action.dealerIndex,
        dealerSeat: action.dealerSeat,
      });
    case 'DRAW_TILE':
      return drawReducer(state);
    case 'DISCARD_TILE':
    case 'DISCARDED_TILE':
      return discardReducer(state, action);
    case 'PASS_REACTION':
      return submitReactionReducer(state, action.playerIndex, 'pass');
    case 'SUBMIT_REACTION':
      return submitReactionReducer(state, action.playerIndex, action.responseType);
    case 'RESOLVE_REACTION_WINDOW':
      return resolveReactionWindowReducer(state);
    case 'DECLARE_AN_GANG':
      return declareAnGangReducer(state, action);
    case 'DECLARE_BU_GANG':
      return declareBuGangReducer(state, action);
    case 'DECLARE_SELF_DRAW_HU':
      return declareSelfDrawHuReducer(state, action);
    case 'SUBMIT_DI_HU_DECISION':
      return submitDiHuDecisionReducer(state, action);
    case 'PENG':
    case 'GANG':
    case 'HU':
      return reactionReducer(state);
    default:
      return state;
  }
}

export function getAvailableDiHuDecision(
  state: GameState,
  playerIndex: number,
): DiHuDecisionAvailability | null {
  const declarations = validDiHuDeclarationState(state);
  if (
    !declarations ||
    declarations.status !== 'collecting' ||
    state.phase !== 'playing' ||
    state.turnStage !== 'waiting-for-di-hu-decision' ||
    state.currentPlayerIndex !== state.dealerIndex ||
    declarations.pendingPlayerIndices[0] !== playerIndex ||
    state.pendingAction.type !== 'di-hu-decision' ||
    state.pendingAction.playerIndex !== playerIndex ||
    state.pendingAction.seat !== state.players[playerIndex]?.seat
  ) {
    return null;
  }
  return { playerIndex, decisions: ['declare', 'pass'] };
}

export function submitDiHuDecisionReducer(
  state: GameState,
  action: SubmitDiHuDecisionAction,
): GameState {
  if (
    Object.keys(action).length !== 3 ||
    !Number.isInteger(action.playerIndex) ||
    (action.decision !== 'declare' && action.decision !== 'pass') ||
    !getAvailableDiHuDecision(state, action.playerIndex)
  ) {
    return state;
  }
  const current = validDiHuDeclarationState(state);
  const player = state.players[action.playerIndex];
  if (!current || current.status !== 'collecting' || !player) return state;
  const waits = getWinningTileFaces({ concealedTiles: player.hand, melds: player.melds });
  if (!waits?.length) return state;
  const declarations =
    action.decision === 'declare'
      ? [...current.declarations, { playerIndex: action.playerIndex, winningTileFaces: waits }]
      : [...current.declarations];
  const pendingPlayerIndices = current.pendingPlayerIndices.slice(1);
  const nextPlayerIndex = pendingPlayerIndices[0];
  return {
    ...copyGameState(state),
    currentPlayerIndex: state.dealerIndex,
    turnStage: nextPlayerIndex === undefined ? 'waiting-for-discard' : 'waiting-for-di-hu-decision',
    pendingAction:
      nextPlayerIndex === undefined
        ? createPendingAction(state.players, state.dealerIndex, 'discard')
        : createPendingAction(state.players, nextPlayerIndex, 'di-hu-decision'),
    diHuDeclarations:
      nextPlayerIndex === undefined
        ? { status: 'closed', declarations }
        : { status: 'collecting', pendingPlayerIndices, declarations },
    pendingScoringEvents: state.pendingScoringEvents,
    ...(state.selfDrawProvenance === undefined
      ? {}
      : { selfDrawProvenance: state.selfDrawProvenance }),
  };
}

export interface AvailableBuGang {
  readonly targetMeldId: string;
  readonly tileFace: OrdinaryTileFace;
}

export type SelfDrawHuAvailability = {
  readonly playerIndex: number;
  readonly winningTile: OrdinaryHandTile;
  readonly evaluation: HuEvaluation;
  readonly threeMouthResolution?: ThreeMouthHuResolution;
} & (
  | { readonly drawSource: Exclude<SelfDrawSource, 'flower-replacement'> }
  | {
      readonly drawSource: 'flower-replacement';
      readonly formedFlowerKongDuringReplacement: boolean;
    }
);

type ValidSelfDrawHuCandidate = SelfDrawHuAvailability & {
  readonly concealedTiles: readonly OrdinaryHandTile[];
};

export function getAvailableSelfDrawHu(
  state: GameState,
  playerIndex: number,
): SelfDrawHuAvailability | null {
  if (validGangPackageState(state) === null) return null;
  const candidate = validSelfDrawHuCandidate(state, playerIndex);
  if (!candidate) return null;
  return candidate.drawSource === 'flower-replacement'
    ? {
        playerIndex: candidate.playerIndex,
        winningTile: candidate.winningTile,
        evaluation: candidate.evaluation,
        drawSource: candidate.drawSource,
        formedFlowerKongDuringReplacement: candidate.formedFlowerKongDuringReplacement,
        ...(candidate.threeMouthResolution
          ? { threeMouthResolution: candidate.threeMouthResolution }
          : {}),
      }
    : {
        playerIndex: candidate.playerIndex,
        winningTile: candidate.winningTile,
        evaluation: candidate.evaluation,
        drawSource: candidate.drawSource,
        ...(candidate.threeMouthResolution
          ? { threeMouthResolution: candidate.threeMouthResolution }
          : {}),
      };
}

export function declareSelfDrawHuReducer(
  state: GameState,
  action: DeclareSelfDrawHuAction,
): GameState {
  const candidate = validSelfDrawHuCandidate(state, action.playerIndex);
  if (!candidate) return state;
  const gangPackage = validGangPackageState(state);
  if (!gangPackage) return state;
  const ruleSet = getRuleSet(state.ruleSetId);
  const sourceDetails =
    candidate.drawSource === 'flower-replacement'
      ? {
          drawSource: candidate.drawSource,
          formedFlowerKongDuringReplacement: candidate.formedFlowerKongDuringReplacement,
        }
      : { drawSource: candidate.drawSource };
  const forcedResolution = candidate.threeMouthResolution
    ? ruleSet.getThreeMouthForcedHuResolution({
        source: 'self-draw',
        winnerPlayerIndex: action.playerIndex,
        payerPlayerIndex: candidate.threeMouthResolution.payerPlayerIndex,
        playerCount: state.players.length,
        winningTile: candidate.winningTile,
        concealedTiles: candidate.concealedTiles,
        melds: state.players[action.playerIndex]!.melds,
        flowers: state.players[action.playerIndex]!.flowers,
        allMelds: state.players.flatMap((player) => player.melds),
        dealerIndex: state.dealerIndex,
        diHuDeclaration: diHuDeclarationFor(state, action.playerIndex) ?? undefined,
        trigger: candidate.threeMouthResolution.triggerSource,
        forcedBasePattern: candidate.threeMouthResolution.forcedBasePattern,
        ...sourceDetails,
      })
    : null;
  if (
    candidate.threeMouthResolution &&
    (!forcedResolution ||
      !sameThreeMouthResolution(
        forcedResolution.threeMouthResolution,
        candidate.threeMouthResolution,
      ) ||
      !sameHuEvaluation(forcedResolution.evaluation, candidate.evaluation))
  )
    return state;
  const baseTransfers =
    forcedResolution?.transfers ??
    ruleSet.getHuScoreTransfers({
      source: 'self-draw',
      winnerPlayerIndex: action.playerIndex,
      playerCount: state.players.length,
      evaluation: candidate.evaluation,
      ...sourceDetails,
    });
  if (
    candidate.threeMouthResolution
      ? !isValidThreeMouthTransfers(
          baseTransfers,
          candidate.threeMouthResolution.payerPlayerIndex,
          action.playerIndex,
          state.players.length,
        )
      : !isValidBaseSelfDrawTransfers(baseTransfers, action.playerIndex, state.players.length)
  ) {
    return state;
  }
  const transfers = candidate.threeMouthResolution
    ? isValidThreeMouthTransfers(
        baseTransfers,
        candidate.threeMouthResolution.payerPlayerIndex,
        action.playerIndex,
        state.players.length,
      )
      ? baseTransfers.map((transfer) => ({ ...transfer }))
      : null
    : redirectTransfersForGangPackage(baseTransfers, gangPackage, state.players.length);
  if (!transfers) return state;
  const isPackageSettlement = !!candidate.threeMouthResolution || gangPackage.status === 'active';
  const winner = {
    playerIndex: action.playerIndex,
    evaluation: candidate.evaluation,
    ...(candidate.threeMouthResolution
      ? { threeMouthResolution: candidate.threeMouthResolution }
      : {}),
  };
  const nextState: GameState = {
    ...copyGameState(state),
    phase: 'ended',
    turnStage: 'hand-ended',
    pendingAction: createNoPendingAction(),
    selfDrawProvenance: undefined,
    gangPackage: { status: 'none' },
    pendingScoringEvents: [
      ...state.pendingScoringEvents,
      {
        type: 'hu-resolved',
        source: 'self-draw',
        winnerPlayerIndex: action.playerIndex,
        ...(candidate.threeMouthResolution
          ? { payerPlayerIndex: candidate.threeMouthResolution.payerPlayerIndex }
          : {}),
        winningTile: candidate.winningTile,
        evaluation: candidate.evaluation,
        transfers,
        status: 'pending',
        ...(candidate.threeMouthResolution
          ? { threeMouthResolution: candidate.threeMouthResolution }
          : {}),
        ...sourceDetails,
      },
    ],
    handProgressFacts: {
      ...state.handProgressFacts,
      selfDrawCount: state.handProgressFacts.selfDrawCount + 1,
      gangKaiCount:
        state.handProgressFacts.gangKaiCount +
        (candidate.evaluation.patterns.includes('gang-kai') ? 1 : 0),
      packageSettlementCount:
        state.handProgressFacts.packageSettlementCount + (isPackageSettlement ? 1 : 0),
    },
    specialDiscardTracking: {
      ...state.specialDiscardTracking,
      followDiscard: null,
    },
    result: {
      type: 'win',
      source: 'self-draw',
      winningTile: candidate.winningTile,
      winner,
      ...(candidate.threeMouthResolution
        ? { payerPlayerIndex: candidate.threeMouthResolution.payerPlayerIndex }
        : {}),
      ...sourceDetails,
    },
  };
  return nextState;
}

export function getAvailableBuGangs(state: GameState, playerIndex: number): AvailableBuGang[] {
  if (validGangPackageState(state) === null) return [];
  if (state.diHuDeclarations !== undefined && !validDiHuDeclarationState(state)) return [];
  if (diHuDeclarationFor(state, playerIndex)) return [];
  return findBuGangCandidates(state, playerIndex).map((candidate) => ({
    targetMeldId: candidate.meld.id,
    tileFace: ordinaryTileFace(candidate.tile),
  }));
}

export function getAvailableAnGangs(state: GameState, playerIndex: number): OrdinaryTileFace[] {
  const threeMouthState = validThreeMouthState(state);
  if (!threeMouthState || threeMouthState[playerIndex]?.status === 'active') return [];
  if (validGangPackageState(state) === null) return [];
  if (state.diHuDeclarations !== undefined && !validDiHuDeclarationState(state)) return [];
  if (!isAnGangTurn(state, playerIndex)) return [];
  const player = state.players[playerIndex];
  if (!player || !Array.isArray(player.hand) || !player.hand.every(isValidOrdinaryTile)) return [];
  const declaration = diHuDeclarationFor(state, playerIndex);

  const faces: OrdinaryTileFace[] = [];
  for (const tile of player.hand) {
    const tileFace = ordinaryTileFace(tile);
    if (faces.some((candidate) => isSameOrdinaryTileFaceValue(candidate, tileFace))) continue;
    const candidates = matchingAnGangTiles(player.hand, tileFace);
    if (
      candidates.length >= 4 &&
      new Set(candidates.map((candidate) => candidate.id)).size === candidates.length &&
      (!declaration || preservesDiHuWaitAfterAnGang(player, candidates.slice(0, 4), declaration))
    ) {
      faces.push(tileFace);
    }
  }

  return faces.sort(compareOrdinaryTileFaces).map((tileFace) => ({ ...tileFace }));
}

export function declareAnGangReducer(state: GameState, action: DeclareAnGangAction): GameState {
  const threeMouthState = validThreeMouthState(state);
  if (!threeMouthState) return state;
  if (
    !Number.isInteger(state.nextMeldSequence) ||
    state.nextMeldSequence <= 0 ||
    !isValidOrdinaryTileFace(action.tileFace) ||
    !getAvailableAnGangs(state, action.playerIndex).some((tileFace) =>
      isSameOrdinaryTileFaceValue(tileFace, action.tileFace),
    )
  ) {
    return state;
  }

  const player = state.players[action.playerIndex];
  if (!player) return state;
  const candidates = matchingAnGangTiles(player.hand, action.tileFace).sort(compareTilesById);
  if (new Set(candidates.map((tile) => tile.id)).size !== candidates.length) return state;
  const selectedTiles = candidates.slice(0, 4);
  if (selectedTiles.length !== 4) return state;

  const tailDraw = drawTileFromWallTail(createTileWall(state.wall));
  if (tailDraw.status === 'wall-exhausted') return state;
  const selectedIds = new Set(selectedTiles.map((tile) => tile.id));
  const drawResolution = resolveDrawnTileWithFlowerReplacement(
    player.hand.filter((tile) => !selectedIds.has(tile.id)),
    player.flowers,
    tailDraw.tile,
    tailDraw.wall,
  );
  const meldId = `meld-${state.nextMeldSequence}`;
  const baseTransfers = getRuleSet(state.ruleSetId).getAnGangScoreTransfers({
    playerIndex: action.playerIndex,
    playerCount: state.players.length,
    meldId,
  });
  if (
    !isValidOtherPlayersTransferTopology(baseTransfers, action.playerIndex, state.players.length)
  ) {
    return state;
  }
  const transfers = redirectTransfersForGangPackage(
    baseTransfers,
    state.gangPackage,
    state.players.length,
  );
  if (!transfers) return state;
  const scoringEvents: PendingScoringEvent[] = [
    ...state.pendingScoringEvents,
    {
      type: 'an-gang-created',
      playerIndex: action.playerIndex,
      meldId,
      transfers,
      status: 'pending',
    },
  ];
  const players = state.players.map((candidate, index) =>
    index === action.playerIndex
      ? addBuGangDrawProvenance(
          {
            ...candidate,
            hand: [...drawResolution.hand],
            flowers: [...drawResolution.flowers],
            melds: [
              ...candidate.melds,
              { id: meldId, type: 'an-gang' as const, tiles: [...selectedTiles] },
            ],
            buGangDrawProvenance: candidate.buGangDrawProvenance.filter(
              (provenance) => !selectedIds.has(provenance.tileId),
            ),
          },
          newlyDrawnOrdinaryTile(tailDraw.tile, drawResolution),
        )
      : candidate,
  );
  const pendingScoringEvents = appendRuntimeFlowerKongEvents(
    state.ruleSetId,
    state.gangPackage,
    scoringEvents,
    player,
    action.playerIndex,
    player.flowers,
    drawResolution.newlyRevealedFlowers,
    drawResolution.status === 'wall-exhausted',
  );
  if (!pendingScoringEvents) return state;
  const nextState: GameState = {
    ...state,
    nextMeldSequence: state.nextMeldSequence + 1,
    players,
    wall: [...drawResolution.wall.tiles],
    currentPlayerIndex: action.playerIndex,
    turnStage: 'waiting-for-discard',
    pendingAction: createPendingAction(players, action.playerIndex, 'discard'),
    pendingScoringEvents,
    selfDrawProvenance: selfDrawProvenanceFromResolution(
      action.playerIndex,
      tailDraw.tile,
      drawResolution,
      'an-gang-tail',
      scoringEvents,
      pendingScoringEvents,
    ),
    handProgressFacts: addFlowerKongFacts(
      {
        ...state.handProgressFacts,
        successfulAnGangCount: state.handProgressFacts.successfulAnGangCount + 1,
      },
      scoringEvents,
      pendingScoringEvents,
    ),
    threeMouthState: advanceThreeMouthForAnGang(threeMouthState, action.playerIndex),
  };

  return drawResolution.status === 'wall-exhausted' ? markHandEnded(nextState) : nextState;
}

export function declareBuGangReducer(state: GameState, action: DeclareBuGangAction): GameState {
  if (
    (state.diHuDeclarations !== undefined && !validDiHuDeclarationState(state)) ||
    diHuDeclarationFor(state, action.playerIndex)
  ) {
    return state;
  }
  if (
    !Number.isInteger(action.playerIndex) ||
    typeof action.meldId !== 'string' ||
    action.meldId.length === 0
  ) {
    return state;
  }
  const candidate = findBuGangCandidates(state, action.playerIndex).find(
    (value) => value.meld.id === action.meldId,
  );
  const declarer = state.players[action.playerIndex];
  if (!candidate || !declarer) return state;

  const responderOrder = createResponderOrder(state.players, action.playerIndex);
  const windowShell: BuGangReactionWindow = {
    source: 'bu-gang',
    intent: {
      declarerPlayerIndex: action.playerIndex,
      declarerSeat: declarer.seat,
      targetMeldId: candidate.meld.id,
      tile: candidate.tile,
    },
    responderOrder,
    availableReactions: [],
    responses: [],
    status: 'open',
  };
  const firstResponder = responderOrder[0];
  if (!firstResponder) return state;
  const stateForAvailability: GameState = {
    ...copyGameState(state),
    currentPlayerIndex: action.playerIndex,
    turnStage: 'waiting-for-reaction',
    pendingAction: createPendingAction(state.players, firstResponder.playerIndex, 'reaction'),
    reactionWindow: windowShell,
    selfDrawProvenance: undefined,
  };
  return {
    ...stateForAvailability,
    reactionWindow: {
      ...windowShell,
      availableReactions: responderOrder.map(({ playerIndex, seat }) => {
        const responder = state.players[playerIndex];
        if (!responder) throw new Error(`Invalid reaction responder index ${playerIndex}`);
        return getRuleSet(state.ruleSetId).getAvailableReactions({
          source: 'bu-gang',
          playerCount: state.players.length,
          responderPlayerIndex: playerIndex,
          responderSeat: seat,
          responderConcealedTiles: responder.hand,
          responderMelds: responder.melds,
          responderFlowers: responder.flowers,
          responderPassHu: responder.passHu,
          allMelds: state.players.flatMap((player) => player.melds),
          dealerIndex: state.dealerIndex,
          responderDiHuDeclaration: diHuDeclarationFor(state, playerIndex) ?? undefined,
          declarerPlayerIndex: action.playerIndex,
          targetTile: candidate.tile,
        });
      }),
    },
  };
}

export function drawReducer(state: GameState): GameState {
  if (state.diHuDeclarations !== undefined && !validDiHuDeclarationState(state)) return state;
  if (state.phase !== 'playing' || state.turnStage !== 'waiting-for-draw') {
    return state;
  }

  const currentPlayer = state.players[state.currentPlayerIndex];

  if (!currentPlayer) {
    throw new Error(`Invalid current player index ${state.currentPlayerIndex}`);
  }

  const headDraw = drawTileFromWallHead(createTileWall(state.wall));

  if (headDraw.status === 'wall-exhausted') {
    return markHandEnded({
      ...copyGameState(state),
      wall: [...headDraw.wall.tiles],
    });
  }

  const drawResolution = resolveDrawnTileWithFlowerReplacement(
    currentPlayer.hand,
    currentPlayer.flowers,
    headDraw.tile,
    headDraw.wall,
  );
  const players = copyPlayers(state.players);
  const copiedPlayer = players[state.currentPlayerIndex];

  if (!copiedPlayer) {
    throw new Error(`Invalid current player index ${state.currentPlayerIndex}`);
  }

  players[state.currentPlayerIndex] = {
    ...copiedPlayer,
    hand: [...drawResolution.hand],
    flowers: [...drawResolution.flowers],
  };
  players[state.currentPlayerIndex] = addBuGangDrawProvenance(
    players[state.currentPlayerIndex]!,
    newlyDrawnOrdinaryTile(headDraw.tile, drawResolution),
  );

  const pendingScoringEvents = appendRuntimeFlowerKongEvents(
    state.ruleSetId,
    state.gangPackage,
    state.pendingScoringEvents ?? [],
    currentPlayer,
    state.currentPlayerIndex,
    currentPlayer.flowers,
    drawResolution.newlyRevealedFlowers,
    drawResolution.status === 'wall-exhausted',
  );
  if (!pendingScoringEvents) return state;

  const nextState: GameState = {
    nextMeldSequence: state.nextMeldSequence,
    ruleSetId: state.ruleSetId,
    players,
    wall: [...drawResolution.wall.tiles],
    currentPlayerIndex: state.currentPlayerIndex,
    dealerIndex: state.dealerIndex,
    phase: state.phase,
    turnStage: 'waiting-for-discard',
    pendingAction: createPendingAction(players, state.currentPlayerIndex, 'discard'),
    pendingScoringEvents,
    selfDrawProvenance: selfDrawProvenanceFromResolution(
      state.currentPlayerIndex,
      headDraw.tile,
      drawResolution,
      'wall-head',
      state.pendingScoringEvents,
      pendingScoringEvents,
    ),
    handProgressFacts: addFlowerKongFacts(
      state.handProgressFacts,
      state.pendingScoringEvents,
      pendingScoringEvents,
    ),
    specialDiscardTracking: state.specialDiscardTracking,
    gangPackage: state.gangPackage,
    threeMouthState: state.threeMouthState,
    ...(state.diHuDeclarations === undefined
      ? {}
      : { diHuDeclarations: copyDiHuDeclarationState(state.diHuDeclarations) }),
  };

  return drawResolution.status === 'wall-exhausted' ? markHandEnded(nextState) : nextState;
}

export function discardReducer(state: GameState, action: DiscardAction): GameState {
  const threeMouthState = validThreeMouthState(state);
  if (!threeMouthState) return state;
  if (state.phase !== 'playing' || state.turnStage !== 'waiting-for-discard') {
    return state;
  }

  const currentPlayer = state.players[state.currentPlayerIndex];

  if (!currentPlayer) {
    throw new Error(`Invalid current player index ${state.currentPlayerIndex}`);
  }

  if (state.diHuDeclarations !== undefined && !validDiHuDeclarationState(state)) return state;
  const diHuDeclaration = diHuDeclarationFor(state, state.currentPlayerIndex);
  if (
    diHuDeclaration &&
    (state.selfDrawProvenance?.playerIndex !== state.currentPlayerIndex ||
      state.selfDrawProvenance.tileId !== action.tileId)
  ) {
    return state;
  }

  if (
    !isValidSpecialDiscardTracking(state.specialDiscardTracking, state.players.length) ||
    !isNonNegativeInteger(state.handProgressFacts.followDiscardPenaltyCount) ||
    !isNonNegativeInteger(state.handProgressFacts.fourIdenticalDiscardsPenaltyCount) ||
    !isNonNegativeInteger(state.handProgressFacts.fourWindsGatheredCount) ||
    !hasValidDiscardRecords(currentPlayer)
  ) {
    return state;
  }

  const discardedTileIndex = currentPlayer.hand.findIndex((tile) => tile.id === action.tileId);

  if (discardedTileIndex === -1) {
    return state;
  }

  const discardedTile = currentPlayer.hand[discardedTileIndex];

  if (!discardedTile) {
    throw new Error(`Current player ${currentPlayer.id} cannot discard tile ${action.tileId}`);
  }

  const players = copyPlayers(state.players);
  const copiedPlayer = players[state.currentPlayerIndex];

  if (!copiedPlayer) {
    throw new Error(`Invalid current player index ${state.currentPlayerIndex}`);
  }

  players[state.currentPlayerIndex] = {
    ...copiedPlayer,
    passHu: false,
    hand: [
      ...copiedPlayer.hand.slice(0, discardedTileIndex),
      ...copiedPlayer.hand.slice(discardedTileIndex + 1),
    ],
    discardPile: [...copiedPlayer.discardPile, { tile: discardedTile }],
    buGangDrawProvenance: copiedPlayer.buGangDrawProvenance.filter(
      (provenance) => provenance.tileId !== discardedTile.id,
    ),
  };

  const specialDiscardUpdate = updateSpecialDiscardRules(
    state,
    players,
    state.currentPlayerIndex,
    discardedTile,
  );
  if (!specialDiscardUpdate) return state;

  const reactionWindowShell = createReactionWindow(
    players,
    state.currentPlayerIndex,
    discardedTile,
  );
  const firstResponder = reactionWindowShell.responderOrder[0];

  if (!firstResponder) {
    throw new Error('Reaction window must have at least one responder');
  }

  const pendingAction = createPendingAction(players, firstResponder.playerIndex, 'reaction');
  const lastDiscard = {
    tile: discardedTile,
    tileId: discardedTile.id,
    fromPlayerIndex: state.currentPlayerIndex,
    fromSeat: copiedPlayer.seat,
  };
  const reactionWindow: ReactionWindow = {
    ...reactionWindowShell,
    availableReactions: reactionWindowShell.responderOrder.map(({ playerIndex, seat }) => {
      const responder = players[playerIndex];
      if (!responder) throw new Error(`Invalid reaction responder index ${playerIndex}`);
      return withActiveThreeMouthSpecialDiscardHu(
        getRuleSet(state.ruleSetId).getAvailableReactions({
          source: 'discard',
          playerCount: players.length,
          responderPlayerIndex: playerIndex,
          responderSeat: seat,
          responderConcealedTiles: responder.hand,
          responderMelds: responder.melds,
          responderFlowers: responder.flowers,
          responderPassHu: responder.passHu,
          allMelds: players.flatMap((player) => player.melds),
          dealerIndex: state.dealerIndex,
          responderDiHuDeclaration: diHuDeclarationFor(state, playerIndex) ?? undefined,
          fromPlayerIndex: state.currentPlayerIndex,
          discardedTile,
          canDrawFromWallTail: state.wall.length > 0,
        }),
        threeMouthState[playerIndex],
        responder,
        discardedTile,
      );
    }),
  };

  return {
    nextMeldSequence: state.nextMeldSequence,
    ruleSetId: state.ruleSetId,
    players,
    wall: [...state.wall],
    currentPlayerIndex: firstResponder.playerIndex,
    dealerIndex: state.dealerIndex,
    phase: state.phase,
    turnStage: 'waiting-for-reaction',
    pendingAction,
    lastDiscard,
    reactionWindow,
    pendingScoringEvents: [...(state.pendingScoringEvents ?? []), ...specialDiscardUpdate.events],
    handProgressFacts: specialDiscardUpdate.handProgressFacts,
    specialDiscardTracking: specialDiscardUpdate.tracking,
    gangPackage:
      state.gangPackage.status === 'active' &&
      state.gangPackage.beneficiaryPlayerIndex === state.currentPlayerIndex
        ? { status: 'none' }
        : state.gangPackage,
    threeMouthState,
    ...(state.diHuDeclarations === undefined
      ? {}
      : { diHuDeclarations: copyDiHuDeclarationState(state.diHuDeclarations) }),
    selfDrawProvenance: undefined,
  };
}

export function passReactionReducer(state: GameState, playerIndex: number): GameState {
  return submitReactionReducer(state, playerIndex, 'pass');
}

export function submitReactionReducer(
  state: GameState,
  playerIndex: number,
  responseType: ReactionResponseType,
): GameState {
  const threeMouthState = validThreeMouthState(state);
  if (!threeMouthState) return state;
  if (state.diHuDeclarations !== undefined && !validDiHuDeclarationState(state)) return state;
  if (
    state.reactionWindow &&
    state.reactionWindow.source !== 'discard' &&
    state.reactionWindow.source !== 'bu-gang'
  ) {
    return state;
  }
  if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex >= state.players.length) {
    return state;
  }

  const currentResponder =
    state.reactionWindow?.responderOrder[state.reactionWindow.responses.length];

  if (
    state.phase !== 'playing' ||
    state.turnStage !== 'waiting-for-reaction' ||
    state.reactionWindow?.status !== 'open' ||
    state.pendingAction.type !== 'reaction' ||
    state.pendingAction.playerIndex !== playerIndex ||
    currentResponder?.playerIndex !== playerIndex ||
    (state.reactionWindow.source === 'discard' && state.currentPlayerIndex !== playerIndex) ||
    (state.reactionWindow.source === 'bu-gang' &&
      state.currentPlayerIndex !== state.reactionWindow.intent.declarerPlayerIndex)
  ) {
    return state;
  }

  const availability = state.reactionWindow.availableReactions.find(
    (candidate) => candidate.playerIndex === playerIndex,
  );

  if (
    !availability?.responseTypes.includes(responseType) ||
    (threeMouthState[playerIndex]?.status === 'active' &&
      (responseType === 'peng' || responseType === 'ming-gang')) ||
    (responseType === 'ming-gang' && state.wall.length === 0)
  ) {
    return state;
  }

  const response: ReactionResponse = {
    playerIndex: currentResponder.playerIndex,
    seat: currentResponder.seat,
    type: responseType,
  };
  const players =
    state.reactionWindow.source === 'discard' &&
    responseType !== 'hu' &&
    availability.responseTypes.includes('hu')
      ? state.players.map((player, index) =>
          index === playerIndex ? { ...player, passHu: true } : player,
        )
      : state.players;
  const responses = [...state.reactionWindow.responses, response];
  const nextResponder = state.reactionWindow.responderOrder[responses.length];
  const reactionWindow: ReactionWindow = {
    ...state.reactionWindow,
    responses,
    status: nextResponder ? 'open' : 'awaiting-resolution',
  };

  if (nextResponder) {
    return {
      ...copyGameState(state),
      players: copyPlayers(players),
      currentPlayerIndex:
        reactionWindow.source === 'discard'
          ? nextResponder.playerIndex
          : reactionWindow.intent.declarerPlayerIndex,
      turnStage: 'waiting-for-reaction',
      pendingAction: createPendingAction(state.players, nextResponder.playerIndex, 'reaction'),
      reactionWindow,
    };
  }

  const nextState: GameState = {
    ...copyGameState(state),
    players: copyPlayers(players),
    currentPlayerIndex:
      reactionWindow.source === 'discard'
        ? currentResponder.playerIndex
        : reactionWindow.intent.declarerPlayerIndex,
    turnStage: 'waiting-for-reaction',
    pendingAction: createNoPendingAction(),
    reactionWindow,
  };
  return nextState;
}

export function resolveReactionWindowReducer(state: GameState): GameState {
  if (state.diHuDeclarations !== undefined && !validDiHuDeclarationState(state)) return state;
  const window = state.reactionWindow;

  if (window && window.source !== 'discard' && window.source !== 'bu-gang') return state;

  if (
    state.phase !== 'playing' ||
    state.turnStage !== 'waiting-for-reaction' ||
    window?.status !== 'awaiting-resolution' ||
    state.pendingAction.type !== 'none' ||
    window.responses.length !== window.responderOrder.length ||
    window.responderOrder.some(
      (responder) =>
        window.responses.filter((response) => response.playerIndex === responder.playerIndex)
          .length !== 1,
    )
  ) {
    return state;
  }

  if (
    window.source === 'bu-gang' &&
    diHuDeclarationFor(state, window.intent.declarerPlayerIndex) !== null
  ) {
    return cancelStaleBuGangIntent(state, window);
  }

  const nonPassResponses = window.responses.filter(
    (response) =>
      response.type !== 'pass' &&
      !(window.source === 'discard' && response.type === 'ming-gang' && state.wall.length === 0),
  );
  const huResponses = nonPassResponses.filter((response) => response.type === 'hu');

  if (huResponses.length > 0) {
    if (
      state.gangPackage.status === 'active' &&
      (window.source === 'bu-gang' ||
        !huResponses.some((response) =>
          getThreeMouthDiscardResolution(state, window, response.playerIndex),
        ))
    ) {
      return window.source === 'bu-gang'
        ? cancelStaleBuGangIntent(state, window)
        : closeDiscardReactionWithoutClaim(state, window);
    }
    return resolveHu(state, window, huResponses);
  }

  if (window.source === 'bu-gang') {
    return nonPassResponses.length === 0 ? finalizeBuGang(state, window) : state;
  }

  if (nonPassResponses.length === 1 && nonPassResponses[0]?.type === 'peng') {
    return resolvePeng(state, window, nonPassResponses[0]);
  }

  if (nonPassResponses.length === 1 && nonPassResponses[0]?.type === 'ming-gang') {
    return resolveMingGang(state, window, nonPassResponses[0]);
  }

  if (nonPassResponses.length !== 0) {
    return state;
  }

  return closeDiscardReactionWithoutClaim(state, window);
}

function resolveMingGang(
  state: GameState,
  window: DiscardReactionWindow,
  response: ReactionResponse,
): GameState {
  const threeMouthState = validThreeMouthState(state);
  if (!threeMouthState || threeMouthState[response.playerIndex]?.status === 'active') return state;
  const playerIndex = response.playerIndex;
  const player = state.players[playerIndex];
  const discarder = state.players[window.fromPlayerIndex];
  const discardedTile = window.discardedTile;
  const lastDiscard = state.lastDiscard;
  const latestDiscard = discarder?.discardPile.at(-1);
  const currentAvailability =
    player && isOrdinaryHandTile(discardedTile)
      ? withoutActiveThreeMouthClaims(
          getRuleSet(state.ruleSetId).getAvailableReactions({
            source: 'discard',
            playerCount: state.players.length,
            responderPlayerIndex: playerIndex,
            responderSeat: player.seat,
            responderConcealedTiles: player.hand,
            responderMelds: player.melds,
            responderFlowers: player.flowers,
            responderPassHu: player.passHu,
            allMelds: state.players.flatMap((candidate) => candidate.melds),
            dealerIndex: state.dealerIndex,
            responderDiHuDeclaration: diHuDeclarationFor(state, playerIndex) ?? undefined,
            fromPlayerIndex: window.fromPlayerIndex,
            discardedTile,
            canDrawFromWallTail: state.wall.length > 0,
          }),
          threeMouthState[playerIndex],
        )
      : null;

  if (
    !Number.isInteger(playerIndex) ||
    playerIndex < 0 ||
    playerIndex >= state.players.length ||
    !player ||
    response.seat !== player.seat ||
    !discarder ||
    window.fromPlayerIndex === playerIndex ||
    window.fromSeat !== discarder.seat ||
    !isOrdinaryHandTile(discardedTile) ||
    !currentAvailability?.responseTypes.includes('ming-gang') ||
    !window.availableReactions.some(
      (availability) =>
        availability.playerIndex === playerIndex &&
        availability.seat === player.seat &&
        availability.responseTypes.includes('ming-gang'),
    ) ||
    !lastDiscard ||
    lastDiscard.tile.id !== discardedTile.id ||
    lastDiscard.tileId !== discardedTile.id ||
    lastDiscard.fromPlayerIndex !== window.fromPlayerIndex ||
    lastDiscard.fromSeat !== window.fromSeat ||
    !latestDiscard ||
    latestDiscard.tile.id !== discardedTile.id ||
    latestDiscard.claimedByMeldId !== undefined ||
    !Number.isInteger(state.nextMeldSequence) ||
    state.nextMeldSequence <= 0 ||
    state.wall.length === 0
  ) {
    return state;
  }

  const selectedTiles = player.hand
    .filter((tile) => isSameOrdinaryTileFace(tile, discardedTile))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .slice(0, 3);

  if (selectedTiles.length !== 3) {
    return state;
  }

  const selectedIds = new Set(selectedTiles.map((tile) => tile.id));

  if (selectedIds.size !== 3 || selectedIds.has(discardedTile.id)) {
    return state;
  }

  const tailDraw = drawTileFromWallTail(createTileWall(state.wall));

  if (tailDraw.status === 'wall-exhausted') {
    return state;
  }

  const drawResolution = resolveDrawnTileWithFlowerReplacement(
    player.hand.filter((tile) => !selectedIds.has(tile.id)),
    player.flowers,
    tailDraw.tile,
    tailDraw.wall,
  );
  const meldId = `meld-${state.nextMeldSequence}`;
  const meld = {
    id: meldId,
    type: 'ming-gang' as const,
    tiles: [...selectedTiles, discardedTile],
    claimedTileId: discardedTile.id,
    fromPlayerIndex: window.fromPlayerIndex,
  };
  const players = state.players.map((candidate, index) => {
    if (index === playerIndex) {
      return addBuGangDrawProvenance(
        {
          ...candidate,
          hand: [...drawResolution.hand],
          flowers: [...drawResolution.flowers],
          melds: [...candidate.melds, meld],
          buGangDrawProvenance: candidate.buGangDrawProvenance.filter(
            (provenance) => !selectedIds.has(provenance.tileId),
          ),
        },
        newlyDrawnOrdinaryTile(tailDraw.tile, drawResolution),
      );
    }

    if (index === window.fromPlayerIndex) {
      return {
        ...candidate,
        discardPile: candidate.discardPile.map((record, recordIndex) =>
          recordIndex === candidate.discardPile.length - 1
            ? { ...record, claimedByMeldId: meldId }
            : record,
        ),
      };
    }

    return candidate;
  });
  const gangPackage: GangPackageState =
    state.gangPackage.status === 'none'
      ? {
          status: 'active',
          payerPlayerIndex: window.fromPlayerIndex,
          beneficiaryPlayerIndex: playerIndex,
          source: 'ming-gang',
          establishedByMeldId: meldId,
        }
      : state.gangPackage;
  const baseTransfers = getRuleSet(state.ruleSetId).getMingGangScoreTransfers({
    receiverPlayerIndex: playerIndex,
    payerPlayerIndex: window.fromPlayerIndex,
    playerCount: state.players.length,
    meldId,
  });
  if (
    !isValidSinglePayerTransferTopology(
      baseTransfers,
      window.fromPlayerIndex,
      playerIndex,
      state.players.length,
    )
  ) {
    return closeDiscardReactionWithoutClaim(state, window);
  }
  const transfers = redirectTransfersForGangPackage(
    baseTransfers,
    gangPackage,
    state.players.length,
  );
  if (!transfers) return closeDiscardReactionWithoutClaim(state, window);
  const scoringEvents: PendingScoringEvent[] = [
    ...state.pendingScoringEvents,
    {
      type: 'ming-gang-created',
      receiverPlayerIndex: playerIndex,
      payerPlayerIndex: window.fromPlayerIndex,
      meldId,
      transfers,
      status: 'pending',
    },
  ];
  const pendingScoringEvents = appendRuntimeFlowerKongEvents(
    state.ruleSetId,
    gangPackage,
    scoringEvents,
    player,
    playerIndex,
    player.flowers,
    drawResolution.newlyRevealedFlowers,
    drawResolution.status === 'wall-exhausted',
  );
  if (!pendingScoringEvents) return closeDiscardReactionWithoutClaim(state, window);
  const nextState: GameState = {
    nextMeldSequence: state.nextMeldSequence + 1,
    ruleSetId: state.ruleSetId,
    players,
    wall: [...drawResolution.wall.tiles],
    currentPlayerIndex: playerIndex,
    dealerIndex: state.dealerIndex,
    phase: state.phase,
    turnStage: 'waiting-for-discard',
    pendingAction: createPendingAction(players, playerIndex, 'discard'),
    reactionWindow: { ...window, status: 'closed' },
    pendingScoringEvents,
    selfDrawProvenance: selfDrawProvenanceFromResolution(
      playerIndex,
      tailDraw.tile,
      drawResolution,
      'ming-gang-tail',
      scoringEvents,
      pendingScoringEvents,
    ),
    handProgressFacts: addFlowerKongFacts(
      {
        ...state.handProgressFacts,
        successfulMingOrBuGangCount: state.handProgressFacts.successfulMingOrBuGangCount + 1,
      },
      scoringEvents,
      pendingScoringEvents,
    ),
    specialDiscardTracking: trackingAfterSeatClaim(state, playerIndex),
    gangPackage,
    threeMouthState: advanceThreeMouthForExternalMouth(
      threeMouthState,
      playerIndex,
      window.fromPlayerIndex,
    ),
    ...(state.diHuDeclarations === undefined
      ? {}
      : { diHuDeclarations: copyDiHuDeclarationState(state.diHuDeclarations) }),
  };

  return drawResolution.status === 'wall-exhausted' ? markHandEnded(nextState) : nextState;
}

function resolvePeng(
  state: GameState,
  window: DiscardReactionWindow,
  response: ReactionResponse,
): GameState {
  const threeMouthState = validThreeMouthState(state);
  if (!threeMouthState || threeMouthState[response.playerIndex]?.status === 'active') return state;
  const pengPlayerIndex = response.playerIndex;
  const pengPlayer = state.players[pengPlayerIndex];
  const discarder = state.players[window.fromPlayerIndex];
  const lastDiscard = state.lastDiscard;
  const discardedTile = window.discardedTile;
  const latestDiscardRecord = discarder?.discardPile.at(-1);

  if (
    !Number.isInteger(pengPlayerIndex) ||
    pengPlayerIndex < 0 ||
    pengPlayerIndex >= state.players.length ||
    !pengPlayer ||
    response.seat !== pengPlayer.seat ||
    !discarder ||
    window.fromPlayerIndex === pengPlayerIndex ||
    window.fromSeat !== discarder.seat ||
    !isOrdinaryHandTile(discardedTile) ||
    diHuDeclarationFor(state, pengPlayerIndex) !== null ||
    !window.availableReactions.some(
      (availability) =>
        availability.playerIndex === pengPlayerIndex &&
        availability.seat === pengPlayer.seat &&
        availability.responseTypes.includes('peng'),
    ) ||
    !lastDiscard ||
    lastDiscard.tile.id !== discardedTile.id ||
    lastDiscard.tileId !== discardedTile.id ||
    lastDiscard.fromPlayerIndex !== window.fromPlayerIndex ||
    lastDiscard.fromSeat !== window.fromSeat ||
    !latestDiscardRecord ||
    latestDiscardRecord.tile.id !== discardedTile.id ||
    latestDiscardRecord.claimedByMeldId !== undefined ||
    !Number.isInteger(state.nextMeldSequence) ||
    state.nextMeldSequence <= 0
  ) {
    return state;
  }

  const matchingTiles = pengPlayer.hand
    .filter((tile) => isSameOrdinaryTileFace(tile, discardedTile))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const selectedTiles = matchingTiles.slice(0, 2);

  if (selectedTiles.length !== 2) {
    return state;
  }

  const meldId = `meld-${state.nextMeldSequence}`;
  const selectedTileIds = new Set(selectedTiles.map((tile) => tile.id));
  const meld = {
    id: meldId,
    type: 'peng' as const,
    tiles: [...selectedTiles, discardedTile],
    claimedTileId: discardedTile.id,
    fromPlayerIndex: window.fromPlayerIndex,
  };
  const players = state.players.map((player, playerIndex) => {
    if (playerIndex === pengPlayerIndex) {
      return {
        ...player,
        hand: player.hand.filter((tile) => !selectedTileIds.has(tile.id)),
        melds: [...player.melds, meld],
        buGangDrawProvenance: player.buGangDrawProvenance.filter(
          (provenance) => !selectedTileIds.has(provenance.tileId),
        ),
      };
    }

    if (playerIndex === window.fromPlayerIndex) {
      return {
        ...player,
        discardPile: player.discardPile.map((record, recordIndex) =>
          recordIndex === player.discardPile.length - 1
            ? { ...record, claimedByMeldId: meldId }
            : record,
        ),
      };
    }

    return player;
  });
  const stateWithoutLastDiscard = { ...state };
  delete stateWithoutLastDiscard.lastDiscard;

  return {
    ...stateWithoutLastDiscard,
    players,
    currentPlayerIndex: pengPlayerIndex,
    turnStage: 'waiting-for-discard',
    pendingAction: createPendingAction(players, pengPlayerIndex, 'discard'),
    reactionWindow: { ...window, status: 'closed' },
    nextMeldSequence: state.nextMeldSequence + 1,
    selfDrawProvenance: undefined,
    specialDiscardTracking: trackingAfterSeatClaim(state, pengPlayerIndex),
    threeMouthState: advanceThreeMouthForExternalMouth(
      threeMouthState,
      pengPlayerIndex,
      window.fromPlayerIndex,
    ),
  };
}

function closeDiscardReactionWithoutClaim(
  state: GameState,
  window: DiscardReactionWindow,
): GameState {
  const nextDrawPlayerIndex = nextPlayerIndex(window.fromPlayerIndex);
  const nextState: GameState = {
    ...copyGameState(state),
    currentPlayerIndex: nextDrawPlayerIndex,
    turnStage: 'waiting-for-draw',
    pendingAction: createPendingAction(state.players, nextDrawPlayerIndex, 'draw'),
    reactionWindow: { ...window, status: 'closed' },
    selfDrawProvenance: undefined,
  };
  return state.wall.length === 0 ? markHandEnded(nextState) : nextState;
}

function getThreeMouthDiscardResolution(
  state: GameState,
  window: DiscardReactionWindow,
  playerIndex: number,
) {
  const threeMouthState = validThreeMouthState(state);
  const active = threeMouthState?.[playerIndex];
  const player = state.players[playerIndex];
  const discarder = state.players[window.fromPlayerIndex];
  const lastDiscard = state.lastDiscard;
  const latestDiscard = discarder?.discardPile.at(-1);
  if (
    active?.status !== 'active' ||
    !player ||
    player.passHu ||
    !hasValidActiveThreeMouthMelds(player, active.payerPlayerIndex) ||
    !isOrdinaryHandTile(window.discardedTile) ||
    !discarder ||
    !lastDiscard ||
    lastDiscard.tileId !== window.discardedTile.id ||
    lastDiscard.fromPlayerIndex !== window.fromPlayerIndex ||
    !latestDiscard ||
    latestDiscard.tile.id !== window.discardedTile.id ||
    latestDiscard.claimedByMeldId !== undefined ||
    !hasValidHuEntities(state.players)
  )
    return null;
  const discardedTile = window.discardedTile;
  const matching = player.hand.filter((tile) => isSameOrdinaryTileFace(tile, discardedTile));
  if (
    matching.length < 2 ||
    matching.length > 3 ||
    new Set([...matching.map((tile) => tile.id), discardedTile.id]).size !== matching.length + 1
  )
    return null;
  const trigger =
    matching.length === 3 && state.wall.length > 0
      ? ('discard-ming-gang-opportunity' as const)
      : ('discard-peng-opportunity' as const);
  const forcedBasePattern =
    window.fromPlayerIndex === active.payerPlayerIndex
      ? ('global-single-wait' as const)
      : ('all-pungs' as const);
  const resolution = getRuleSet(state.ruleSetId).getThreeMouthForcedHuResolution({
    source: 'discard',
    winnerPlayerIndex: playerIndex,
    payerPlayerIndex: active.payerPlayerIndex,
    playerCount: state.players.length,
    winningTile: discardedTile,
    concealedTiles: player.hand,
    melds: player.melds,
    flowers: player.flowers,
    allMelds: state.players.flatMap((candidate) => candidate.melds),
    dealerIndex: state.dealerIndex,
    diHuDeclaration: diHuDeclarationFor(state, playerIndex) ?? undefined,
    trigger,
    forcedBasePattern,
    discarderPlayerIndex: window.fromPlayerIndex,
  });
  return resolution &&
    resolution.threeMouthResolution.triggerSource === trigger &&
    resolution.threeMouthResolution.triggerPlayerIndex === window.fromPlayerIndex &&
    resolution.threeMouthResolution.forcedBasePattern === forcedBasePattern &&
    resolution.threeMouthResolution.payerPlayerIndex === active.payerPlayerIndex &&
    resolution.threeMouthResolution.settlementMode === 'self-draw' &&
    isValidHuEvaluation(resolution.evaluation) &&
    isValidThreeMouthTransfers(
      resolution.transfers,
      active.payerPlayerIndex,
      playerIndex,
      state.players.length,
    )
    ? resolution
    : null;
}

function resolveHu(
  state: GameState,
  window: ReactionWindow,
  huResponses: readonly ReactionResponse[],
): GameState {
  const targetTile =
    window.source === 'discard'
      ? isOrdinaryHandTile(window.discardedTile)
        ? window.discardedTile
        : null
      : window.intent.tile;
  const payerPlayerIndex =
    window.source === 'discard' ? window.fromPlayerIndex : window.intent.declarerPlayerIndex;
  if (!targetTile) return state;
  const pendingIntent =
    window.source === 'bu-gang' ? validatePendingBuGangIntent(state, window) : null;
  if (window.source === 'bu-gang' && !pendingIntent) return state;

  const ruleSet = getRuleSet(state.ruleSetId);
  const winners = huResponses.map((response) => {
    const player = state.players[response.playerIndex];
    const availability = window.availableReactions.find(
      (candidate) => candidate.playerIndex === response.playerIndex,
    );
    if (!player || !availability?.responseTypes.includes('hu')) return null;
    const special =
      window.source === 'discard'
        ? getThreeMouthDiscardResolution(state, window, response.playerIndex)
        : null;
    const evaluation =
      special?.evaluation ??
      ruleSet.evaluateHu({
        source: window.source === 'discard' ? 'discard' : 'rob-bu-gang',
        winnerPlayerIndex: response.playerIndex,
        payerPlayerIndex,
        playerCount: state.players.length,
        winningTile: targetTile,
        concealedTiles: player.hand,
        melds: player.melds,
        flowers: player.flowers,
        allMelds: state.players.flatMap((candidate) => candidate.melds),
        dealerIndex: state.dealerIndex,
        diHuDeclaration: diHuDeclarationFor(state, response.playerIndex) ?? undefined,
      });
    if (!evaluation) return null;
    const transfers =
      special?.transfers ??
      ruleSet.getHuScoreTransfers({
        source: window.source === 'discard' ? 'discard' : 'rob-bu-gang',
        winnerPlayerIndex: response.playerIndex,
        payerPlayerIndex,
        playerCount: state.players.length,
        evaluation,
      });
    if (
      special &&
      !isValidThreeMouthTransfers(
        transfers,
        special.threeMouthResolution.payerPlayerIndex,
        response.playerIndex,
        state.players.length,
      )
    )
      return null;
    return {
      playerIndex: response.playerIndex,
      evaluation,
      transfers,
      ...(special ? { threeMouthResolution: special.threeMouthResolution } : {}),
    };
  });
  if (winners.some((winner) => winner === null)) return state;
  const validWinners = winners.filter((winner) => winner !== null);
  if (validWinners.length === 0) return state;

  const source: HuSource = window.source === 'discard' ? 'discard' : 'rob-bu-gang';
  const pendingScoringEvents: PendingScoringEvent[] = [
    ...state.pendingScoringEvents,
    ...validWinners.map((winner) => ({
      type: 'hu-resolved' as const,
      source,
      winnerPlayerIndex: winner.playerIndex,
      payerPlayerIndex: winner.threeMouthResolution?.payerPlayerIndex ?? payerPlayerIndex,
      winningTile: targetTile,
      evaluation: winner.evaluation,
      transfers: winner.transfers.map((transfer) => ({ ...transfer })),
      ...(winner.threeMouthResolution ? { threeMouthResolution: winner.threeMouthResolution } : {}),
      status: 'pending' as const,
    })),
  ];
  const players =
    window.source === 'bu-gang' && pendingIntent
      ? state.players.map((player, index) =>
          index === payerPlayerIndex
            ? {
                ...player,
                hand: player.hand.filter((tile) => tile.id !== pendingIntent.tile.id),
                buGangDrawProvenance: player.buGangDrawProvenance.filter(
                  (provenance) => provenance.tileId !== pendingIntent.tile.id,
                ),
              }
            : player,
        )
      : state.players;

  const specialWinnerCount = validWinners.filter(
    (winner) => winner.threeMouthResolution !== undefined,
  ).length;
  const specialPayerPlayerIndex = validWinners.find(
    (winner) => winner.threeMouthResolution !== undefined,
  )?.threeMouthResolution?.payerPlayerIndex;
  return {
    ...copyGameState(state),
    players: copyPlayers(players),
    currentPlayerIndex: payerPlayerIndex,
    phase: 'ended',
    turnStage: 'hand-ended',
    pendingAction: createNoPendingAction(),
    reactionWindow: { ...window, status: 'closed' },
    pendingScoringEvents,
    selfDrawProvenance: undefined,
    gangPackage: specialWinnerCount > 0 ? { status: 'none' } : state.gangPackage,
    handProgressFacts:
      specialWinnerCount === 0
        ? state.handProgressFacts
        : {
            ...state.handProgressFacts,
            packageSettlementCount:
              state.handProgressFacts.packageSettlementCount + specialWinnerCount,
            selfDrawCount: state.handProgressFacts.selfDrawCount + specialWinnerCount,
          },
    specialDiscardTracking: {
      ...state.specialDiscardTracking,
      followDiscard: null,
    },
    result: {
      type: 'win',
      source,
      winningTile: targetTile,
      payerPlayerIndex: specialPayerPlayerIndex ?? payerPlayerIndex,
      ...(specialPayerPlayerIndex === undefined ? {} : { triggerPlayerIndex: payerPlayerIndex }),
      winners: validWinners.map((winner) => ({
        playerIndex: winner.playerIndex,
        ...(specialWinnerCount > 0
          ? {
              payerPlayerIndex: winner.threeMouthResolution?.payerPlayerIndex ?? payerPlayerIndex,
            }
          : {}),
        evaluation: winner.evaluation,
        ...(winner.threeMouthResolution
          ? { threeMouthResolution: winner.threeMouthResolution }
          : {}),
      })),
    },
  };
}

function finalizeBuGang(state: GameState, window: BuGangReactionWindow): GameState {
  if (diHuDeclarationFor(state, window.intent.declarerPlayerIndex) !== null) {
    return cancelStaleBuGangIntent(state, window);
  }
  const pendingIntent = validatePendingBuGangIntent(state, window);
  if (!pendingIntent || state.wall.length === 0) return state;
  const { declarer, meld, tile } = pendingIntent;
  const payerPlayerIndex = meld.fromPlayerIndex;
  if (payerPlayerIndex === undefined) return state;
  const tailDraw = drawTileFromWallTail(createTileWall(state.wall));
  if (tailDraw.status === 'wall-exhausted') return state;
  const drawResolution = resolveDrawnTileWithFlowerReplacement(
    declarer.hand.filter((candidate) => candidate.id !== tile.id),
    declarer.flowers,
    tailDraw.tile,
    tailDraw.wall,
  );
  const upgradedMeld = { ...meld, type: 'bu-gang' as const, tiles: [...meld.tiles, tile] };
  const players = state.players.map((player, index) =>
    index === window.intent.declarerPlayerIndex
      ? addBuGangDrawProvenance(
          {
            ...player,
            hand: [...drawResolution.hand],
            flowers: [...drawResolution.flowers],
            melds: player.melds.map((candidate) =>
              candidate.id === meld.id ? upgradedMeld : candidate,
            ),
            buGangDrawProvenance: player.buGangDrawProvenance.filter(
              (provenance) => provenance.targetMeldId !== meld.id && provenance.tileId !== tile.id,
            ),
          },
          newlyDrawnOrdinaryTile(tailDraw.tile, drawResolution),
        )
      : player,
  );
  const gangPackage: GangPackageState =
    state.gangPackage.status === 'none'
      ? {
          status: 'active',
          payerPlayerIndex,
          beneficiaryPlayerIndex: window.intent.declarerPlayerIndex,
          source: 'bu-gang',
          establishedByMeldId: meld.id,
        }
      : state.gangPackage;
  const baseTransfers = getRuleSet(state.ruleSetId).getBuGangScoreTransfers({
    playerIndex: window.intent.declarerPlayerIndex,
    payerPlayerIndex,
    playerCount: state.players.length,
    meldId: meld.id,
  });
  if (
    !isValidSinglePayerTransferTopology(
      baseTransfers,
      payerPlayerIndex,
      window.intent.declarerPlayerIndex,
      state.players.length,
    )
  ) {
    return cancelStaleBuGangIntent(state, window);
  }
  const transfers = redirectTransfersForGangPackage(
    baseTransfers,
    gangPackage,
    state.players.length,
  );
  if (!transfers) return cancelStaleBuGangIntent(state, window);
  const scoringEvents: PendingScoringEvent[] = [
    ...state.pendingScoringEvents,
    {
      type: 'bu-gang-created',
      playerIndex: window.intent.declarerPlayerIndex,
      payerPlayerIndex,
      meldId: meld.id,
      transfers,
      status: 'pending',
    },
  ];
  const pendingScoringEvents = appendRuntimeFlowerKongEvents(
    state.ruleSetId,
    gangPackage,
    scoringEvents,
    declarer,
    window.intent.declarerPlayerIndex,
    declarer.flowers,
    drawResolution.newlyRevealedFlowers,
    drawResolution.status === 'wall-exhausted',
  );
  if (!pendingScoringEvents) return cancelStaleBuGangIntent(state, window);
  const nextState: GameState = {
    ...state,
    players,
    wall: [...drawResolution.wall.tiles],
    currentPlayerIndex: window.intent.declarerPlayerIndex,
    turnStage: 'waiting-for-discard',
    pendingAction: createPendingAction(players, window.intent.declarerPlayerIndex, 'discard'),
    reactionWindow: { ...window, status: 'closed' },
    gangPackage,
    pendingScoringEvents,
    selfDrawProvenance: selfDrawProvenanceFromResolution(
      window.intent.declarerPlayerIndex,
      tailDraw.tile,
      drawResolution,
      'bu-gang-tail',
      scoringEvents,
      pendingScoringEvents,
    ),
    handProgressFacts: addFlowerKongFacts(
      {
        ...state.handProgressFacts,
        successfulMingOrBuGangCount: state.handProgressFacts.successfulMingOrBuGangCount + 1,
      },
      scoringEvents,
      pendingScoringEvents,
    ),
  };
  return drawResolution.status === 'wall-exhausted' ? markHandEnded(nextState) : nextState;
}

function cancelStaleBuGangIntent(state: GameState, window: BuGangReactionWindow): GameState {
  const declarerPlayerIndex = window.intent.declarerPlayerIndex;
  return {
    ...state,
    currentPlayerIndex: declarerPlayerIndex,
    turnStage: 'waiting-for-discard',
    pendingAction: createPendingAction(state.players, declarerPlayerIndex, 'discard'),
    reactionWindow: { ...window, status: 'closed' },
  };
}

interface ValidPendingBuGangIntent {
  readonly declarer: PlayerState;
  readonly meld: PlayerState['melds'][number];
  readonly tile: OrdinaryHandTile;
}

function validatePendingBuGangIntent(
  state: GameState,
  window: BuGangReactionWindow,
): ValidPendingBuGangIntent | null {
  const declarer = state.players[window.intent.declarerPlayerIndex];
  if (
    !declarer ||
    declarer.seat !== window.intent.declarerSeat ||
    state.currentPlayerIndex !== window.intent.declarerPlayerIndex ||
    !isValidOrdinaryTile(window.intent.tile) ||
    !Array.isArray(declarer.buGangDrawProvenance) ||
    !declarer.buGangDrawProvenance.every(isValidBuGangDrawProvenance)
  ) {
    return null;
  }
  const meld = declarer.melds.find((candidate) => candidate.id === window.intent.targetMeldId);
  const tile = declarer.hand.find((candidate) => candidate.id === window.intent.tile.id);
  const provenance = declarer.buGangDrawProvenance.filter(
    (candidate) => candidate.targetMeldId === window.intent.targetMeldId,
  );
  if (
    !meld ||
    meld.type !== 'peng' ||
    !tile ||
    !isValidPengMeld(meld, window.intent.declarerPlayerIndex) ||
    !isSameOrdinaryTileFace(tile, window.intent.tile) ||
    provenance.length !== 1 ||
    provenance[0]?.tileId !== tile.id ||
    !meld.tiles.every((candidate) => isSameOrdinaryTileFace(candidate, tile)) ||
    new Set([...meld.tiles.map((candidate) => candidate.id), tile.id]).size !== 4
  ) {
    return null;
  }
  return { declarer, meld, tile };
}
export function reactionReducer(state: GameState): GameState {
  if (state.diHuDeclarations !== undefined && !validDiHuDeclarationState(state)) return state;
  return copyGameState(state);
}

export function createGameState(options: GameCreationOptions = {}): GameState {
  const ruleSet = getRuleSet(options.ruleSetId ?? DEFAULT_RULE_SET_ID);
  const dealerIndex = resolveDealerIndex(options, 0);

  const players = createInitialPlayers(dealerIndex);

  return {
    nextMeldSequence: 1,
    ruleSetId: ruleSet.id,
    players,
    wall: createNanjingMahjongDeck(),
    currentPlayerIndex: dealerIndex,
    dealerIndex,
    phase: 'ready',
    turnStage: 'waiting-for-draw',
    pendingAction: createPendingAction(players, dealerIndex, 'draw'),
    pendingScoringEvents: [],
    handProgressFacts: createEmptyHandProgressFacts(),
    specialDiscardTracking: createEmptySpecialDiscardTracking(),
    gangPackage: { status: 'none' },
    threeMouthState: createInitialThreeMouthState(),
    diHuDeclarations: { status: 'closed', declarations: [] },
  };
}

export function startGameState(state: GameState, options: StartGameOptions = {}): GameState {
  const ruleSet = getRuleSet(options.ruleSetId ?? state.ruleSetId ?? DEFAULT_RULE_SET_ID);
  const dealerIndex = resolveDealerIndex(options, state.dealerIndex);

  if (state.phase !== 'ready') {
    return {
      ...copyGameState(state),
      ruleSetId: ruleSet.id,
    };
  }

  const players = createInitialPlayers(dealerIndex);

  return dealInitialHands({
    nextMeldSequence: state.nextMeldSequence,
    ruleSetId: ruleSet.id,
    players,
    wall: [...state.wall],
    currentPlayerIndex: dealerIndex,
    dealerIndex,
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: createPendingAction(players, dealerIndex, 'discard'),
    pendingScoringEvents: [],
    handProgressFacts: createEmptyHandProgressFacts(),
    specialDiscardTracking: createEmptySpecialDiscardTracking(),
    gangPackage: { status: 'none' },
    threeMouthState: createInitialThreeMouthState(),
    diHuDeclarations: { status: 'closed', declarations: [] },
  });
}

function dealInitialHands(state: GameState): GameState {
  let wall = createTileWall(state.wall);
  const players = copyPlayers(state.players);
  const rawHands = players.map((): MahjongTile[] => []);
  const targetCounts = players.map((_, index) => (index === state.dealerIndex ? 14 : 13));

  while (targetCounts.some((targetCount, index) => rawHands[index]?.length !== targetCount)) {
    for (const playerIndex of playerOrderFromDealer(state.dealerIndex)) {
      const targetCount = targetCounts[playerIndex];

      if (targetCount === undefined) {
        throw new Error(`Invalid player index ${playerIndex}`);
      }

      if ((rawHands[playerIndex]?.length ?? 0) >= targetCount) {
        continue;
      }

      const drawResult = drawTileFromWallHead(wall);

      if (drawResult.status === 'wall-exhausted') {
        return finishInitialDealFromRawHands(state, players, rawHands, drawResult.wall, 'ended');
      }

      rawHands[playerIndex]?.push(drawResult.tile);
      wall = drawResult.wall;
    }
  }

  let pendingScoringEvents: PendingScoringEvent[] = [];
  let handProgressFacts = createEmptyHandProgressFacts();

  for (const playerIndex of playerOrderFromDealer(state.dealerIndex)) {
    const player = players[playerIndex];

    if (!player) {
      throw new Error(`Invalid player index ${playerIndex}`);
    }

    const previousEvents = pendingScoringEvents;
    const nextEvents = appendFlowerKongEvents(
      state.ruleSetId,
      pendingScoringEvents,
      player,
      playerIndex,
      rawHands[playerIndex]?.filter(isFlowerTile) ?? [],
      'initial-deal',
    );
    if (!nextEvents) return state;
    pendingScoringEvents = nextEvents;
    handProgressFacts = addFlowerKongFacts(handProgressFacts, previousEvents, pendingScoringEvents);
  }

  let phase: GameState['phase'] = 'playing';
  let dealerInitialTile: OrdinaryHandTile | null = null;

  for (const playerIndex of playerOrderFromDealer(state.dealerIndex)) {
    const player = players[playerIndex];
    const rawHand = rawHands[playerIndex];

    if (!player || !rawHand) {
      throw new Error(`Invalid player index ${playerIndex}`);
    }

    const replacement = replaceFlowersForSinglePlayer({
      wall,
      hand: rawHand,
      flowers: [],
    });

    players[playerIndex] = {
      ...player,
      hand: [...replacement.hand],
      flowers: [...replacement.flowers],
    };
    wall = replacement.wall;
    const previousEvents = pendingScoringEvents;
    const nextEvents = appendFlowerKongEvents(
      state.ruleSetId,
      pendingScoringEvents,
      players[playerIndex],
      playerIndex,
      replacement.flowers,
      'initial-flower-replacement',
    );
    if (!nextEvents) return state;
    pendingScoringEvents = nextEvents;
    handProgressFacts = addFlowerKongFacts(handProgressFacts, previousEvents, pendingScoringEvents);

    if (playerIndex === state.dealerIndex && replacement.status === 'complete') {
      dealerInitialTile =
        replacement.replacementTiles.at(-1) ?? rawHand.filter(isOrdinaryHandTile).at(-1) ?? null;
    }

    if (replacement.status === 'wall-exhausted') {
      phase = 'ended';
      break;
    }
  }

  const eligiblePlayerIndices =
    phase === 'playing'
      ? playerOrderFromDealer(state.dealerIndex)
          .filter((playerIndex) => playerIndex !== state.dealerIndex)
          .filter((playerIndex) => {
            const player = players[playerIndex];
            return (
              player !== undefined &&
              (getWinningTileFaces({ concealedTiles: player.hand, melds: player.melds })?.length ??
                0) > 0
            );
          })
      : [];
  const firstEligiblePlayerIndex = eligiblePlayerIndices[0];
  const nextState: GameState = {
    ...state,
    players,
    wall: [...wall.tiles],
    currentPlayerIndex: state.dealerIndex,
    phase,
    turnStage:
      firstEligiblePlayerIndex === undefined ? 'waiting-for-discard' : 'waiting-for-di-hu-decision',
    pendingAction:
      firstEligiblePlayerIndex === undefined
        ? createPendingAction(players, state.dealerIndex, 'discard')
        : createPendingAction(players, firstEligiblePlayerIndex, 'di-hu-decision'),
    pendingScoringEvents,
    handProgressFacts,
    diHuDeclarations:
      firstEligiblePlayerIndex === undefined
        ? { status: 'closed', declarations: [] }
        : {
            status: 'collecting',
            pendingPlayerIndices: eligiblePlayerIndices,
            declarations: [],
          },
    ...(phase === 'playing' && dealerInitialTile
      ? {
          selfDrawProvenance: {
            playerIndex: state.dealerIndex,
            tileId: dealerInitialTile.id,
            source: 'initial-dealer' as const,
          },
        }
      : {}),
  };

  return phase === 'ended' ? markHandEnded(nextState) : nextState;
}

function finishInitialDealFromRawHands(
  state: GameState,
  players: PlayerState[],
  rawHands: readonly MahjongTile[][],
  wall: TileWall,
  phase: GameState['phase'],
): GameState {
  const nextPlayers = players.map((player, index) => ({
    ...player,
    hand: rawHands[index]?.filter(isOrdinaryHandTile) ?? [],
    flowers: rawHands[index]?.filter(isFlowerTile) ?? [],
  }));
  const nextState: GameState = {
    ...state,
    players: nextPlayers,
    wall: [...wall.tiles],
    currentPlayerIndex: state.dealerIndex,
    phase,
    turnStage: 'waiting-for-discard',
    pendingAction: createPendingAction(nextPlayers, state.dealerIndex, 'discard'),
    pendingScoringEvents: [],
    handProgressFacts: createEmptyHandProgressFacts(),
    specialDiscardTracking: createEmptySpecialDiscardTracking(),
    gangPackage: { status: 'none' },
  };

  return phase === 'ended' ? markHandEnded(nextState) : nextState;
}

function playerOrderFromDealer(dealerIndex: number): number[] {
  return SEATS.map((_, offset) => (dealerIndex + offset) % SEATS.length);
}

function appendFlowerKongEvents(
  ruleSetId: GameState['ruleSetId'],
  events: readonly PendingScoringEvent[],
  player: PlayerState,
  playerIndex: number,
  flowers: readonly FlowerTile[],
  createdDuring: ScoringEventCreationStage,
): PendingScoringEvent[] | null {
  const nextEvents = [...events];

  for (const kind of findFlowerKongKinds(flowers)) {
    const alreadyRecorded = nextEvents.some(
      (event) =>
        event.type === 'flower-kong-created' &&
        event.playerIndex === playerIndex &&
        event.kind === kind,
    );

    if (!alreadyRecorded) {
      const transfers = getRuleSet(ruleSetId).getFlowerKongScoreTransfers({
        playerIndex,
        playerCount: SEATS.length,
        kind,
        createdDuring,
      });
      if (!isValidOtherPlayersTransferTopology(transfers, playerIndex, SEATS.length)) return null;
      nextEvents.push({
        type: 'flower-kong-created',
        playerIndex,
        seat: player.seat,
        kind,
        createdDuring,
        transfers: transfers.map((transfer) => ({ ...transfer })),
        status: 'pending',
      });
    }
  }

  return nextEvents;
}

function appendRuntimeFlowerKongEvents(
  ruleSetId: GameState['ruleSetId'],
  gangPackage: GangPackageState,
  events: readonly PendingScoringEvent[],
  player: PlayerState,
  playerIndex: number,
  previousFlowers: readonly FlowerTile[],
  newlyRevealedFlowers: readonly FlowerTile[],
  suppressFinalFlower: boolean,
): PendingScoringEvent[] | null {
  const nextEvents = [...events];
  const flowers = [...previousFlowers];
  const eventFlowerCount = newlyRevealedFlowers.length - (suppressFinalFlower ? 1 : 0);

  for (const [index, flower] of newlyRevealedFlowers.entries()) {
    const previousKinds = new Set(findFlowerKongKinds(flowers));
    flowers.push(flower);

    if (index < eventFlowerCount) {
      for (const kind of findFlowerKongKinds(flowers)) {
        if (
          previousKinds.has(kind) ||
          nextEvents.some(
            (event) =>
              event.type === 'flower-kong-created' &&
              event.playerIndex === playerIndex &&
              event.kind === kind,
          )
        )
          continue;
        const baseTransfers = getRuleSet(ruleSetId).getFlowerKongScoreTransfers({
          playerIndex,
          playerCount: SEATS.length,
          kind,
          createdDuring: 'runtime-flower-replacement',
        });
        if (!isValidOtherPlayersTransferTopology(baseTransfers, playerIndex, SEATS.length)) {
          return null;
        }
        const transfers = redirectTransfersForGangPackage(baseTransfers, gangPackage, SEATS.length);
        if (!transfers) return null;
        nextEvents.push({
          type: 'flower-kong-created',
          playerIndex,
          seat: player.seat,
          kind,
          createdDuring: 'runtime-flower-replacement',
          transfers,
          status: 'pending',
        });
      }
    }
  }

  return nextEvents;
}

function findFlowerKongKinds(flowers: readonly FlowerTile[]): FlowerKongKind[] {
  const flowerKinds = new Set(flowers.map((tile) => tile.flower));
  const kinds: FlowerKongKind[] = [];

  for (const flower of FOUR_COPY_FLOWER_KINDS) {
    if (flowers.filter((tile) => tile.flower === flower).length === FOUR_COPY_INDEXES.length) {
      kinds.push(flower);
    }
  }

  if (PLANT_FLOWER_KINDS.every((flower) => flowerKinds.has(flower))) {
    kinds.push('plum-orchid-bamboo-chrysanthemum');
  }

  if (SEASON_FLOWER_KINDS.every((flower) => flowerKinds.has(flower))) {
    kinds.push('spring-summer-autumn-winter');
  }

  return kinds;
}

function createEmptyHandProgressFacts(): HandProgressFacts {
  return {
    successfulAnGangCount: 0,
    successfulMingOrBuGangCount: 0,
    flowerKongCount: 0,
    gangKaiCount: 0,
    packageSettlementCount: 0,
    selfDrawCount: 0,
    followDiscardPenaltyCount: 0,
    fourIdenticalDiscardsPenaltyCount: 0,
    fourWindsGatheredCount: 0,
  };
}

function createEmptySpecialDiscardTracking(): SpecialDiscardTrackingState {
  return {
    followDiscard: null,
    windSequences: SEATS.map((_, playerIndex) => ({ playerIndex, winds: [] })),
  };
}

interface SpecialDiscardUpdate {
  readonly tracking: SpecialDiscardTrackingState;
  readonly events: readonly PendingSpecialDiscardScoringEvent[];
  readonly handProgressFacts: HandProgressFacts;
}

function updateSpecialDiscardRules(
  state: GameState,
  players: readonly PlayerState[],
  playerIndex: number,
  discardedTile: OrdinaryHandTile,
): SpecialDiscardUpdate | null {
  const tileFace = ordinaryTileFace(discardedTile);
  const follow = state.specialDiscardTracking.followDiscard;
  let nextFollow = follow;
  let followEvent: PendingSpecialDiscardScoringEvent | null = null;
  if (follow === null || follow.expectedPlayerIndex !== playerIndex) {
    nextFollow = {
      initiatorPlayerIndex: playerIndex,
      tileFace,
      expectedPlayerIndex: nextPlayerIndex(playerIndex),
      followerCount: 0,
    };
  } else if (!isSameOrdinaryTileFaceValue(follow.tileFace, tileFace)) {
    nextFollow = {
      initiatorPlayerIndex: playerIndex,
      tileFace,
      expectedPlayerIndex: nextPlayerIndex(playerIndex),
      followerCount: 0,
    };
  } else if (follow.followerCount === 2) {
    const transfers = redirectTransfersForGangPackage(
      getRuleSet(state.ruleSetId).getSpecialDiscardScoreTransfers({
        source: 'follow-discard',
        playerCount: players.length,
        payerPlayerIndex: follow.initiatorPlayerIndex,
        triggeringPlayerIndex: playerIndex,
        tileFace,
      }),
      state.gangPackage,
      players.length,
    );
    if (!transfers || !isValidGeneratedTransfers(transfers, players.length)) return null;
    followEvent = {
      type: 'special-discard',
      source: 'follow-discard',
      initiatorPlayerIndex: follow.initiatorPlayerIndex,
      triggeringPlayerIndex: playerIndex,
      tileFace,
      transfers: transfers.map((transfer) => ({ ...transfer })),
      status: 'pending',
    };
    nextFollow = null;
  } else {
    nextFollow = {
      ...follow,
      expectedPlayerIndex: nextPlayerIndex(playerIndex),
      followerCount: follow.followerCount + 1,
    };
  }

  const player = players[playerIndex];
  if (!player || !hasValidDiscardRecords(player)) return null;
  const matchingDiscards = player.discardPile.filter((record) =>
    isSameOrdinaryTileFace(record.tile, discardedTile),
  );
  let identicalEvent: PendingSpecialDiscardScoringEvent | null = null;
  if (
    matchingDiscards.length === 4 &&
    new Set(matchingDiscards.map((record) => record.tile.id)).size === 4 &&
    matchingDiscards.at(-1)?.tile.id === discardedTile.id
  ) {
    const transfers = redirectTransfersForGangPackage(
      getRuleSet(state.ruleSetId).getSpecialDiscardScoreTransfers({
        source: 'four-identical-discards',
        playerCount: players.length,
        payerPlayerIndex: playerIndex,
        tileFace,
      }),
      state.gangPackage,
      players.length,
    );
    if (!transfers || !isValidGeneratedTransfers(transfers, players.length)) return null;
    identicalEvent = {
      type: 'special-discard',
      source: 'four-identical-discards',
      playerIndex,
      tileFace,
      tileId: discardedTile.id,
      transfers: transfers.map((transfer) => ({ ...transfer })),
      status: 'pending',
    };
  }

  const windSequences = state.specialDiscardTracking.windSequences.map((sequence) => ({
    ...sequence,
    winds: [...sequence.winds],
  }));
  const sequence = windSequences[playerIndex];
  if (!sequence) return null;
  let winds = discardedTile.category === 'wind' ? [...sequence.winds] : [];
  let windEvent: PendingSpecialDiscardScoringEvent | null = null;
  if (discardedTile.category === 'wind') {
    if (!winds.includes(discardedTile.wind)) winds.push(discardedTile.wind);
    if (winds.length === WIND_TILE_KINDS.length) {
      const transfers = redirectTransfersForGangPackage(
        getRuleSet(state.ruleSetId).getSpecialDiscardScoreTransfers({
          source: 'four-winds-gathered',
          playerCount: players.length,
          receiverPlayerIndex: playerIndex,
          completingWind: discardedTile.wind,
        }),
        state.gangPackage,
        players.length,
      );
      if (!transfers || !isValidGeneratedTransfers(transfers, players.length)) return null;
      windEvent = {
        type: 'special-discard',
        source: 'four-winds-gathered',
        playerIndex,
        completingWind: discardedTile.wind,
        transfers: transfers.map((transfer) => ({ ...transfer })),
        status: 'pending',
      };
      winds = [];
    }
  }
  windSequences[playerIndex] = { playerIndex, winds };
  const events = [followEvent, identicalEvent, windEvent].filter(
    (event): event is PendingSpecialDiscardScoringEvent => event !== null,
  );
  return {
    tracking: { followDiscard: nextFollow, windSequences },
    events,
    handProgressFacts: {
      ...state.handProgressFacts,
      followDiscardPenaltyCount:
        state.handProgressFacts.followDiscardPenaltyCount + (followEvent ? 1 : 0),
      fourIdenticalDiscardsPenaltyCount:
        state.handProgressFacts.fourIdenticalDiscardsPenaltyCount + (identicalEvent ? 1 : 0),
      fourWindsGatheredCount: state.handProgressFacts.fourWindsGatheredCount + (windEvent ? 1 : 0),
    },
  };
}

function trackingAfterSeatClaim(state: GameState, claimantPlayerIndex: number) {
  const follow = state.specialDiscardTracking.followDiscard;
  return follow === null || follow.expectedPlayerIndex === claimantPlayerIndex
    ? state.specialDiscardTracking
    : { ...state.specialDiscardTracking, followDiscard: null };
}

function createInitialThreeMouthState(): ThreeMouthState {
  const initial = (): ThreeMouthPlayerState => ({
    status: 'tracking',
    mouthCount: 0,
    lockedPayerPlayerIndex: null,
  });
  return [initial(), initial(), initial(), initial()];
}

function validThreeMouthState(state: unknown): ThreeMouthState | null {
  if (!isRecord(state) || !Array.isArray(state.players) || state.players.length !== 4) return null;
  const value = state.threeMouthState;
  if (!Array.isArray(value) || value.length !== 4) return null;
  const result: ThreeMouthPlayerState[] = [];
  for (let beneficiaryPlayerIndex = 0; beneficiaryPlayerIndex < 4; beneficiaryPlayerIndex += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, beneficiaryPlayerIndex)) return null;
    const playerState = value[beneficiaryPlayerIndex];
    if (!isRecord(playerState)) return null;
    if (playerState.status === 'tracking') {
      if (
        !hasOnlyKeys(playerState, ['status', 'mouthCount', 'lockedPayerPlayerIndex']) ||
        (playerState.mouthCount !== 0 &&
          playerState.mouthCount !== 1 &&
          playerState.mouthCount !== 2) ||
        (playerState.lockedPayerPlayerIndex !== null &&
          (!isPlayerIndexValue(playerState.lockedPayerPlayerIndex, 4) ||
            playerState.lockedPayerPlayerIndex === beneficiaryPlayerIndex)) ||
        (playerState.mouthCount === 0 && playerState.lockedPayerPlayerIndex !== null)
      ) {
        return null;
      }
      result.push(playerState as ThreeMouthPlayerState);
      continue;
    }
    if (playerState.status === 'active') {
      if (
        !hasOnlyKeys(playerState, ['status', 'payerPlayerIndex']) ||
        !isPlayerIndexValue(playerState.payerPlayerIndex, 4) ||
        playerState.payerPlayerIndex === beneficiaryPlayerIndex
      ) {
        return null;
      }
      result.push(playerState as ThreeMouthPlayerState);
      continue;
    }
    if (playerState.status !== 'invalid' || !hasOnlyKeys(playerState, ['status'])) return null;
    result.push(playerState as ThreeMouthPlayerState);
  }
  return [result[0]!, result[1]!, result[2]!, result[3]!];
}

function withoutActiveThreeMouthClaims(
  availability: ReactionAvailability,
  playerState: ThreeMouthPlayerState | undefined,
): ReactionAvailability {
  return playerState?.status === 'active'
    ? {
        ...availability,
        responseTypes: availability.responseTypes.filter(
          (type) => type !== 'peng' && type !== 'ming-gang',
        ),
      }
    : availability;
}

function withActiveThreeMouthSpecialDiscardHu(
  availability: ReactionAvailability,
  playerState: ThreeMouthPlayerState | undefined,
  responder: PlayerState,
  discardedTile: OrdinaryHandTile,
): ReactionAvailability {
  if (playerState?.status !== 'active') return availability;
  if (!hasValidActiveThreeMouthMelds(responder, playerState.payerPlayerIndex)) {
    return { ...availability, responseTypes: ['pass'] };
  }
  const matching = responder.hand.filter((tile) => isSameOrdinaryTileFace(tile, discardedTile));
  const hasOpportunity =
    matching.length >= 2 &&
    matching.length <= 3 &&
    new Set(matching.map((tile) => tile.id)).size === matching.length;
  const responseTypes: ReactionResponseType[] = availability.responseTypes.filter(
    (type) => type !== 'peng' && type !== 'ming-gang' && type !== 'hu',
  );
  if (hasOpportunity && !responder.passHu) responseTypes.push('hu');
  return { ...availability, responseTypes };
}

function hasValidActiveThreeMouthMelds(player: PlayerState, payerPlayerIndex: number): boolean {
  return (
    player.melds.length === 3 &&
    player.melds.every(isValidMeld) &&
    player.melds.some(
      (meld) => meld.type !== 'an-gang' && meld.fromPlayerIndex === payerPlayerIndex,
    )
  );
}

function advanceThreeMouthForExternalMouth(
  state: ThreeMouthState,
  beneficiaryPlayerIndex: number,
  sourcePlayerIndex: number,
): ThreeMouthState {
  if (
    !isPlayerIndexValue(beneficiaryPlayerIndex, 4) ||
    !isPlayerIndexValue(sourcePlayerIndex, 4) ||
    beneficiaryPlayerIndex === sourcePlayerIndex
  ) {
    return state;
  }
  const current = state[beneficiaryPlayerIndex];
  if (!current || current.status !== 'tracking') return state;
  if (
    current.lockedPayerPlayerIndex !== null &&
    current.lockedPayerPlayerIndex !== sourcePlayerIndex
  ) {
    return replaceThreeMouthPlayerState(state, beneficiaryPlayerIndex, { status: 'invalid' });
  }
  const next =
    current.mouthCount === 2
      ? ({ status: 'active', payerPlayerIndex: sourcePlayerIndex } as const)
      : ({
          status: 'tracking',
          mouthCount: current.mouthCount === 0 ? 1 : 2,
          lockedPayerPlayerIndex: sourcePlayerIndex,
        } as const);
  return replaceThreeMouthPlayerState(state, beneficiaryPlayerIndex, next);
}

function advanceThreeMouthForAnGang(state: ThreeMouthState, playerIndex: number): ThreeMouthState {
  if (!isPlayerIndexValue(playerIndex, 4)) return state;
  const current = state[playerIndex];
  if (!current || current.status !== 'tracking') return state;
  if (current.mouthCount === 2) {
    return replaceThreeMouthPlayerState(
      state,
      playerIndex,
      current.lockedPayerPlayerIndex === null
        ? { status: 'invalid' }
        : { status: 'active', payerPlayerIndex: current.lockedPayerPlayerIndex },
    );
  }
  return replaceThreeMouthPlayerState(state, playerIndex, {
    status: 'tracking',
    mouthCount: current.mouthCount === 0 ? 1 : 2,
    lockedPayerPlayerIndex: current.lockedPayerPlayerIndex,
  });
}

function replaceThreeMouthPlayerState(
  state: ThreeMouthState,
  playerIndex: number,
  playerState: ThreeMouthPlayerState,
): ThreeMouthState {
  return [
    playerIndex === 0 ? playerState : state[0],
    playerIndex === 1 ? playerState : state[1],
    playerIndex === 2 ? playerState : state[2],
    playerIndex === 3 ? playerState : state[3],
  ];
}

function isValidGeneratedTransfers(
  transfers: readonly ScoreTransfer[],
  playerCount: number,
): boolean {
  return (
    Array.isArray(transfers) &&
    transfers.length === playerCount - 1 &&
    transfers.every(
      (transfer) =>
        Number.isInteger(transfer.fromPlayerIndex) &&
        transfer.fromPlayerIndex >= 0 &&
        transfer.fromPlayerIndex < playerCount &&
        Number.isInteger(transfer.toPlayerIndex) &&
        transfer.toPlayerIndex >= 0 &&
        transfer.toPlayerIndex < playerCount &&
        transfer.fromPlayerIndex !== transfer.toPlayerIndex &&
        Number.isInteger(transfer.amount) &&
        transfer.amount > 0,
    )
  );
}

function validGangPackageState(state: unknown): GangPackageState | null {
  if (!isRecord(state) || !Array.isArray(state.players) || state.players.length !== SEATS.length)
    return null;
  const value = state.gangPackage;
  if (!isRecord(value)) return null;
  if (value.status === 'none') {
    return hasOnlyKeys(value, ['status']) ? { status: 'none' } : null;
  }
  if (
    value.status !== 'active' ||
    !hasOnlyKeys(value, [
      'status',
      'payerPlayerIndex',
      'beneficiaryPlayerIndex',
      'source',
      'establishedByMeldId',
    ]) ||
    !isPlayerIndexValue(value.payerPlayerIndex, state.players.length) ||
    !isPlayerIndexValue(value.beneficiaryPlayerIndex, state.players.length) ||
    value.payerPlayerIndex === value.beneficiaryPlayerIndex ||
    (value.source !== 'ming-gang' && value.source !== 'bu-gang') ||
    typeof value.establishedByMeldId !== 'string' ||
    value.establishedByMeldId.trim().length === 0
  ) {
    return null;
  }
  const beneficiary = state.players[value.beneficiaryPlayerIndex];
  if (!isRecord(beneficiary) || !Array.isArray(beneficiary.melds)) return null;
  const matching = beneficiary.melds.filter(
    (candidate) => isRecord(candidate) && candidate.id === value.establishedByMeldId,
  );
  if (matching.length !== 1) return null;
  const meld = matching[0];
  if (
    !meld ||
    !isValidMeld(meld) ||
    meld.type !== value.source ||
    meld.fromPlayerIndex !== value.payerPlayerIndex
  ) {
    return null;
  }
  return {
    status: 'active',
    payerPlayerIndex: value.payerPlayerIndex,
    beneficiaryPlayerIndex: value.beneficiaryPlayerIndex,
    source: value.source,
    establishedByMeldId: value.establishedByMeldId,
  };
}

function redirectTransfersForGangPackage(
  transfers: unknown,
  gangPackage: GangPackageState,
  playerCount: number,
): readonly ScoreTransfer[] | null {
  if (
    !Array.isArray(transfers) ||
    transfers.length === 0 ||
    !transfers.every((transfer) => isValidScoreTransfer(transfer, playerCount))
  )
    return null;
  return transfers.map((transfer) => ({
    fromPlayerIndex:
      gangPackage.status === 'active' &&
      transfer.toPlayerIndex === gangPackage.beneficiaryPlayerIndex
        ? gangPackage.payerPlayerIndex
        : transfer.fromPlayerIndex,
    toPlayerIndex: transfer.toPlayerIndex,
    amount: transfer.amount,
  }));
}

function isValidSinglePayerTransferTopology(
  transfers: unknown,
  payerPlayerIndex: number,
  receiverPlayerIndex: number,
  playerCount: number,
): transfers is readonly ScoreTransfer[] {
  return (
    Array.isArray(transfers) &&
    transfers.length === 1 &&
    isValidScoreTransfer(transfers[0], playerCount) &&
    transfers[0].fromPlayerIndex === payerPlayerIndex &&
    transfers[0].toPlayerIndex === receiverPlayerIndex
  );
}

function isValidOtherPlayersTransferTopology(
  transfers: unknown,
  receiverPlayerIndex: number,
  playerCount: number,
): transfers is readonly ScoreTransfer[] {
  if (!Array.isArray(transfers) || transfers.length !== playerCount - 1) return false;
  const payers = new Set<number>();
  for (const transfer of transfers) {
    if (
      !isValidScoreTransfer(transfer, playerCount) ||
      transfer.toPlayerIndex !== receiverPlayerIndex ||
      transfer.fromPlayerIndex === receiverPlayerIndex ||
      payers.has(transfer.fromPlayerIndex)
    ) {
      return false;
    }
    payers.add(transfer.fromPlayerIndex);
  }
  return payers.size === playerCount - 1;
}

function isValidScoreTransfer(value: unknown, playerCount: number): value is ScoreTransfer {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['fromPlayerIndex', 'toPlayerIndex', 'amount']) &&
    isPlayerIndexValue(value.fromPlayerIndex, playerCount) &&
    isPlayerIndexValue(value.toPlayerIndex, playerCount) &&
    value.fromPlayerIndex !== value.toPlayerIndex &&
    typeof value.amount === 'number' &&
    Number.isFinite(value.amount) &&
    Number.isInteger(value.amount) &&
    value.amount > 0
  );
}

function hasValidDiscardRecords(player: PlayerState): boolean {
  if (!Array.isArray(player.discardPile)) return false;
  const ids: string[] = [];
  const faceCounts = new Map<string, number>();
  for (const record of player.discardPile) {
    if (
      !isRecord(record) ||
      !isValidOrdinaryTile(record.tile) ||
      (record.claimedByMeldId !== undefined &&
        (typeof record.claimedByMeldId !== 'string' || record.claimedByMeldId.trim().length === 0))
    )
      return false;
    ids.push(record.tile.id);
    const key = ordinaryTileFaceKeyValue(ordinaryTileFace(record.tile));
    faceCounts.set(key, (faceCounts.get(key) ?? 0) + 1);
  }
  return new Set(ids).size === ids.length && [...faceCounts.values()].every((count) => count <= 4);
}

function isValidSpecialDiscardTracking(
  value: unknown,
  playerCount: number,
): value is SpecialDiscardTrackingState {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['followDiscard', 'windSequences']) ||
    !Array.isArray(value.windSequences) ||
    value.windSequences.length !== playerCount
  )
    return false;
  if (value.followDiscard !== null) {
    const follow = value.followDiscard;
    if (
      !isRecord(follow) ||
      !hasOnlyKeys(follow, [
        'initiatorPlayerIndex',
        'tileFace',
        'expectedPlayerIndex',
        'followerCount',
      ]) ||
      !isPlayerIndexValue(follow.initiatorPlayerIndex, playerCount) ||
      !isPlayerIndexValue(follow.expectedPlayerIndex, playerCount) ||
      follow.initiatorPlayerIndex === follow.expectedPlayerIndex ||
      !isValidOrdinaryTileFace(follow.tileFace) ||
      !isNonNegativeInteger(follow.followerCount) ||
      follow.followerCount > 2
    )
      return false;
    if (
      follow.expectedPlayerIndex !==
      (follow.initiatorPlayerIndex + follow.followerCount + 1) % playerCount
    )
      return false;
  }
  return value.windSequences.every((candidate, playerIndex) => {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, ['playerIndex', 'winds']) ||
      candidate.playerIndex !== playerIndex ||
      !Array.isArray(candidate.winds) ||
      candidate.winds.length > 3 ||
      !candidate.winds.every((wind) =>
        WIND_TILE_KINDS.some((candidateWind) => candidateWind === wind),
      )
    )
      return false;
    return new Set(candidate.winds).size === candidate.winds.length;
  });
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isPlayerIndexValue(value: unknown, playerCount: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < playerCount;
}

function addFlowerKongFacts(
  facts: HandProgressFacts,
  before: readonly PendingScoringEvent[],
  after: readonly PendingScoringEvent[],
): HandProgressFacts {
  const addedCount = after
    .slice(before.length)
    .filter((event) => event.type === 'flower-kong-created').length;
  return addedCount === 0
    ? facts
    : { ...facts, flowerKongCount: facts.flowerKongCount + addedCount };
}

function resolveDealerIndex(options: StartGameOptions, fallbackDealerIndex: number): number {
  const seatDealerIndex =
    options.dealerSeat === undefined ? undefined : SEATS.indexOf(options.dealerSeat);
  const dealerIndex = options.dealerIndex ?? seatDealerIndex ?? fallbackDealerIndex;

  if (options.dealerIndex !== undefined && seatDealerIndex !== undefined) {
    if (options.dealerIndex !== seatDealerIndex) {
      throw new Error('dealerIndex and dealerSeat must refer to the same player');
    }
  }

  if (!Number.isInteger(dealerIndex) || dealerIndex < 0 || dealerIndex >= SEATS.length) {
    throw new Error(`Invalid dealer index ${dealerIndex}`);
  }

  return dealerIndex;
}

export function isNumberTile(tile: MahjongTile): tile is NumberTile {
  return tile.category === 'number';
}

export function isWindTile(tile: MahjongTile): tile is WindTile {
  return tile.category === 'wind';
}

export function isFlowerTile(tile: MahjongTile): tile is FlowerTile {
  return tile.category === 'flower';
}

export function isOrdinaryHandTile(tile: MahjongTile): tile is OrdinaryHandTile {
  return isNumberTile(tile) || isWindTile(tile);
}

export function requiresFlowerReveal(tile: MahjongTile): tile is FlowerTile {
  return isFlowerTile(tile);
}

export function createTileWall(tiles: readonly MahjongTile[]): TileWall {
  return { tiles: [...tiles] };
}

export function createNanjingMahjongTileWall(): TileWall {
  return createTileWall(createNanjingMahjongDeck());
}

export function drawTileFromWallHead(wall: TileWall): DrawTileFromWallResult {
  const tile = wall.tiles[0];

  if (!tile) {
    return createWallExhaustedResult(wall);
  }

  return {
    status: 'drawn',
    tile,
    wall: createTileWall(wall.tiles.slice(1)),
  };
}

export function drawTileFromWallTail(wall: TileWall): DrawTileFromWallResult {
  const tile = wall.tiles.at(-1);

  if (!tile) {
    return createWallExhaustedResult(wall);
  }

  return {
    status: 'drawn',
    tile,
    wall: createTileWall(wall.tiles.slice(0, -1)),
  };
}

export function replaceFlowersForSinglePlayer(
  input: SinglePlayerFlowerReplacementInput,
): SinglePlayerFlowerReplacementResult {
  const hand: OrdinaryHandTile[] = [];
  const flowers: FlowerTile[] = [...input.flowers];
  const newlyRevealedFlowers: FlowerTile[] = [];
  let replacementCount = 0;

  for (const tile of input.hand) {
    if (isFlowerTile(tile)) {
      flowers.push(tile);
      newlyRevealedFlowers.push(tile);
      replacementCount += 1;
    } else {
      hand.push(tile);
    }
  }

  return drawReplacementTilesFromWall(
    {
      wall: createTileWall(input.wall.tiles),
      hand,
      flowers,
      newlyRevealedFlowers,
      replacementTiles: [],
    },
    replacementCount,
  );
}

export function resolveDrawnTileWithFlowerReplacement(
  hand: readonly OrdinaryHandTile[],
  flowers: readonly FlowerTile[],
  drawnTile: MahjongTile,
  wall: TileWall,
): DrawnTileResolutionResult {
  if (isOrdinaryHandTile(drawnTile)) {
    return {
      status: 'complete',
      wall: createTileWall(wall.tiles),
      hand: [...hand, drawnTile],
      flowers: [...flowers],
      newlyRevealedFlowers: [],
      replacementTiles: [],
    };
  }

  return drawReplacementTilesFromWall(
    {
      wall: createTileWall(wall.tiles),
      hand: [...hand],
      flowers: [...flowers, drawnTile],
      newlyRevealedFlowers: [drawnTile],
      replacementTiles: [],
    },
    1,
  );
}

export function createNanjingMahjongDeck(): MahjongTile[] {
  return [...createNumberTiles(), ...createWindTiles(), ...createFlowerTiles()];
}

function copyGameState(state: GameState): GameState {
  return {
    nextMeldSequence: state.nextMeldSequence,
    ruleSetId: state.ruleSetId,
    players: copyPlayers(state.players),
    wall: [...state.wall],
    currentPlayerIndex: state.currentPlayerIndex,
    dealerIndex: state.dealerIndex,
    phase: state.phase,
    turnStage: state.turnStage,
    pendingAction: { ...state.pendingAction },
    ...(state.lastDiscard === undefined ? {} : { lastDiscard: { ...state.lastDiscard } }),
    ...(state.reactionWindow == null
      ? {}
      : { reactionWindow: copyReactionWindow(state.reactionWindow) }),
    pendingScoringEvents: [...(state.pendingScoringEvents ?? [])],
    handProgressFacts: { ...state.handProgressFacts },
    specialDiscardTracking: {
      followDiscard:
        state.specialDiscardTracking.followDiscard === null
          ? null
          : {
              ...state.specialDiscardTracking.followDiscard,
              tileFace: { ...state.specialDiscardTracking.followDiscard.tileFace },
            },
      windSequences: state.specialDiscardTracking.windSequences.map((sequence) => ({
        ...sequence,
        winds: [...sequence.winds],
      })),
    },
    gangPackage: { ...state.gangPackage },
    threeMouthState: [
      { ...state.threeMouthState[0] },
      { ...state.threeMouthState[1] },
      { ...state.threeMouthState[2] },
      { ...state.threeMouthState[3] },
    ],
    ...(state.diHuDeclarations === undefined
      ? {}
      : { diHuDeclarations: copyDiHuDeclarationState(state.diHuDeclarations) }),
    ...(state.selfDrawProvenance === undefined
      ? {}
      : { selfDrawProvenance: { ...state.selfDrawProvenance } }),
    ...(state.result === undefined ? {} : { result: copyHandResult(state.result) }),
  };
}

function copyDiHuDeclarationState(state: DiHuDeclarationState): DiHuDeclarationState {
  const declarations = state.declarations.map((declaration) => ({
    playerIndex: declaration.playerIndex,
    winningTileFaces: declaration.winningTileFaces.map((face) => ({ ...face })),
  }));
  return state.status === 'collecting'
    ? { status: 'collecting', pendingPlayerIndices: [...state.pendingPlayerIndices], declarations }
    : { status: 'closed', declarations };
}

function validDiHuDeclarationState(state: unknown): DiHuDeclarationState | null {
  if (
    !isRecord(state) ||
    !Array.isArray(state.players) ||
    typeof state.dealerIndex !== 'number' ||
    !Number.isInteger(state.dealerIndex)
  ) {
    return null;
  }
  const players = state.players;
  const playerCount = players.length;
  const dealerIndex = state.dealerIndex;
  const value = state.diHuDeclarations;
  if (!isRecord(value) || !Array.isArray(value.declarations)) return null;
  const declarations = value.declarations;
  const keys = Object.keys(value);
  if (
    !declarations.every((declaration) =>
      isValidDiHuDeclaration(declaration, playerCount, dealerIndex),
    )
  ) {
    return null;
  }
  const validDeclarations: DiHuDeclaration[] = declarations;
  const declaredIndices = validDeclarations.map((declaration) => declaration.playerIndex);
  if (new Set(declaredIndices).size !== declaredIndices.length) return null;
  const seatOrder = playerOrderFromDealer(dealerIndex).filter((index) => index !== dealerIndex);
  const declaredPositions = declaredIndices.map((index) => seatOrder.indexOf(index));
  if (
    declaredPositions.some((position) => position < 0) ||
    declaredPositions.some(
      (position, index) => index > 0 && position <= declaredPositions[index - 1]!,
    )
  ) {
    return null;
  }
  if (value.status === 'closed') {
    return keys.length === 2 && keys.includes('status') && keys.includes('declarations')
      ? { status: 'closed', declarations: validDeclarations }
      : null;
  }
  if (value.status !== 'collecting' || !Array.isArray(value.pendingPlayerIndices)) return null;
  if (
    keys.length !== 3 ||
    !keys.includes('status') ||
    !keys.includes('pendingPlayerIndices') ||
    !keys.includes('declarations')
  ) {
    return null;
  }
  const pendingPlayerIndices = value.pendingPlayerIndices;
  if (
    pendingPlayerIndices.length === 0 ||
    pendingPlayerIndices.some(
      (index) =>
        typeof index !== 'number' ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= playerCount ||
        index === dealerIndex ||
        declaredIndices.includes(index),
    ) ||
    new Set(pendingPlayerIndices).size !== pendingPlayerIndices.length
  ) {
    return null;
  }
  const validPendingPlayerIndices: number[] = pendingPlayerIndices;
  if (
    validPendingPlayerIndices.some((index) => {
      const player = players[index];
      if (!isRecord(player) || !Array.isArray(player.hand) || !Array.isArray(player.melds)) {
        return true;
      }
      const waits = getWinningTileFaces({
        concealedTiles: player.hand,
        melds: player.melds,
      });
      return !waits?.length;
    })
  ) {
    return null;
  }
  const positions = validPendingPlayerIndices.map((index) => seatOrder.indexOf(index));
  if (positions.some((position) => position < 0)) return null;
  if (positions.some((position, index) => index > 0 && position <= positions[index - 1]!))
    return null;
  if (declaredPositions.at(-1) !== undefined && declaredPositions.at(-1)! >= positions[0]!) {
    return null;
  }
  return {
    status: 'collecting',
    pendingPlayerIndices: validPendingPlayerIndices,
    declarations: validDeclarations,
  };
}

function isValidDiHuDeclaration(
  declaration: unknown,
  playerCount: number,
  dealerIndex: number,
): declaration is DiHuDeclaration {
  if (
    !isRecord(declaration) ||
    Object.keys(declaration).length !== 2 ||
    !Object.keys(declaration).includes('playerIndex') ||
    !Object.keys(declaration).includes('winningTileFaces') ||
    typeof declaration.playerIndex !== 'number' ||
    !Number.isInteger(declaration.playerIndex) ||
    declaration.playerIndex < 0 ||
    declaration.playerIndex >= playerCount ||
    declaration.playerIndex === dealerIndex ||
    !Array.isArray(declaration.winningTileFaces)
  ) {
    return false;
  }
  const faces = declaration.winningTileFaces;
  return (
    faces.length > 0 &&
    faces.every(isValidOrdinaryTileFaceShape) &&
    new Set(faces.map(ordinaryTileFaceKey)).size === faces.length &&
    faces.every(
      (face, index) => index === 0 || compareOrdinaryTileFaces(faces[index - 1]!, face) < 0,
    )
  );
}

function diHuDeclarationFor(state: GameState, playerIndex: number): DiHuDeclaration | null {
  const declarations = validDiHuDeclarationState(state);
  return declarations?.declarations.find((value) => value.playerIndex === playerIndex) ?? null;
}

function preservesDiHuWaitAfterAnGang(
  player: PlayerState,
  selectedTiles: readonly OrdinaryHandTile[],
  declaration: DiHuDeclaration,
): boolean {
  if (selectedTiles.length !== 4) return false;
  const selectedIds = new Set(selectedTiles.map((tile) => tile.id));
  const waits = getWinningTileFaces({
    concealedTiles: player.hand.filter((tile) => !selectedIds.has(tile.id)),
    melds: [...player.melds, { id: 'di-hu-an-gang-query', type: 'an-gang', tiles: selectedTiles }],
  });
  return waits !== null && sameOrdinaryTileFaces(waits, declaration.winningTileFaces);
}

function sameOrdinaryTileFaces(
  left: readonly OrdinaryTileFace[],
  right: readonly OrdinaryTileFace[],
): boolean {
  return (
    left.length === right.length &&
    left.every((face, index) =>
      right[index] ? isSameOrdinaryTileFaceValue(face, right[index]) : false,
    )
  );
}

function createReactionWindow(
  players: readonly PlayerState[],
  fromPlayerIndex: number,
  discardedTile: MahjongTile,
): DiscardReactionWindow {
  const discarder = players[fromPlayerIndex];

  if (!discarder) {
    throw new Error(`Invalid discard player index ${fromPlayerIndex}`);
  }

  return {
    source: 'discard',
    discardedTile,
    fromPlayerIndex,
    fromSeat: discarder.seat,
    responderOrder: createResponderOrder(players, fromPlayerIndex),
    availableReactions: [],
    responses: [],
    status: 'open',
  };
}

function createResponderOrder(
  players: readonly PlayerState[],
  fromPlayerIndex: number,
): ReactionWindow['responderOrder'] {
  return SEATS.slice(1).map((_, offset) => {
    const playerIndex = (fromPlayerIndex + offset + 1) % SEATS.length;
    const player = players[playerIndex];

    if (!player) {
      throw new Error(`Invalid responder player index ${playerIndex}`);
    }

    return {
      playerIndex,
      seat: player.seat,
    };
  });
}

function copyReactionWindow(reactionWindow: ReactionWindow): ReactionWindow {
  return {
    ...reactionWindow,
    ...(reactionWindow.source === 'bu-gang'
      ? { intent: { ...reactionWindow.intent, tile: { ...reactionWindow.intent.tile } } }
      : {}),
    responderOrder: reactionWindow.responderOrder.map((responder) => ({ ...responder })),
    availableReactions: reactionWindow.availableReactions.map((availability) => ({
      ...availability,
      responseTypes: [...availability.responseTypes],
    })),
    responses: reactionWindow.responses.map((response) => ({ ...response })),
  };
}

function createPendingAction(
  players: readonly PlayerState[],
  playerIndex: number,
  type: PendingAction['type'],
): PendingAction {
  const player = players[playerIndex];

  if (!player) {
    throw new Error(`Invalid pending action player index ${playerIndex}`);
  }

  return {
    playerIndex,
    seat: player.seat,
    type,
  };
}

function createNoPendingAction(): PendingAction {
  return {
    playerIndex: null,
    seat: null,
    type: 'none',
  };
}

function markHandEnded(state: GameState): GameState {
  return {
    ...state,
    phase: 'ended',
    turnStage: 'hand-ended',
    pendingAction: createNoPendingAction(),
    selfDrawProvenance: undefined,
    result: { type: 'draw', reason: 'wall-exhausted' },
  };
}

function selfDrawProvenanceFromResolution(
  playerIndex: number,
  initiallyDrawnTile: MahjongTile,
  resolution: DrawnTileResolutionResult,
  directSource: Exclude<SelfDrawSource, 'initial-dealer' | 'flower-replacement'>,
  eventsBeforeFlowerReplacement: readonly PendingScoringEvent[],
  eventsAfterFlowerReplacement: readonly PendingScoringEvent[],
): SelfDrawProvenance | undefined {
  if (resolution.status !== 'complete') return undefined;
  const tile = newlyDrawnOrdinaryTile(initiallyDrawnTile, resolution);
  if (!tile) return undefined;
  if (isOrdinaryHandTile(initiallyDrawnTile)) {
    return { playerIndex, tileId: tile.id, source: directSource };
  }
  return {
    playerIndex,
    tileId: tile.id,
    source: 'flower-replacement',
    formedFlowerKongDuringReplacement: eventsAfterFlowerReplacement
      .slice(eventsBeforeFlowerReplacement.length)
      .some((event) => event.type === 'flower-kong-created'),
  };
}

function validSelfDrawHuCandidate(
  state: unknown,
  playerIndex: number,
): ValidSelfDrawHuCandidate | null {
  if (!isSafeSelfDrawCandidateState(state, playerIndex)) return null;
  const provenance = state.selfDrawProvenance;
  const player = state.players[playerIndex];
  if (!player) return null;
  const reactionWindowActive =
    state.reactionWindow != null && state.reactionWindow.status !== 'closed';
  if (
    reactionWindowActive ||
    !isValidSelfDrawProvenance(provenance, state.players.length) ||
    provenance.playerIndex !== playerIndex ||
    !hasValidHuEntities(state.players)
  ) {
    return null;
  }
  const matches = player.hand.filter((tile) => tile.id === provenance.tileId);
  if (matches.length !== 1) return null;
  const winningTile = matches[0];
  if (!winningTile || !isValidOrdinaryTile(winningTile)) return null;
  const concealedTiles = player.hand.filter((tile) => tile.id !== provenance.tileId);
  const sourceDetails =
    provenance.source === 'flower-replacement'
      ? {
          drawSource: provenance.source,
          formedFlowerKongDuringReplacement: provenance.formedFlowerKongDuringReplacement,
        }
      : { drawSource: provenance.source };
  const threeMouthState = validThreeMouthState(state);
  const active = threeMouthState?.[playerIndex];
  if (active?.status === 'active') {
    if (!hasValidActiveThreeMouthMelds(player, active.payerPlayerIndex)) return null;
    const matching = player.hand.filter((tile) => isSameOrdinaryTileFace(tile, winningTile));
    if (
      matching.length === 4 &&
      new Set(matching.map((tile) => tile.id)).size === 4 &&
      concealedTiles.filter((tile) => isSameOrdinaryTileFace(tile, winningTile)).length === 3
    ) {
      const forced = getRuleSet(state.ruleSetId).getThreeMouthForcedHuResolution({
        source: 'self-draw',
        winnerPlayerIndex: playerIndex,
        payerPlayerIndex: active.payerPlayerIndex,
        playerCount: state.players.length,
        winningTile,
        concealedTiles,
        melds: player.melds,
        flowers: player.flowers,
        allMelds: state.players.flatMap((candidate) => candidate.melds),
        dealerIndex: state.dealerIndex,
        diHuDeclaration: diHuDeclarationFor(state, playerIndex) ?? undefined,
        trigger: 'self-draw-an-gang-opportunity',
        forcedBasePattern: 'global-single-wait',
        ...sourceDetails,
      });
      if (
        forced &&
        isValidHuEvaluation(forced.evaluation) &&
        forced.threeMouthResolution.triggerSource === 'self-draw-an-gang-opportunity' &&
        forced.threeMouthResolution.triggerPlayerIndex === playerIndex &&
        forced.threeMouthResolution.forcedBasePattern === 'global-single-wait' &&
        forced.threeMouthResolution.payerPlayerIndex === active.payerPlayerIndex &&
        forced.threeMouthResolution.settlementMode === 'self-draw' &&
        isValidThreeMouthTransfers(
          forced.transfers,
          active.payerPlayerIndex,
          playerIndex,
          state.players.length,
        )
      ) {
        const candidate = {
          playerIndex,
          winningTile,
          concealedTiles,
          evaluation: forced.evaluation,
          threeMouthResolution: forced.threeMouthResolution,
          ...sourceDetails,
        };
        return isApplicableGangPackageSelfDraw(state, candidate) ? candidate : null;
      }
      return null;
    }
  }
  const evaluation = getRuleSet(state.ruleSetId).evaluateHu({
    source: 'self-draw',
    winnerPlayerIndex: playerIndex,
    playerCount: state.players.length,
    winningTile,
    concealedTiles,
    melds: player.melds,
    flowers: player.flowers,
    allMelds: state.players.flatMap((candidate) => candidate.melds),
    dealerIndex: state.dealerIndex,
    diHuDeclaration: diHuDeclarationFor(state, playerIndex) ?? undefined,
    ...sourceDetails,
  });
  if (!evaluation) return null;
  const candidate = { playerIndex, winningTile, concealedTiles, evaluation, ...sourceDetails };
  return isApplicableGangPackageSelfDraw(state, candidate) ? candidate : null;
}

function isApplicableGangPackageSelfDraw(
  state: GameState,
  candidate: ValidSelfDrawHuCandidate,
): boolean {
  const gangPackage = validGangPackageState(state);
  if (!gangPackage) return false;
  if (candidate.threeMouthResolution) return true;
  if (gangPackage.status === 'none') return true;
  if (
    candidate.playerIndex !== gangPackage.beneficiaryPlayerIndex ||
    candidate.playerIndex === gangPackage.payerPlayerIndex
  ) {
    return false;
  }
  const huaKai = candidate.evaluation.patterns.includes('hua-kai');
  const gangKai = candidate.evaluation.patterns.includes('gang-kai');
  if (huaKai === gangKai) return false;
  if (candidate.drawSource === 'flower-replacement') {
    return candidate.formedFlowerKongDuringReplacement ? gangKai : huaKai;
  }
  return (
    gangKai &&
    (candidate.drawSource === 'ming-gang-tail' ||
      candidate.drawSource === 'an-gang-tail' ||
      candidate.drawSource === 'bu-gang-tail')
  );
}

function isValidBaseSelfDrawTransfers(
  transfers: unknown,
  winnerPlayerIndex: number,
  playerCount: number,
): transfers is readonly ScoreTransfer[] {
  if (!Array.isArray(transfers) || transfers.length !== playerCount - 1) return false;
  const amounts = new Set<number>();
  const payers = new Set<number>();
  for (const transfer of transfers) {
    if (
      !isRecord(transfer) ||
      !hasOnlyKeys(transfer, ['fromPlayerIndex', 'toPlayerIndex', 'amount']) ||
      !isPlayerIndexValue(transfer.fromPlayerIndex, playerCount) ||
      transfer.fromPlayerIndex === winnerPlayerIndex ||
      payers.has(transfer.fromPlayerIndex) ||
      transfer.toPlayerIndex !== winnerPlayerIndex ||
      typeof transfer.amount !== 'number' ||
      !Number.isFinite(transfer.amount) ||
      !Number.isInteger(transfer.amount) ||
      transfer.amount <= 0
    ) {
      return false;
    }
    payers.add(transfer.fromPlayerIndex);
    amounts.add(transfer.amount);
  }
  return payers.size === playerCount - 1 && amounts.size === 1;
}

function isValidThreeMouthTransfers(
  transfers: unknown,
  payerPlayerIndex: number,
  winnerPlayerIndex: number,
  playerCount: number,
): transfers is readonly ScoreTransfer[] {
  if (!Array.isArray(transfers) || transfers.length !== playerCount - 1) return false;
  let amount: number | null = null;
  return transfers.every((transfer) => {
    if (
      !isValidScoreTransfer(transfer, playerCount) ||
      transfer.fromPlayerIndex !== payerPlayerIndex ||
      transfer.toPlayerIndex !== winnerPlayerIndex
    )
      return false;
    if (amount === null) amount = transfer.amount;
    return transfer.amount === amount;
  });
}

function sameThreeMouthResolution(
  left: ThreeMouthHuResolution,
  right: ThreeMouthHuResolution,
): boolean {
  return (
    left.triggerSource === right.triggerSource &&
    left.triggerPlayerIndex === right.triggerPlayerIndex &&
    left.settlementMode === right.settlementMode &&
    left.forcedBasePattern === right.forcedBasePattern &&
    left.payerPlayerIndex === right.payerPlayerIndex
  );
}

function sameHuEvaluation(left: HuEvaluation, right: HuEvaluation): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isSafeSelfDrawCandidateState(value: unknown, playerIndex: number): value is GameState {
  if (
    !isRecord(value) ||
    !Array.isArray(value.players) ||
    value.players.length !== SEATS.length ||
    typeof playerIndex !== 'number' ||
    !Number.isFinite(playerIndex) ||
    !Number.isInteger(playerIndex) ||
    playerIndex < 0 ||
    playerIndex >= value.players.length ||
    typeof value.currentPlayerIndex !== 'number' ||
    !Number.isFinite(value.currentPlayerIndex) ||
    !Number.isInteger(value.currentPlayerIndex) ||
    value.currentPlayerIndex < 0 ||
    value.currentPlayerIndex >= value.players.length ||
    value.currentPlayerIndex !== playerIndex ||
    value.ruleSetId !== 'nanjing-open' ||
    value.phase !== 'playing' ||
    value.turnStage !== 'waiting-for-discard' ||
    !isRecord(value.pendingAction) ||
    value.pendingAction.type !== 'discard' ||
    value.pendingAction.playerIndex !== playerIndex ||
    !Array.isArray(value.wall) ||
    !Array.isArray(value.pendingScoringEvents) ||
    !isRecord(value.handProgressFacts) ||
    !isNonNegativeInteger(value.handProgressFacts.selfDrawCount) ||
    !isNonNegativeInteger(value.handProgressFacts.gangKaiCount) ||
    !isNonNegativeInteger(value.handProgressFacts.packageSettlementCount)
  ) {
    return false;
  }
  if (value.diHuDeclarations !== undefined && !validDiHuDeclarationState(value)) return false;
  const player = value.players[playerIndex];
  if (
    !isRecord(player) ||
    value.pendingAction.seat !== player.seat ||
    !Array.isArray(player.hand) ||
    !Array.isArray(player.melds) ||
    !Array.isArray(player.flowers)
  ) {
    return false;
  }
  const reactionWindow = value.reactionWindow;
  return (
    reactionWindow == null ||
    (isRecord(reactionWindow) &&
      (reactionWindow.status === 'open' ||
        reactionWindow.status === 'awaiting-resolution' ||
        reactionWindow.status === 'closed') &&
      (reactionWindow.source === 'discard' || reactionWindow.source === 'bu-gang'))
  );
}

function isValidSelfDrawProvenance(
  value: unknown,
  playerCount: number,
): value is SelfDrawProvenance {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.playerIndex) ||
    typeof value.playerIndex !== 'number' ||
    value.playerIndex < 0 ||
    value.playerIndex >= playerCount ||
    typeof value.tileId !== 'string'
  )
    return false;
  if (value.source === 'flower-replacement') {
    return (
      hasOnlyKeys(value, [
        'playerIndex',
        'tileId',
        'source',
        'formedFlowerKongDuringReplacement',
      ]) && typeof value.formedFlowerKongDuringReplacement === 'boolean'
    );
  }
  return (
    hasOnlyKeys(value, ['playerIndex', 'tileId', 'source']) &&
    (value.source === 'initial-dealer' ||
      value.source === 'wall-head' ||
      value.source === 'ming-gang-tail' ||
      value.source === 'an-gang-tail' ||
      value.source === 'bu-gang-tail') &&
    value.formedFlowerKongDuringReplacement === undefined
  );
}

function hasValidHuEntities(players: readonly unknown[]): boolean {
  const entityIds: string[] = [];
  const meldIds: string[] = [];
  for (const [playerIndex, player] of players.entries()) {
    if (
      !isRecord(player) ||
      player.id !== playerIndex ||
      player.seat !== SEATS[playerIndex] ||
      !Array.isArray(player.hand) ||
      !player.hand.every(isValidOrdinaryTile) ||
      !Array.isArray(player.flowers) ||
      !player.flowers.every(isValidFlowerEntity) ||
      !Array.isArray(player.melds) ||
      !player.melds.every(
        (meld) =>
          isValidMeld(meld) && (meld.type === 'an-gang' || meld.fromPlayerIndex !== playerIndex),
      )
    )
      return false;
    entityIds.push(...player.hand.map((tile: OrdinaryHandTile) => tile.id));
    entityIds.push(...player.flowers.map((tile: FlowerTile) => tile.id));
    entityIds.push(
      ...player.melds.flatMap((meld: PlayerState['melds'][number]) =>
        meld.tiles.map((tile: OrdinaryHandTile) => tile.id),
      ),
    );
    meldIds.push(...player.melds.map((meld: PlayerState['melds'][number]) => meld.id));
  }
  return new Set(entityIds).size === entityIds.length && new Set(meldIds).size === meldIds.length;
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
  );
}

function isValidFlowerEntity(value: unknown): value is FlowerTile {
  if (!isRecord(value)) return false;
  if (value.flowerGroup === 'four-copy') {
    return (
      value.category === 'flower' &&
      FOUR_COPY_FLOWER_KINDS.some((flower) => flower === value.flower) &&
      FOUR_COPY_INDEXES.some((copy) => copy === value.copy) &&
      value.id === `flower-${String(value.flower)}-${String(value.copy)}`
    );
  }
  if (value.flowerGroup === 'plant') {
    return (
      value.category === 'flower' &&
      PLANT_FLOWER_KINDS.some((flower) => flower === value.flower) &&
      value.copy === 1 &&
      value.id === `flower-${String(value.flower)}-1`
    );
  }
  return (
    value.category === 'flower' &&
    value.flowerGroup === 'season' &&
    SEASON_FLOWER_KINDS.some((flower) => flower === value.flower) &&
    value.copy === 1 &&
    value.id === `season-${String(value.flower)}-1`
  );
}

function nextPlayerIndex(currentPlayerIndex: number): number {
  return (currentPlayerIndex + 1) % SEATS.length;
}

function isAnGangTurn(state: GameState, playerIndex: number): boolean {
  const player = state.players[playerIndex];
  const reactionWindow = state.reactionWindow;
  const followsMingGang =
    reactionWindow?.source === 'discard' &&
    reactionWindow?.status === 'closed' &&
    reactionWindow.responses.some((response) => response.type === 'ming-gang');
  const followsBuGang = reactionWindow?.source === 'bu-gang' && reactionWindow.status === 'closed';

  return (
    state.players.length === SEATS.length &&
    Number.isInteger(playerIndex) &&
    playerIndex >= 0 &&
    playerIndex < state.players.length &&
    playerIndex === state.currentPlayerIndex &&
    state.phase === 'playing' &&
    state.turnStage === 'waiting-for-discard' &&
    state.pendingAction.type === 'discard' &&
    state.pendingAction.playerIndex === playerIndex &&
    state.pendingAction.seat === player?.seat &&
    state.wall.length > 0 &&
    (reactionWindow === undefined || followsMingGang || followsBuGang)
  );
}

interface BuGangCandidate {
  readonly meld: PlayerState['melds'][number];
  readonly tile: OrdinaryHandTile;
}

function findBuGangCandidates(state: GameState, playerIndex: number): BuGangCandidate[] {
  if (!isBuGangTurn(state, playerIndex)) return [];
  const player = state.players[playerIndex];
  if (
    !player ||
    !Array.isArray(player.hand) ||
    !player.hand.every(isValidOrdinaryTile) ||
    !Array.isArray(player.buGangDrawProvenance) ||
    !player.buGangDrawProvenance.every(isValidBuGangDrawProvenance)
  ) {
    return [];
  }
  const entityIds = [
    ...player.hand.map((tile) => tile.id),
    ...player.melds.flatMap((meld) => meld.tiles.map((tile) => tile.id)),
  ];
  if (
    new Set(entityIds).size !== entityIds.length ||
    new Set(player.melds.map((meld) => meld.id)).size !== player.melds.length
  ) {
    return [];
  }

  const validPengs = player.melds.filter((meld) => isValidPengMeld(meld, playerIndex));
  const duplicateFaces = new Set<string>();
  const faceCounts = new Map<string, number>();
  for (const meld of player.melds.filter(
    (candidate) =>
      candidate.type === 'peng' &&
      candidate.tiles.length === 3 &&
      candidate.tiles.every(isValidOrdinaryTile) &&
      candidate.tiles[0] !== undefined &&
      candidate.tiles.every((tile) => isSameOrdinaryTileFace(tile, candidate.tiles[0]!)),
  )) {
    const first = meld.tiles[0];
    if (!first) continue;
    const key = ordinaryTileFaceKeyValue(ordinaryTileFace(first));
    faceCounts.set(key, (faceCounts.get(key) ?? 0) + 1);
    if ((faceCounts.get(key) ?? 0) > 1) duplicateFaces.add(key);
  }

  return validPengs
    .flatMap((meld): BuGangCandidate[] => {
      const first = meld.tiles[0];
      if (!first) return [];
      const key = ordinaryTileFaceKeyValue(ordinaryTileFace(first));
      if (duplicateFaces.has(key)) return [];
      const provenance = player.buGangDrawProvenance.filter(
        (candidate) => candidate.targetMeldId === meld.id,
      );
      if (provenance.length !== 1) return [];
      const matching = player.hand.filter(
        (tile) => tile.id === provenance[0]?.tileId && isSameOrdinaryTileFace(tile, first),
      );
      return matching.length === 1 ? [{ meld, tile: matching[0]! }] : [];
    })
    .sort((left, right) => left.meld.id.localeCompare(right.meld.id));
}

function addBuGangDrawProvenance(
  player: PlayerState,
  drawnTile: OrdinaryHandTile | null,
): PlayerState {
  if (!drawnTile) return player;
  const matchingPengs = player.melds.filter(
    (meld) =>
      isValidPengMeld(meld, player.id) &&
      meld.tiles[0] !== undefined &&
      isSameOrdinaryTileFace(meld.tiles[0], drawnTile),
  );
  if (matchingPengs.length !== 1) return player;
  return {
    ...player,
    buGangDrawProvenance: [
      ...player.buGangDrawProvenance.filter((candidate) => candidate.tileId !== drawnTile.id),
      { targetMeldId: matchingPengs[0]!.id, tileId: drawnTile.id },
    ],
  };
}

function newlyDrawnOrdinaryTile(
  initiallyDrawnTile: MahjongTile,
  resolution: DrawnTileResolutionResult,
): OrdinaryHandTile | null {
  if (isOrdinaryHandTile(initiallyDrawnTile)) return initiallyDrawnTile;
  return resolution.replacementTiles.at(-1) ?? null;
}

function isValidBuGangDrawProvenance(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.targetMeldId === 'string' &&
    value.targetMeldId.trim().length > 0 &&
    typeof value.tileId === 'string' &&
    value.tileId.trim().length > 0
  );
}

function isBuGangTurn(state: GameState, playerIndex: number): boolean {
  const player = state.players[playerIndex];
  const reactionWindow = state.reactionWindow;
  const followsMingGang =
    reactionWindow?.source === 'discard' &&
    reactionWindow.status === 'closed' &&
    reactionWindow.responses.some((response) => response.type === 'ming-gang');
  const followsBuGang = reactionWindow?.source === 'bu-gang' && reactionWindow.status === 'closed';
  return (
    state.players.length === SEATS.length &&
    Number.isInteger(playerIndex) &&
    playerIndex >= 0 &&
    playerIndex < state.players.length &&
    playerIndex === state.currentPlayerIndex &&
    state.phase === 'playing' &&
    state.turnStage === 'waiting-for-discard' &&
    state.pendingAction.type === 'discard' &&
    state.pendingAction.playerIndex === playerIndex &&
    state.pendingAction.seat === player?.seat &&
    state.wall.length > 0 &&
    (reactionWindow === undefined || followsMingGang || followsBuGang)
  );
}

function isValidPengMeld(meld: PlayerState['melds'][number], ownerPlayerIndex: number): boolean {
  return (
    meld.type === 'peng' &&
    typeof meld.id === 'string' &&
    meld.id.trim().length > 0 &&
    meld.tiles.length === 3 &&
    meld.tiles.every(isValidOrdinaryTile) &&
    new Set(meld.tiles.map((tile) => tile.id)).size === 3 &&
    meld.tiles[0] !== undefined &&
    meld.tiles.every((tile) => isSameOrdinaryTileFace(tile, meld.tiles[0]!)) &&
    typeof meld.claimedTileId === 'string' &&
    meld.tiles.some((tile) => tile.id === meld.claimedTileId) &&
    Number.isInteger(meld.fromPlayerIndex) &&
    (meld.fromPlayerIndex ?? -1) >= 0 &&
    (meld.fromPlayerIndex ?? SEATS.length) < SEATS.length &&
    meld.fromPlayerIndex !== ownerPlayerIndex
  );
}

function ordinaryTileFace(tile: OrdinaryHandTile): OrdinaryTileFace {
  return tile.category === 'number'
    ? { category: 'number', suit: tile.suit, rank: tile.rank }
    : { category: 'wind', wind: tile.wind };
}

function ordinaryTileFaceKeyValue(tileFace: OrdinaryTileFace): string {
  return tileFace.category === 'number'
    ? `${tileFace.suit}-${tileFace.rank}`
    : `wind-${tileFace.wind}`;
}

function copyHandResult(result: HandResult): HandResult {
  if (result.type === 'draw') return { ...result };
  if (result.source === 'self-draw') {
    return {
      ...result,
      winningTile: { ...result.winningTile },
      winner: {
        ...result.winner,
        evaluation: {
          ...result.winner.evaluation,
          patterns: [...result.winner.evaluation.patterns],
        },
      },
    };
  }
  return {
    ...result,
    winningTile: { ...result.winningTile },
    winners: result.winners.map((winner) => ({
      ...winner,
      evaluation: {
        ...winner.evaluation,
        patterns: [...winner.evaluation.patterns],
      },
    })),
  };
}

function isSameOrdinaryTileFaceValue(left: OrdinaryTileFace, right: OrdinaryTileFace): boolean {
  return left.category === 'number' && right.category === 'number'
    ? left.suit === right.suit && left.rank === right.rank
    : left.category === 'wind' && right.category === 'wind' && left.wind === right.wind;
}

function matchingAnGangTiles(
  hand: readonly OrdinaryHandTile[],
  tileFace: OrdinaryTileFace,
): OrdinaryHandTile[] {
  return hand.filter((tile) => isSameOrdinaryTileFaceValue(ordinaryTileFace(tile), tileFace));
}

function compareTilesById(left: OrdinaryHandTile, right: OrdinaryHandTile): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function compareOrdinaryTileFaces(left: OrdinaryTileFace, right: OrdinaryTileFace): number {
  const key = (tileFace: OrdinaryTileFace): number => {
    if (tileFace.category === 'wind') return 100 + WIND_TILE_KINDS.indexOf(tileFace.wind);
    return NUMBER_TILE_SUITS.indexOf(tileFace.suit) * 10 + tileFace.rank;
  };
  return key(left) - key(right);
}

function isValidOrdinaryTileFace(tileFace: unknown): tileFace is OrdinaryTileFace {
  if (!isRecord(tileFace)) return false;
  if (tileFace.category === 'number') {
    return (
      hasOnlyKeys(tileFace, ['category', 'suit', 'rank']) &&
      NUMBER_TILE_SUITS.some((suit) => suit === tileFace.suit) &&
      NUMBER_TILE_RANKS.some((rank) => rank === tileFace.rank)
    );
  }
  return (
    tileFace.category === 'wind' &&
    hasOnlyKeys(tileFace, ['category', 'wind']) &&
    WIND_TILE_KINDS.some((wind) => wind === tileFace.wind)
  );
}

function isValidOrdinaryTile(tile: unknown): tile is OrdinaryHandTile {
  if (!isRecord(tile) || !FOUR_COPY_INDEXES.some((copy) => copy === tile.copy)) return false;
  if (tile.category === 'number') {
    return (
      NUMBER_TILE_SUITS.some((suit) => suit === tile.suit) &&
      NUMBER_TILE_RANKS.some((rank) => rank === tile.rank) &&
      tile.id === `${tile.suit}-${tile.rank}-${tile.copy}`
    );
  }
  return (
    tile.category === 'wind' &&
    WIND_TILE_KINDS.some((wind) => wind === tile.wind) &&
    tile.id === `wind-${tile.wind}-${tile.copy}`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function createWallExhaustedResult(wall: TileWall): DrawTileFromWallResult {
  return {
    status: 'wall-exhausted',
    wall: createTileWall(wall.tiles),
  };
}

interface FlowerReplacementState {
  readonly wall: TileWall;
  readonly hand: OrdinaryHandTile[];
  readonly flowers: FlowerTile[];
  readonly newlyRevealedFlowers: FlowerTile[];
  readonly replacementTiles: OrdinaryHandTile[];
}

function drawReplacementTilesFromWall(
  state: FlowerReplacementState,
  replacementCount: number,
): FlowerReplacementResult {
  let wall = state.wall;
  const hand = [...state.hand];
  const flowers = [...state.flowers];
  const newlyRevealedFlowers = [...state.newlyRevealedFlowers];
  const replacementTiles = [...state.replacementTiles];
  let remainingReplacements = replacementCount;

  while (remainingReplacements > 0) {
    const drawResult = drawTileFromWallTail(wall);

    if (drawResult.status === 'wall-exhausted') {
      return {
        status: 'wall-exhausted',
        wall: drawResult.wall,
        hand,
        flowers,
        newlyRevealedFlowers,
        replacementTiles,
      };
    }

    wall = drawResult.wall;

    if (isFlowerTile(drawResult.tile)) {
      flowers.push(drawResult.tile);
      newlyRevealedFlowers.push(drawResult.tile);
      continue;
    }

    hand.push(drawResult.tile);
    replacementTiles.push(drawResult.tile);
    remainingReplacements -= 1;
  }

  return {
    status: 'complete',
    wall,
    hand,
    flowers,
    newlyRevealedFlowers,
    replacementTiles,
  };
}

function createNumberTiles(): NumberTile[] {
  const tiles: NumberTile[] = [];

  for (const suit of NUMBER_TILE_SUITS) {
    for (const rank of NUMBER_TILE_RANKS) {
      for (const copy of FOUR_COPY_INDEXES) {
        tiles.push({
          category: 'number',
          id: `${suit}-${rank}-${copy}`,
          suit,
          rank,
          copy,
        });
      }
    }
  }

  return tiles;
}

function createWindTiles(): WindTile[] {
  const tiles: WindTile[] = [];

  for (const wind of WIND_TILE_KINDS) {
    for (const copy of FOUR_COPY_INDEXES) {
      tiles.push({
        category: 'wind',
        id: `wind-${wind}-${copy}`,
        wind,
        copy,
      });
    }
  }

  return tiles;
}

function createFlowerTiles(): FlowerTile[] {
  const tiles: FlowerTile[] = [];

  for (const flower of FOUR_COPY_FLOWER_KINDS) {
    for (const copy of FOUR_COPY_INDEXES) {
      tiles.push({
        category: 'flower',
        id: `flower-${flower}-${copy}`,
        flowerGroup: 'four-copy',
        flower,
        copy,
      });
    }
  }

  for (const flower of PLANT_FLOWER_KINDS) {
    tiles.push({
      category: 'flower',
      id: `flower-${flower}-1`,
      flowerGroup: 'plant',
      flower,
      copy: 1,
    });
  }

  for (const flower of SEASON_FLOWER_KINDS) {
    tiles.push({
      category: 'flower',
      id: `season-${flower}-1`,
      flowerGroup: 'season',
      copy: 1,
      flower,
    });
  }

  return tiles;
}

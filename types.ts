
export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
  value: number; // 2-14
  id: string;
}

export type PassDirection = 'left' | 'right' | 'across' | 'none';

export type AiType = 'HAL' | 'GEM' | 'GPT52' | 'MIXED';

export interface Player {
  id: number;
  name: string;
  hand: Card[];
  isHuman: boolean;
  score: number;
  pointsThisRound: number;
  tricksWon: number;
  selectedToPass: string[]; // IDs delle carte selezionate per lo scambio
  scoreHistory: number[]; // Cronologia punti per mano
  aiType?: AiType; // Il tipo di AI specifico per questo giocatore
}

export interface GameConfig {
  playerName: string;
  aiType: AiType; // Configurazione globale (se MIXED, i player avranno tipi diversi)
  maxRounds: number;
  maxScore: number; // 50 o 100
  passSequenceName: 'DSC-' | 'DS-C'; // DSC- (Standard) o DS-C (Variante)
}

export interface GameState {
  players: Player[];
  currentTrick: { playerId: number; card: Card }[];
  turnIndex: number;
  leadSuit: Suit | null;
  heartsBroken: boolean;
  roundNumber: number;
  passDirection: PassDirection;
  gameStatus: 'setup' | 'dealing' | 'passing' | 'receiving' | 'playing' | 'scoring' | 'gameOver';
  winningMessage: string | null;
  receivedCards: Card[];
  config: GameConfig;
}

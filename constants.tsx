
import { Suit, Rank, Card } from './types';

export const SUITS: Suit[] = ['clubs', 'diamonds', 'spades', 'hearts'];
export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const getCardValue = (rank: Rank): number => {
  const values: Record<Rank, number> = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    'J': 11, 'Q': 12, 'K': 13, 'A': 14
  };
  return values[rank];
};

export const createDeck = (): Card[] => {
  const deck: Card[] = [];
  SUITS.forEach(suit => {
    RANKS.forEach(rank => {
      deck.push({
        suit,
        rank,
        value: getCardValue(rank),
        id: `${rank}-${suit}`
      });
    });
  });
  return deck;
};

export const shuffle = <T,>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

/**
 * Genera l'URL per l'immagine PNG della carta usando deckofcardsapi.com
 * Formato: https://deckofcardsapi.com/static/img/[RANK][SUIT].png
 * Rank: 2-9, 0 (per 10), J, Q, K, A
 * Suit: H, D, C, S
 */
export const getCardImageUrl = (card: Card): string => {
  const suitMap: Record<Suit, string> = {
    hearts: 'H',
    diamonds: 'D',
    clubs: 'C',
    spades: 'S'
  };
  
  // Fix: Explicitly type rankCode as string to allow '0' assignment which is not in Rank union
  let rankCode: string = card.rank;
  if (rankCode === '10') rankCode = '0'; // L'API usa '0' per il 10
  
  return `https://peppapp.lapeppa.com/img/${rankCode}${suitMap[card.suit]}.png`;
};

export const CARD_BACK_URL = 'https://peppapp.lapeppa.com/img/back.png';

export const getSuitSymbol = (suit: Suit) => {
  switch (suit) {
    case 'hearts': return '♥';
    case 'diamonds': return '♦';
    case 'clubs': return '♣';
    case 'spades': return '♠';
  }
};

export const getSuitColor = (suit: Suit) => {
  return (suit === 'hearts' || suit === 'diamonds') ? 'text-red-600' : 'text-slate-900';
};

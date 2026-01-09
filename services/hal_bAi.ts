
// hal_bAi.ts

import { Card, Rank, GameState } from '../types';

/**
 * Hal B - Improved Standard Logic
 * Ora rispetta anche lui la regola d'oro: Non passare i cuori bassi.
 */
export function getHalBPassthroughCards(hand: Card[]): string[] {
    if (hand.length <= 3) {
        return hand.map(card => card.id);
    }

    const cardScores: { [cardId: string]: number } = {};

    for (const card of hand) {
        let score = 0;

        // REGOLA FONDAMENTALE (anche per Hal B): Tieni i cuori bassi
        if (card.suit === 'hearts' && ['2', '3', '4', '5'].includes(card.rank)) {
            score = -500;
        } 
        // Q di Picche: Generalmente passala se non hai copertura, ma Hal B è prudente
        else if (card.suit === 'spades' && card.rank === 'Q') {
            score = 1000; // Priorità massima passaggio
        }
        else if (card.suit === 'hearts') {
            // Cuori alti via
            score = 500 + card.value;
        }
        else if (['A', 'K'].includes(card.rank) && card.suit === 'spades') {
            // A e K picche via se possibile
            score = 400; 
        } 
        else {
            // Carte alte generiche via
            score = card.value * 10;
            
            // Voiding: favorisci carte singole
            const sameSuitCount = hand.filter(c => c.suit === card.suit).length;
            if (sameSuitCount <= 2) score += 50;
        }
        
        cardScores[card.id] = score;
    }

    const sortedCards = [...hand].sort((a, b) => cardScores[b.id] - cardScores[a.id]);
    return sortedCards.slice(0, 3).map(card => card.id);
}

export function getHalBMove(gameState: GameState, botId: number): Card {
    const bot = gameState.players.find(p => p.id === botId);
    if (!bot || bot.hand.length === 0) throw new Error("Bot error");

    const hand = bot.hand;
    const trick = gameState.currentTrick;
    const leadSuit = gameState.leadSuit;
    const heartsBroken = gameState.heartsBroken;

    // 1. Legal Moves
    let legalMoves: Card[] = [];
    if (trick.length === 0) {
        if (!heartsBroken) {
            legalMoves = hand.filter(c => c.suit !== 'hearts');
            if (legalMoves.length === 0) legalMoves = hand;
        } else {
            legalMoves = hand;
        }
    } else {
        const suitCards = hand.filter(c => c.suit === leadSuit);
        legalMoves = suitCards.length > 0 ? suitCards : hand;
    }

    if (legalMoves.length === 1) return legalMoves[0];

    // 2. Hal B Strategy
    
    // SCARTO (No seme)
    if (trick.length > 0 && hand.filter(c => c.suit === leadSuit).length === 0) {
        const qSpade = legalMoves.find(c => c.suit === 'spades' && c.rank === 'Q');
        if (qSpade) return qSpade; // Via la Q

        const highHearts = legalMoves.filter(c => c.suit === 'hearts').sort((a,b) => b.value - a.value);
        if (highHearts.length > 0) return highHearts[0]; // Via cuori alti

        const highCards = [...legalMoves].sort((a, b) => b.value - a.value);
        return highCards[0]; // Via carichi
    }

    // FOLLOW
    if (trick.length > 0) {
        let currentWinnerVal = -1;
        trick.forEach(t => {
            if (t.card.suit === leadSuit && t.card.value > currentWinnerVal) currentWinnerVal = t.card.value;
        });

        const sortedMoves = [...legalMoves].sort((a, b) => b.value - a.value);
        
        // Cerca di stare sotto
        const safeCard = sortedMoves.find(c => c.value < currentWinnerVal);
        
        if (safeCard) {
            return safeCard;
        } else {
            // Se devi prendere
            // Cerca di non giocare la Q di picche se ti costringerebbe a prenderla tu stesso (raro in follow, ma possibile se lead è picche)
            // Hal B butta il carico più alto
            return sortedMoves[0]; 
        }
    }

    // LEAD
    // Hal B gioca basso e sicuro
    const safeLeads = legalMoves.filter(c => !(c.suit === 'spades' && ['Q', 'K', 'A'].includes(c.rank)));
    const candidates = safeLeads.length > 0 ? safeLeads : legalMoves;
    candidates.sort((a, b) => a.value - b.value);
    return candidates[0];
}

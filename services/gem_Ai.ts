
import { Card, GameState, Suit } from '../types';

/**
 * GEM AI - PEPPA SCIVOLOSA STRATEGY (DEBUG EDITION)
 * 
 * Strategia avanzata con logging in console per capire "cosa diavolo sta facendo il bot".
 * Correzioni:
 * - Mai guidare con la Q♠ (Peppa) a meno che non sia l'unica carta.
 * - Se esce A♠ o K♠ e ho la Peppa, DEVO giocarla.
 * - Gestione intelligente del +10 della presa vs penalità.
 */

// --- LOGGING UTILS ---
const LOG_PREFIX = (name: string) => `color: #0ea5e9; font-weight: bold; background: #0f172a; padding: 2px 4px; border-radius: 4px; border: 1px solid #0ea5e9;`;
const LOG_WARN = `color: #f59e0b; font-weight: bold;`;
const LOG_DANGER = `color: #ef4444; font-weight: bold; text-decoration: underline;`;
const LOG_SUCCESS = `color: #10b981; font-weight: bold;`;

// --- HELPERS DI GIOCO ---

const getCardName = (c: Card) => `${c.rank}${c.suit === 'hearts' ? '♥' : c.suit === 'diamonds' ? '♦' : c.suit === 'clubs' ? '♣' : '♠'}`;

// Quanto male fa questa carta se la prendo?
const getPenaltyPoints = (c: Card): number => {
    if (c.suit === 'spades' && c.rank === 'Q') return 26; // Disastro
    if (c.suit === 'hearts') return c.value; // Da 2 a 14
    return 0;
};

// Profitto netto della presa (+10 base - penalità)
const calculateTrickNetValue = (cards: Card[]): number => {
    const penalties = cards.reduce((sum, c) => sum + getPenaltyPoints(c), 0);
    return 10 - penalties;
};

const hasPeppa = (hand: Card[]) => hand.some(c => c.suit === 'spades' && c.rank === 'Q');
const countSuit = (hand: Card[], suit: Suit) => hand.filter(c => c.suit === suit).length;

// --- 1. LOGICA DI PASSAGGIO (SETUP) ---
export function getGemPass(hand: Card[]): string[] {
    console.groupCollapsed(`%c[GEM] Calcolo Passaggio`, "color: cyan");
    
    // Strategia: Tenere Assi/Re di Fiori/Quadri (Soldi). Via Peppa se non protetta. Via Cuori alti.
    // Via carte "medie" inutili.
    
    const spadesCount = countSuit(hand, 'spades');
    const haveProtection = hand.some(c => c.suit === 'spades' && (c.rank === 'K' || c.rank === 'A'));

    const scoredCards = hand.map(card => {
        let score = 0; 
        // Score alto = VOGLIO PASSARLA

        // Q♠
        if (card.suit === 'spades' && card.rank === 'Q') {
            // Se ho < 4 picche o nessuna protezione (A/K), è una bomba a mano. Via.
            if (spadesCount < 4 && !haveProtection) score += 10000;
            else score += 500; // Anche se protetta, è rischiosa
        }

        // A♠ / K♠
        else if (card.suit === 'spades' && (card.rank === 'A' || card.rank === 'K')) {
            // Se ho la Peppa, li tengo per proteggerla/incassarla io se serve.
            // Se NON ho la Peppa, sono calamite per la Peppa altrui. Via.
            if (hasPeppa(hand)) score -= 1000; 
            else score += 200;
        }

        // Cuori Alti (J, Q, K, A)
        else if (card.suit === 'hearts' && card.value >= 11) {
            score += card.value * 20; // Molto pericolosi
        }

        // Assi/Re di Fiori/Quadri
        else if ((card.suit === 'clubs' || card.suit === 'diamonds') && card.value >= 13) {
            score -= 2000; // TIENILI! Sono +10 punti quasi gratis.
        }

        // Carte inutili (7-8-9-10)
        else if (card.value >= 7 && card.value <= 10) {
            score += 100; // Buone da passare, non controllano nulla
        }

        // Paracadute (2, 3)
        else if (card.value <= 3) {
            score -= 500; // Tienili per duckare
        }

        return { id: card.id, score, name: getCardName(card) };
    });

    scoredCards.sort((a, b) => b.score - a.score);
    const toPass = scoredCards.slice(0, 3).map(sc => sc.id);
    
    console.log("Carte candidate al passaggio:", scoredCards.map(s => `${s.name}(${s.score})`).join(', '));
    console.log("Decisione:", toPass);
    console.groupEnd();

    return toPass;
}

// --- 2. LOGICA DI GIOCO (MOVE) ---
export function getGemMove(gameState: GameState, botId: number): Card {
    const bot = gameState.players.find(p => p.id === botId);
    if (!bot) throw new Error("Bot not found");
    const hand = bot.hand;
    const trick = gameState.currentTrick;
    const leadSuit = gameState.leadSuit;

    // Inizia il log
    console.groupCollapsed(`%c[GEM] ${bot.name} (Mossa)`, LOG_PREFIX(bot.name));
    console.log(`Mano residua: ${hand.map(getCardName).join(' ')}`);

    // --- A. FILTRO MOSSE LEGALI ---
    let legalMoves = hand;
    if (trick.length > 0 && leadSuit) {
        const following = hand.filter(c => c.suit === leadSuit);
        if (following.length > 0) legalMoves = following;
    }

    // Se mossa obbligata, esci subito
    if (legalMoves.length === 1) {
        console.log(`%cMossa obbligata: ${getCardName(legalMoves[0])}`, "color: #888");
        console.groupEnd();
        return legalMoves[0];
    }

    let choice: Card;

    // --- B. STRATEGIA: LEAD (Sono il primo) ---
    if (trick.length === 0) {
        console.log("-> Situazione: LEAD (Primo di mano)");

        // 1. MAI GUIDARE CON LA PEPPA SE HO ALTRE CARTE
        // Filtra via la Peppa dalle opzioni se possibile
        let safeLeads = legalMoves.filter(c => !(c.suit === 'spades' && c.rank === 'Q'));
        if (safeLeads.length === 0) safeLeads = legalMoves; // Ho solo la Peppa, amen

        // 2. MAI GUIDARE CON ASSO/RE DI PICCHE SE LA PEPPA È IN GIRO
        // Euristicamente assumiamo sia in giro se non è uscita
        if (!gameState.heartsBroken) { // Uso heartsBroken come proxy approssimativo per "fase iniziale"
             const safer = safeLeads.filter(c => !(c.suit === 'spades' && c.value >= 13));
             if (safer.length > 0) safeLeads = safer;
        }

        // 3. GUIDA CON CARICHI SICURI (A/K Fiori/Quadri)
        // Se ho A o K di semi sicuri, incasso i 10 punti.
        const moneyMakers = safeLeads.filter(c => 
            (c.suit === 'clubs' || c.suit === 'diamonds') && c.value >= 13
        ).sort((a,b) => b.value - a.value);

        if (moneyMakers.length > 0 && hand.length > 8) {
            console.log(`%c-> Strategia: Incasso punti facili (+10)`, LOG_SUCCESS);
            choice = moneyMakers[0];
        } 
        // 4. ALTRIMENTI GIOCA BASSO (SBLOCCO)
        else {
            // Preferisci sbloccare semi corti
            // Ordina per valore crescente
            safeLeads.sort((a, b) => a.value - b.value);
            console.log(`-> Strategia: Gioco basso per sicurezza`);
            choice = safeLeads[0];
        }
    } 

    // --- C. STRATEGIA: FOLLOW (Devo rispondere al seme) ---
    else if (trick.length > 0 && leadSuit && legalMoves.some(c => c.suit === leadSuit)) {
        console.log(`-> Situazione: FOLLOW (Seme: ${leadSuit})`);

        // Analisi tavolo
        let currentWinnerVal = -1;
        trick.forEach(t => {
            if (t.card.suit === leadSuit && t.card.value > currentWinnerVal) currentWinnerVal = t.card.value;
        });
        
        // C'è Asso o Re di Picche sul tavolo?
        const highSpadePlayed = leadSuit === 'spades' && currentWinnerVal >= 13;
        
        // Ho la Peppa?
        const myPeppa = legalMoves.find(c => c.suit === 'spades' && c.rank === 'Q');

        // REGOLA D'ORO: SE C'È ASSO/RE PICCHE E HO LA PEPPA, TIRALA!
        if (highSpadePlayed && myPeppa) {
            console.log(`%c-> OPPORTUNITÀ: SCARICO LA PEPPA SULL'ASSO/RE!`, LOG_SUCCESS);
            choice = myPeppa;
        } else {
            const trickNetValue = calculateTrickNetValue(trick.map(t => t.card));
            const winningMoves = legalMoves.filter(c => c.value > currentWinnerVal).sort((a,b) => a.value - b.value);
            const losingMoves = legalMoves.filter(c => c.value < currentWinnerVal).sort((a,b) => b.value - a.value);

            // Se la presa è "Buona" (+10 o +8) e non c'è rischio Peppa apparente
            if (trickNetValue >= 8 && leadSuit !== 'spades') {
                if (winningMoves.length > 0) {
                    console.log(`-> Strategia: Provo a vincere la presa pulita (${trickNetValue} pt)`);
                    choice = winningMoves[0]; // Vinco col minimo
                } else {
                    console.log(`-> Non posso vincere, gioco basso`);
                    choice = legalMoves.sort((a,b) => a.value - b.value)[0];
                }
            } else {
                // Presa brutta o rischiosa: DUCKING
                if (losingMoves.length > 0) {
                    console.log(`-> Strategia: DUCKING (Sto sotto)`);
                    choice = losingMoves[0]; // La più alta che sta sotto
                } else {
                    console.log(`%c-> ATTENZIONE: Costretto a vincere presa brutta`, LOG_WARN);
                    // Se devo vincere per forza, gioco la carta più alta che ho per togliermi un carico
                    // (Tanto la presa è persa, almeno mi libero di un K o A inutile)
                    choice = winningMoves[winningMoves.length - 1]; 
                }
            }
        }
    }

    // --- D. STRATEGIA: DISCARD (Non ho il seme) ---
    else {
        console.log(`-> Situazione: DISCARD (Via libera)`);
        
        // 1. SCARICA LA PEPPA (Priorità assoluta)
        const peppa = legalMoves.find(c => c.suit === 'spades' && c.rank === 'Q');
        if (peppa) {
            console.log(`%c-> SCARICO LA PEPPA!`, LOG_DANGER);
            choice = peppa;
        } 
        // 2. SCARICA ASSO/RE DI CUORI (Priorità alta)
        else {
            const dangerousHearts = legalMoves.filter(c => c.suit === 'hearts' && c.value >= 12).sort((a,b) => b.value - a.value);
            if (dangerousHearts.length > 0) {
                console.log(`-> Scarico Cuori alto`);
                choice = dangerousHearts[0];
            } 
            // 3. SCARICA CARICHI INUTILI (Carte alte non vincenti)
            else {
                console.log(`-> Scarico carico generico`);
                choice = [...legalMoves].sort((a,b) => b.value - a.value)[0];
            }
        }
    }

    console.log(`%cScelta finale: ${getCardName(choice)}`, "font-weight: bold; background: #ddd; color: black; padding: 2px;");
    console.groupEnd();
    return choice;
}

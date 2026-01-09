
import { Card, GameState, Rank } from '../types';

/**
 * chatGPT 5.2 — LA PEPPA (Peppa Scivolosa)
 *
 * Principi cardine (NON Hearts):
 * - Ogni presa vinta vale +10. Quindi le prese "pulite" sono profitto puro.
 * - Penalità solo su Cuori (–valore nominale) e Peppa Q♠ (–26).
 * - Nessuna restrizione: si può uscire a Cuori subito, si può scartare Cuori/Peppa appena si è void.
 * - Strategia = massimizzare valore netto e gestire controllo nel tempo (13 prese):
 *   1) Prendere prese pulite quando il rischio di "avvelenamento" è basso (inizio mano).
 *   2) Duckare con 2-3-4 per evitare di vincere prese sporche, e per liberarsi di carte pericolose in sicurezza.
 *   3) Usare A/K (soprattutto ♦♣) per comandare prese pulite e per riprendere la mano.
 *   4) Gestire i Cuori: se ne hai pochi, spesso conviene scaricare PRIMA gli alti (es. J♥) e tenere il basso (5♥) come carta di sicurezza per duck in seguito.
 *   5) Cappotto: non è “avere cuori in mano”, è avere CONTROLLO (seme lungo + ingressi + onori) per vincere quasi tutto e catturare i punti negativi.
 *   6) Anti-cappotto: se percepisci qualcuno “in controllo”, a volte conviene fargli prendere almeno un Cuore o la Peppa.
 */

// -----------------------------
// Memoria (semplice, robusta)
// -----------------------------
type PeppaMemory = {
  handId: number;
  seenIds: Set<string>;
  seenBySuit: Record<string, Set<string>>; // rank per suit
  seenPeppa: boolean;
  seenHeartsCount: number;
  seenAces: Record<string, boolean>; // suit -> A seen
  seenKings: Record<string, boolean>; // suit -> K seen
  // Stima "dominanza" avversaria (se GameState la espone)
  lastTrickWinnerId?: number;
  streakWinnerId?: number;
  streakCount: number;
};

const MEM: PeppaMemory = {
  handId: 0,
  seenIds: new Set(),
  seenBySuit: {
    hearts: new Set(),
    spades: new Set(),
    diamonds: new Set(),
    clubs: new Set(),
  },
  seenPeppa: false,
  seenHeartsCount: 0,
  seenAces: { hearts: false, spades: false, diamonds: false, clubs: false },
  seenKings: { hearts: false, spades: false, diamonds: false, clubs: false },
  streakWinnerId: undefined,
  lastTrickWinnerId: undefined,
  streakCount: 0,
};

function resetMemoryForNewHand() {
  MEM.handId += 1;
  MEM.seenIds = new Set();
  MEM.seenBySuit = {
    hearts: new Set(),
    spades: new Set(),
    diamonds: new Set(),
    clubs: new Set(),
  };
  MEM.seenPeppa = false;
  MEM.seenHeartsCount: 0;
  MEM.seenAces = { hearts: false, spades: false, diamonds: false, clubs: false };
  MEM.seenKings = { hearts: false, spades: false, diamonds: false, clubs: false };
  MEM.lastTrickWinnerId = undefined;
  MEM.streakWinnerId = undefined;
  MEM.streakCount = 0;
}

function noteSeen(card: Card) {
  if (MEM.seenIds.has(card.id)) return;
  MEM.seenIds.add(card.id);
  MEM.seenBySuit[card.suit]?.add(card.rank);

  if (card.suit === 'hearts') MEM.seenHeartsCount += 1;
  if (card.suit === 'spades' && card.rank === 'Q') MEM.seenPeppa = true;
  if (card.rank === 'A') MEM.seenAces[card.suit] = true;
  if (card.rank === 'K') MEM.seenKings[card.suit] = true;
}

// Prova a leggere storico prese se esiste, senza dipendenze forti dal tuo schema
function updateMemoryFromGameState(gameState: GameState) {
  // always current trick
  gameState.currentTrick?.forEach(t => noteSeen(t.card));

  const anyState = gameState as any;

  const candidateHistories: any[] = [];
  if (Array.isArray(anyState.trickHistory)) candidateHistories.push(anyState.trickHistory);
  if (Array.isArray(anyState.completedTricks)) candidateHistories.push(anyState.completedTricks);
  if (Array.isArray(anyState.tricks)) candidateHistories.push(anyState.tricks);

  // ogni "trick" potrebbe essere: [{playerId, card}] oppure {plays:[...], winnerId:...}
  for (const hist of candidateHistories) {
    for (const tr of hist) {
      const plays = Array.isArray(tr) ? tr : (tr?.plays ?? tr?.trick ?? tr?.cards ?? []);
      if (Array.isArray(plays)) {
        plays.forEach((p: any) => {
          const c = p?.card ?? p;
          if (c?.id) noteSeen(c as Card);
        });
      }
      // stima streak winner (se il winnerId esiste)
      const winnerId = tr?.winnerId;
      if (typeof winnerId === 'number') {
        MEM.lastTrickWinnerId = winnerId;
        if (MEM.streakWinnerId === winnerId) MEM.streakCount += 1;
        else {
          MEM.streakWinnerId = winnerId;
          MEM.streakCount = 1;
        }
      }
    }
  }
}

// -----------------------------
// Punteggi e utilità
// -----------------------------
const heartPenalty = (card: Card): number => (card.suit === 'hearts' ? -card.value : 0);
const peppaPenalty = (card: Card): number => (card.suit === 'spades' && card.rank === 'Q' ? -26 : 0);
const cardPenalty = (card: Card): number => heartPenalty(card) + peppaPenalty(card);

const netValueOfTrickCards = (cards: Card[]): number => {
  const pen = cards.reduce((s, c) => s + cardPenalty(c), 0);
  return 10 + pen;
};

// Rischio "avvelenamento" crescente con avanzare della mano:
// più carte già uscite => più probabilità che qualcuno sia void e scarichi Cuori/Peppa.
const poisonRisk = (handSize: number): number => {
  if (handSize >= 11) return 0.15;
  if (handSize >= 8) return 0.35;
  if (handSize >= 5) return 0.60;
  return 0.85;
};

const suitCounts = (hand: Card[]) => {
  const c = { hearts: 0, spades: 0, diamonds: 0, clubs: 0 } as Record<Card['suit'], number>;
  hand.forEach(x => (c[x.suit] += 1));
  return c;
};

const hasCard = (hand: Card[], suit: Card['suit'], rank: Rank) => hand.some(c => c.suit === suit && c.rank === rank);

const isLowDucker = (c: Card) => c.value <= 4; // 2-3-4 strumenti chiave
const isDangerMid = (c: Card) => c.value >= 7 && c.value <= 11; // 7..J spesso "incastrano" perché vincono prese indesiderate
const isHighControl = (c: Card) => c.rank === 'A' || c.rank === 'K';
const isPeppa = (c: Card) => c.suit === 'spades' && c.rank === 'Q';

// -----------------------------
// Valutazione Cappotto / Anti-cappotto
// -----------------------------
type Plan = 'normal' | 'cappotto' | 'antiCappotto';

function evaluatePlan(hand: Card[], gameState?: GameState): Plan {
  // euristica: cappotto = controllo forte (seme lungo + onori + ingressi)
  const counts = suitCounts(hand);
  const longestSuit = (Object.keys(counts) as Card['suit'][]).sort((a, b) => counts[b] - counts[a])[0];
  const L = counts[longestSuit];

  const honors = hand.filter(c => c.value >= 12).length; // Q,K,A
  const topControls = hand.filter(c => c.rank === 'A' || c.rank === 'K').length;

  // ingressi extra: A/K fuori dal seme lungo (per riprendere la mano se perdi lead)
  const entriesOutside = hand.filter(c => (c.rank === 'A' || c.rank === 'K') && c.suit !== longestSuit).length;

  const hasVeryLongSuit = L >= 7;
  const hasStrongControls = (topControls >= 3) && (honors >= 4);
  const hasEntries = entriesOutside >= 1;

  if (hasVeryLongSuit && hasStrongControls && hasEntries) return 'cappotto';

  // anti-cappotto: se abbiamo segnali che qualcuno sta dominando (streak) e noi possiamo sabotare
  if (gameState) {
    const anyState = gameState as any;
    const streak = MEM.streakCount;
    // se qualcuno ha vinto 3+ prese consecutive spesso significa controllo (specie a metà mano)
    if (streak >= 3) return 'antiCappotto';
    // se il GameState espone un contatore prese per player, usalo:
    const players = anyState.players;
    if (Array.isArray(players)) {
      const maxTaken = Math.max(...players.map((p: any) => (p.tricksTaken ?? p.tricksWon ?? 0)));
      if (maxTaken >= 6) return 'antiCappotto';
    }
  }

  return 'normal';
}

// -----------------------------
// PASS: nuova strategia Peppa
// -----------------------------
const getPassScore = (card: Card, hand: Card[], plan: Plan): number => {
  const counts = suitCounts(hand);
  let score = 0;

  const peppaInHand = isPeppa(card);
  const lowDuck = isLowDucker(card);

  // 1) 2-3-4 sono oro: NON passarli quasi mai
  if (lowDuck) score -= 300;

  // 2) A/K di ♦♣ sono importantissimi per fare prese pulite e riprendere mano
  if ((card.suit === 'diamonds' || card.suit === 'clubs') && (card.rank === 'A' || card.rank === 'K')) {
    score -= 260;
  }

  // 3) Q♠: in normale/anti-cappotto è quasi sempre da passare (tossica)
  if (peppaInHand) {
    if (plan === 'cappotto') score -= 120; // se tenti cappotto, tenerla può essere utile (la devi comunque catturare, tenerla evita che giri)
    else score += 900;
  }

  // 4) Cuori: in normale/anti: passa gli alti (pericolosissimi), in cappotto tienili
  if (card.suit === 'hearts') {
    if (plan === 'cappotto') {
      score -= 80; // li vuoi catturare tu
    } else {
      // più alto = più tossico
      score += 120 + card.value * 18;
    }
  }

  // 5) Carte “mid” 7..J: spesso vincono prese che non vuoi. Buone candidate da passare
  if (isDangerMid(card)) score += 120;

  // 6) Gestione svuotamento semi (bridge-like):
  // diventare void in un seme aumenta la capacità di scaricare Cuori/Peppa su prese altrui.
  // Quindi se hai 1-2 carte in un seme (non ♦♣ con A/K), passare quelle aiuta.
  const cnt = counts[card.suit];
  const suitIsShort = cnt <= 2;

  const protectedShort =
    (card.suit === 'diamonds' || card.suit === 'clubs') && (card.rank === 'A' || card.rank === 'K');

  if (suitIsShort && !protectedShort && card.suit !== 'hearts') {
    score += 90;
    // se è carta alta in seme corto, è ancora più “trappola”
    if (card.value >= 12) score += 60;
  }

  // 7) Picche A/K: utili ma condizionali. Se hai poche picche, possono diventare trappola a fine mano.
  if (card.suit === 'spades' && (card.rank === 'A' || card.rank === 'K')) {
    if (counts.spades <= 2 && plan !== 'cappotto') score += 80; // rischio trappola
    else score -= 40; // controllo utile
  }

  // 8) In cappotto, vuoi conservare onori e seme lungo: passa roba “inutile”
  if (plan === 'cappotto') {
    if (isDangerMid(card)) score += 40; // ok passarle
    // ma evita di smontare il seme lungo se la carta è in quel seme (gestito implicitamente: non premio svuotamento in cappotto)
    if (counts[card.suit] >= 7) score -= 40;
  }

  return score;
};

export function getGPT52Pass(hand: Card[]): string[] {
  console.log("%c[GPT-5.2] Calcolo carte da passare...", "color: #a78bfa; font-weight: bold;");

  // nuova mano: hand = 13 carte => reset memoria
  if (hand.length === 13) resetMemoryForNewHand();

  const plan = evaluatePlan(hand);
  const scoredCards = hand.map(c => ({
    id: c.id,
    score: getPassScore(c, hand, plan),
  }));

  scoredCards.sort((a, b) => b.score - a.score);
  return scoredCards.slice(0, 3).map(sc => sc.id);
}

// -----------------------------
// MOVE: pianificazione Peppa sulle 13 prese
// -----------------------------
export function getGPT52Move(gameState: GameState, botId: number): Card {
  updateMemoryFromGameState(gameState);

  const bot = gameState.players.find(p => p.id === botId);
  if (!bot) throw new Error("Bot not found");

  const hand = bot.hand;
  const trick = gameState.currentTrick;
  const leadSuit = gameState.leadSuit;

  // Reset a inizio mano se serve (più robusto: se tornano a 13 carte)
  if (hand.length === 13) resetMemoryForNewHand();

  const plan = evaluatePlan(hand, gameState);
  const risk = poisonRisk(hand.length);
  const counts = suitCounts(hand);

  // Legal moves
  let legalMoves = hand;
  if (trick.length > 0 && leadSuit) {
    const following = hand.filter(c => c.suit === leadSuit);
    if (following.length > 0) legalMoves = following;
  }

  if (legalMoves.length === 1) return legalMoves[0];

  const asc = (a: Card, b: Card) => a.value - b.value;
  const desc = (a: Card, b: Card) => b.value - a.value;

  const peppaInHand = hand.find(c => isPeppa(c));

  // Funzione: stima se la presa corrente è "buona da prendere"
  const currentTrickCards = trick.map(t => t.card);
  const currentNet = netValueOfTrickCards(currentTrickCards);

  // Vince attuale sul seme
  const currentWinningValue = (() => {
    if (!leadSuit || trick.length === 0) return -1;
    let maxVal = -1;
    trick.forEach(t => {
      if (t.card.suit === leadSuit && t.card.value > maxVal) maxVal = t.card.value;
    });
    return maxVal;
  })();

  const canFollow = trick.length > 0 && leadSuit && legalMoves.some(c => c.suit === leadSuit);

  // ---------------------------------------
  // LEAD (inizio presa): “bridge-like control”
  // ---------------------------------------
  if (trick.length === 0) {
    console.log("%c[GPT-5.2] Thinking Lead...", "color: #a78bfa");
    // Identifica seme lungo e seme “di profitto pulito”
    const suits: Card['suit'][] = ['clubs', 'diamonds', 'spades', 'hearts'];
    const longestSuit = suits.sort((a, b) => counts[b] - counts[a])[0];

    // In cappotto: vuoi controllo + tirare fuori carte, e poi “incassare”
    if (plan === 'cappotto') {
      // 1) Se hai un seme lungo NON-cuori, spesso conviene stabilirlo subito:
      //    guida alto (A/K/Q) nel seme lungo per forzare fuori gli onori mancanti.
      const longSuitCards = hand.filter(c => c.suit === longestSuit).sort(desc);

      const topLong = longSuitCards.find(c => c.value >= 12);
      if (topLong) return topLong;

      // 2) Se il seme lungo non ha onori, usa un ingresso (A/K ♦♣) per mantenere mano
      const entry = hand
        .filter(c => (c.suit === 'clubs' || c.suit === 'diamonds') && (c.rank === 'A' || c.rank === 'K'))
        .sort(desc)[0];
      if (entry) return entry;

      // 3) Se sei già “in controllo”, guida Cuori per tirarli dentro (cappotto richiede prenderli tutti)
      const hearts = hand.filter(c => c.suit === 'hearts').sort(desc);
      if (hearts.length > 0) return hearts[0];

      // fallback: carta più alta
      return [...legalMoves].sort(desc)[0];
    }

    // In normale/anti:
    // Obiettivo: prendere prese pulite presto (rischio basso), evitare di diventare “cestino” a fine mano.
    // 1) Se rischio basso: usa A/K ♦♣ per incassare +10 pulito e mantenere iniziativa.
    if (risk <= 0.35) {
      const cash = hand
        .filter(c => (c.suit === 'clubs' || c.suit === 'diamonds') && (c.rank === 'A' || c.rank === 'K'))
        .sort(desc)[0];
      if (cash) return cash;
    }

    // 2) Se vuoi creare void: guida dal seme in cui sei corto (non cuori), giocando la carta più bassa per “svuotarlo”
    const shortSuits = (['clubs', 'diamonds', 'spades'] as Card['suit'][]).filter(s => counts[s] <= 2);
    if (shortSuits.length > 0) {
      const s = shortSuits.sort((a, b) => counts[a] - counts[b])[0];
      const low = hand.filter(c => c.suit === s).sort(asc)[0];
      if (low) return low;
    }

    // 3) Evita di guidare Cuori se non stai facendo cappotto (perché puoi finire a prendere penalità senza bisogno)
    // 4) Evita di guidare mid (7..J) se possibile: sono trappole.
    const nonHearts = legalMoves.filter(c => c.suit !== 'hearts');
    const nonTrap = nonHearts.filter(c => !isDangerMid(c));
    if (nonTrap.length > 0) return nonTrap.sort(asc)[0];

    // 5) Se proprio devi: guida la più bassa possibile (riduce rischio di catturare penalità)
    return [...legalMoves].sort(asc)[0];
  }

  // ---------------------------------------
  // FOLLOW (seguo il seme): scelta win/duck con pianificazione
  // ---------------------------------------
  if (canFollow && leadSuit) {
    console.log("%c[GPT-5.2] Thinking Follow...", "color: #a78bfa");
    const sortedAsc = [...legalMoves].sort(asc);
    const sortedDesc = [...legalMoves].sort(desc);

    const winning = sortedAsc.find(c => c.value > currentWinningValue);
    const duckHigh = sortedDesc.find(c => c.value < currentWinningValue);

    // Regola Peppa: prendere è buono se la presa è nettamente positiva
    // Nota: una presa con 2♥ vale comunque +8 netti (buona).
    // Soglia dinamica: più siamo a fine mano, più è pericoloso prendere perché può arrivare "veleno" più spesso nelle prese future,
    // ma la presa corrente ha già il suo contenuto (non può peggiorare).
    const takeIfNetAtLeast = risk >= 0.6 ? 6 : 8; // più avanti: anche +6 può essere ok
    const shouldTake = (plan === 'cappotto') ? true : (currentNet >= takeIfNetAtLeast);

    if (shouldTake) {
      // vinco col minimo necessario (stile bridge): preservo onori e controllo futuro
      if (winning) return winning;
      // non posso vincere: butto la più bassa (conservo carte alte per prese pulite future)
      return sortedAsc[0];
    } else {
      // ducking: se posso, gioco la più alta sotto (massimo controllo e “ripulisco” mano dalle trappole)
      if (duckHigh) return duckHigh;

      // costretto a vincere: vinco col minimo (evita bruciare A/K inutilmente)
      if (winning) return winning;
      return sortedAsc[0];
    }
  }

  // ---------------------------------------
  // DISCARD (sono void): qui si vince la Peppa
  // ---------------------------------------
  // Se non posso seguire, decido cosa “scaricare” pensando alle prese successive:
  // - in normale/anti: scarico prima tossici (Q♠, cuori alti), poi trappole mid.
  // - in cappotto: NON scarico tossici (li voglio catturare io), scarico invece carte che possono rompere il controllo.

  console.log("%c[GPT-5.2] Thinking Discard...", "color: #a78bfa");
  const sortedDesc = [...legalMoves].sort(desc);

  if (plan === 'cappotto') {
    // Mantieni Cuori e Peppa (li vuoi prendere tu a fine conto).
    // Scarica invece: trappole mid o alte non-funzionali (specie in semi corti).
    const nonHeartsNonPeppa = legalMoves.filter(c => c.suit !== 'hearts' && !isPeppa(c));
    const dumpMid = nonHeartsNonPeppa.filter(isDangerMid).sort(desc)[0];
    if (dumpMid) return dumpMid;

    const dumpHigh = nonHeartsNonPeppa.filter(c => c.value >= 12 && !isHighControl(c)).sort(desc)[0];
    if (dumpHigh) return dumpHigh;

    return (nonHeartsNonPeppa.sort(desc)[0] ?? sortedDesc[0]);
  }

  // anti-cappotto: se qualcuno sta dominando, avvelenarlo è spesso corretto
  const dominantWinnerId = MEM.streakWinnerId;
  const dominantStreak = MEM.streakCount;

  const wantPoisonSomeone =
    (plan === 'antiCappotto' && dominantWinnerId !== undefined && dominantStreak >= 3);

  // 1) Scarica Peppa Q♠ quasi sempre subito.
  //    Eccezione: se vuoi “avvelenare” un dominatore e hai anche cuori alti, puoi scegliere cuori altissimi prima
  //    SOLO se Q♠ ti serve come minaccia successiva. In pratica: quasi sempre Q♠ subito.
  const peppa = legalMoves.find(c => isPeppa(c));
  if (peppa) return peppa;

  // 2) Gestione Cuori con pianificazione:
  //    - se ho POCHI cuori (<=3), preferisco liberarmi PRIMA dell'alto e tenere il basso per duck futuro.
  //      (Esempio richiesto: J♥ e 5♥ -> scarico J♥ prima.)
  const hearts = legalMoves.filter(c => c.suit === 'hearts').sort(desc);
  if (hearts.length > 0) {
    // se pochi cuori: butta il più alto
    if (counts.hearts <= 3) return hearts[0];
    // se tanti cuori: anche qui spesso butti alto, perché è sempre più tossico
    return hearts[0];
  }

  // 3) Trappole mid (7..J): scaricale per non vincere prese indesiderate più avanti
  const mid = legalMoves.filter(isDangerMid).sort(desc)[0];
  if (mid) return mid;

  // 4) Se ho A/K♠ e rischio alto, possono diventare trappola: scarica K♠ prima di A♠ se puoi (mantieni A come “ultima risorsa”)
  const highSpades = legalMoves
    .filter(c => c.suit === 'spades' && (c.rank === 'A' || c.rank === 'K'))
    .sort((a, b) => a.value - b.value); // K(13) prima di A(14)
  if (risk >= 0.6 && highSpades.length > 0) return highSpades[0];

  // 5) Altrimenti scarica la più alta (riduce rischio di catturare prese a fine mano)
  return sortedDesc[0];
}

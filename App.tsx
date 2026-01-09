
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { GameState, Card, Player, PassDirection, GameConfig, AiType } from './types';
import { createDeck, shuffle } from './constants';
import { getGemPass, getGemMove } from './services/gem_Ai';
import { getHalBPassthroughCards, getHalBMove } from './services/hal_bAi';
import { getGPT52Pass, getGPT52Move } from './services/GPT52';
import PlayingCard from './components/PlayingCard';
import TimeBar from './components/TimeBar';

const USER_TURN_TIME = 40;
// Impostato a 20s totali: 1s ritardo iniziale + 20s timeout API + 4s margine visivo
const BOT_MAX_TIME = 20; 
const ATTESA = 2000; // ms

const AI_NAMES = [
  "Eto Demerzel", "Bomb #20", "HAL 9000", "Joshua WOPR", 
  "MU‑TH‑UR 6000", "Skynet", "Nexus‑6", "GERTY", 
  "Robbie", "SAM-104", "T‑800", "Roy Batty"
];

const DEFAULT_CONFIG: GameConfig = {
  playerName: 'Charlie Bartom',
  aiType: 'HAL', // DEFAULT: Hal_B (Offline)
  maxRounds: 8,
  maxScore: 100,
  passSequenceName: 'DSC-'
};

const App: React.FC = () => {
  const botNames = useMemo(() => shuffle([...AI_NAMES]).slice(0, 3), []);
  // Mazziere iniziale casuale
  // Fix: added explicit type to ensure it is treated as a number
  const [dealerOffset] = useState<number>(() => Math.floor(Math.random() * 4));

  const [gameState, setGameState] = useState<GameState>({
    players: [], // Inizializzati nel setup
    currentTrick: [],
    turnIndex: 0,
    leadSuit: null,
    heartsBroken: false,
    roundNumber: 1,
    passDirection: 'right',
    gameStatus: 'setup',
    winningMessage: null,
    receivedCards: [],
    config: DEFAULT_CONFIG
  });

  const [timeLeft, setTimeLeft] = useState(USER_TURN_TIME);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastWinnerId, setLastWinnerId] = useState<number | null>(null);
  
  // Stato temporaneo per il form di setup
  const [tempConfig, setTempConfig] = useState<GameConfig>(DEFAULT_CONFIG);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Inizializza i giocatori quando inizia il gioco vero e proprio
  const initializeGame = () => {
    
    // Determina le AI per i 3 bot
    let assignedAis: AiType[] = [];
    if (tempConfig.aiType === 'MIXED') {
        // Mischia le 3 AI disponibili
        assignedAis = shuffle(['HAL', 'GEM', 'GPT52'] as AiType[]);
    } else {
        // Assegna a tutti la stessa AI scelta
        assignedAis = [tempConfig.aiType, tempConfig.aiType, tempConfig.aiType];
    }

    const initialPlayers: Player[] = [
      { id: 0, name: tempConfig.playerName || 'Giocatore', hand: [], isHuman: true, score: 0, pointsThisRound: 0, tricksWon: 0, selectedToPass: [], scoreHistory: [] },
      { id: 1, name: botNames[0], hand: [], isHuman: false, score: 0, pointsThisRound: 0, tricksWon: 0, selectedToPass: [], scoreHistory: [], aiType: assignedAis[0] },
      { id: 2, name: botNames[1], hand: [], isHuman: false, score: 0, pointsThisRound: 0, tricksWon: 0, selectedToPass: [], scoreHistory: [], aiType: assignedAis[1] },
      { id: 3, name: botNames[2], hand: [], isHuman: false, score: 0, pointsThisRound: 0, tricksWon: 0, selectedToPass: [], scoreHistory: [], aiType: assignedAis[2] },
    ];

    setGameState(prev => ({
      ...prev,
      players: initialPlayers,
      config: tempConfig,
      gameStatus: 'dealing',
      passDirection: 'right' // Round 1 è sempre right
    }));
  };

  // Helper centralizzato per calcolare la direzione di passaggio
  const calculatePassDirection = useCallback((round: number) => {
    const seq = gameState.config.passSequenceName;
    // Fix: explicitly cast round to number for arithmetic operations
    const cycle = (Number(round) - 1) % 4;
    const map = seq === 'DSC-' 
        ? ['right', 'left', 'across', 'none'] 
        : ['right', 'left', 'none', 'across'];
    return map[cycle] as PassDirection;
  }, [gameState.config.passSequenceName]);

  // Calcolo dinamico del Mazziere e del Primo di Mano
  // Fix: explicitly cast values to number to satisfy arithmetic constraints
  const dealerIndex = (Number(gameState.roundNumber) - 1 + Number(dealerOffset)) % 4;
  const isUserDealer = dealerIndex === 0;
  const startingPlayerIndex = (Number(gameState.roundNumber) + Number(dealerOffset)) % 4;

  const getRank = (playerId: number) => {
    if (gameState.players.length === 0) return 1;
    const isScoring = gameState.gameStatus === 'scoring' || gameState.gameStatus === 'gameOver';
    // Fix: explicitly cast properties to Number to avoid type errors in arithmetic/sorting
    const scores = gameState.players.map(p => Number(p.score) + (isScoring ? Number(p.pointsThisRound) : 0));
    const sortedScores = [...new Set(scores)].sort((a, b) => Number(b) - Number(a));
    const player = gameState.players.find(p => p.id === playerId)!;
    const scoreToCompare = Number(player.score) + (isScoring ? Number(player.pointsThisRound) : 0);
    return sortedScores.indexOf(scoreToCompare) + 1;
  };

  const playCard = useCallback((playerId: number, card: Card) => {
    setGameState(prev => {
      if (prev.currentTrick.some(t => t.playerId === playerId)) return prev;
      if (prev.turnIndex !== playerId) return prev;
      const isLead = prev.currentTrick.length === 0;
      const nextPlayers = prev.players.map(p => 
        p.id === playerId ? { ...p, hand: p.hand.filter(c => c.id !== card.id) } : p
      );
      return {
        ...prev,
        players: nextPlayers,
        currentTrick: [...prev.currentTrick, { playerId, card }],
        turnIndex: (prev.turnIndex + 1) % 4,
        leadSuit: isLead ? card.suit : prev.leadSuit,
        heartsBroken: prev.heartsBroken || card.suit === 'hearts'
      };
    });
  }, []);

  // --- GESTIONE MOSSE BOT (PASSAGGIO) ---
  useEffect(() => {
    if (gameState.gameStatus === 'passing') {
      if (gameState.passDirection === 'none') return;
      
      const botsWithoutPass = gameState.players.filter(p => !p.isHuman && p.selectedToPass.length === 0);
      
      const processBots = async () => {
        for (const bot of botsWithoutPass) {
            let ids: string[] | null = null;
            
            // Ritardo simulato per il passaggio
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));

            // Usa l'AI specifica del bot
            const currentAi = bot.aiType || 'HAL';

            if (currentAi === 'GEM') {
               ids = getGemPass(bot.hand);
            } else if (currentAi === 'GPT52') {
               ids = getGPT52Pass(bot.hand);
            } else {
               console.log(`%c[Hal B] Bot ${bot.name} calcola passaggio`, "color: orange; font-weight: bold;");
               ids = getHalBPassthroughCards(bot.hand);
            }

            setGameState(prev => ({
                ...prev,
                players: prev.players.map(p => p.id === bot.id ? { ...p, selectedToPass: ids! } : p)
            }));
        }
      };

      if (botsWithoutPass.length > 0) {
          processBots();
      }
    }
  }, [gameState.gameStatus, gameState.passDirection, gameState.players]);

  // --- TIMER ---
  useEffect(() => {
    if (gameState.gameStatus === 'playing' && gameState.currentTrick.length < 4) {
      const currentPlayer = gameState.players[gameState.turnIndex];
      if (!currentPlayer) return;
      setTimeLeft(currentPlayer.isHuman ? USER_TURN_TIME : BOT_MAX_TIME);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => setTimeLeft(prev => prev > 0 ? prev - 1 : 0), 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [gameState.turnIndex, gameState.gameStatus, gameState.currentTrick.length]);

  // --- AUTO-PLAY SE SCADE TEMPO ---
  useEffect(() => {
    if (timeLeft === 0 && gameState.gameStatus === 'playing' && !isProcessing) {
      const currentPlayer = gameState.players[gameState.turnIndex];
      if (!currentPlayer || currentPlayer.hand.length === 0) return;
      
      console.log(`%c[Timeout] Forcing move for ${currentPlayer.name}`, "color: red;");
      const card = getHalBMove(gameState, currentPlayer.id); // Fallback safe
      if (card) playCard(gameState.turnIndex, card);
    }
  }, [timeLeft, gameState.gameStatus, isProcessing]);

  // --- GESTIONE MOSSE BOT (PLAY) ---
  useEffect(() => {
    if (gameState.players.length === 0) return;
    const currentPlayer = gameState.players[gameState.turnIndex];
    
    if (gameState.gameStatus === 'playing' && !currentPlayer.isHuman && gameState.currentTrick.length < 4 && !isProcessing) {
      setIsProcessing(true);
      
      const performBotMove = async () => {
        let cardToPlay: Card | null = null;

        // CALCOLO DEL RITARDO SIMULATO
        const thinkingTime = Math.floor(Math.random() * 2000) + 1500;
        await new Promise(r => setTimeout(r, thinkingTime));

        try {
            // Usa l'AI specifica del bot
            const currentAi = currentPlayer.aiType || 'HAL';

            if (currentAi === 'GEM') {
                cardToPlay = getGemMove(gameState, currentPlayer.id);
            } else if (currentAi === 'GPT52') {
                cardToPlay = getGPT52Move(gameState, currentPlayer.id);
            } else {
                console.log(`%c[Hal B] Bot ${currentPlayer.name} calcola mossa`, "color: orange;");
                cardToPlay = getHalBMove(gameState, currentPlayer.id);
            }
        } catch (e) {
            console.error("Errore AI:", e);
            cardToPlay = currentPlayer.hand[0];
        }

        playCard(gameState.turnIndex, cardToPlay!);
        setIsProcessing(false);
      };

      performBotMove();
    }
  }, [gameState.turnIndex, gameState.gameStatus, gameState.currentTrick.length, gameState.config.aiType]);

  useEffect(() => {
    if (gameState.currentTrick.length === 4) { 
      
      const trick = gameState.currentTrick;
      const leadSuitUsed = gameState.leadSuit!;
      let winnerId = trick[0].playerId;
      let maxVal = -1;
      trick.forEach(t => {
        if (t.card.suit === leadSuitUsed && t.card.value > maxVal) {
          maxVal = t.card.value;
          winnerId = t.playerId;
        }
      });

      const timer = setTimeout(() => {         
        setLastWinnerId(winnerId);
        setTimeout(() => setLastWinnerId(null), 5500);

        setGameState(prev => {                 
          const trick = prev.currentTrick;
          const leadSuitUsed = prev.leadSuit!;
          let winnerId = trick[0].playerId;
          let maxVal = -1;
          trick.forEach(t => {
            if (t.card.suit === leadSuitUsed && t.card.value > maxVal) {
              maxVal = t.card.value;
              winnerId = t.playerId;
            }
          });

          let trickPoints = 10; 
          trick.forEach(t => {
            if (t.card.suit === 'hearts') trickPoints -= t.card.value;
            if (t.card.suit === 'spades' && t.card.rank === 'Q') trickPoints -= 26;
          });

          const nextPlayers = prev.players.map(p => p.id === winnerId ? { ...p, pointsThisRound: p.pointsThisRound + trickPoints, tricksWon: p.tricksWon + 1 } : p);
          
          if (nextPlayers[0].hand.length === 0) {
            // Fine Round
            // Fix: explicitly cast properties to Number for slam detection arithmetic
            const slamPlayer = nextPlayers.find(p => (Number(p.tricksWon) * 10 - Number(p.pointsThisRound)) === 130);
            let processedPlayers = nextPlayers;
            let slamMsg = null;

            if (slamPlayer) {
              slamMsg = `CAPPOTTO DI ${slamPlayer.name.toUpperCase()}!`;
              processedPlayers = nextPlayers.map(p => ({
                ...p,
                pointsThisRound: p.id === slamPlayer.id ? 45 : -15
              }));
            }

            // Aggiorna score e cronologia
            const endRoundPlayers = processedPlayers.map(p => ({
              ...p, 
              score: p.score + p.pointsThisRound,
              scoreHistory: [...p.scoreHistory, p.pointsThisRound],
              tricksWon: 0 
            }));

            // VERIFICA FINE PARTITA (Regole Configurate)
            const maxRoundsReached = prev.roundNumber >= prev.config.maxRounds;
            const scoreLimitHit = endRoundPlayers.some(p => Math.abs(p.score) >= prev.config.maxScore);

            return { 
              ...prev, 
              players: endRoundPlayers, 
              gameStatus: (maxRoundsReached || scoreLimitHit) ? 'gameOver' : 'scoring', 
              currentTrick: [],
              winningMessage: slamMsg
            };
          }
          return { ...prev, players: nextPlayers, currentTrick: [], turnIndex: winnerId, leadSuit: null };
        });
      }, ATTESA);
      return () => clearTimeout(timer);
    }
  }, [gameState.currentTrick]);

  const startNewRound = useCallback(() => {
    const deck = shuffle(createDeck());
    const dir = calculatePassDirection(gameState.roundNumber);
    
    const hands = [deck.slice(0,13), deck.slice(13,26), deck.slice(26,39), deck.slice(39,52)];
    const newPlayers = gameState.players.map((p, i) => ({
      ...p, hand: hands[i].sort((a,b) => a.suit === b.suit ? a.value - b.value : a.suit.localeCompare(b.suit)),
      pointsThisRound: 0, tricksWon: 0, selectedToPass: []
    }));
    
    setGameState(prev => ({
      ...prev, players: newPlayers, passDirection: dir, gameStatus: 'passing', 
      currentTrick: [], turnIndex: startingPlayerIndex, heartsBroken: false, leadSuit: null, receivedCards: [],
      winningMessage: null
    }));
  }, [gameState.roundNumber, gameState.players, startingPlayerIndex, calculatePassDirection]);

  const toggleSelectToPass = (cardId: string) => {
    setGameState(prev => {
      const p = prev.players[0];
      const isSelected = p.selectedToPass.includes(cardId);
      if (!isSelected && p.selectedToPass.length >= 3) return prev;
      const next = isSelected ? p.selectedToPass.filter(id => id !== cardId) : [...p.selectedToPass, cardId];
      return { ...prev, players: prev.players.map(pl => pl.id === 0 ? { ...pl, selectedToPass: next } : pl) };
    });
  };

  const executePass = async () => {
    await new Promise(r => setTimeout(r, 1000));
    setGameState(prev => {
      const cardsToPass = prev.players.map(p => p.hand.filter(c => p.selectedToPass.includes(c.id)));
      const newPlayers = prev.players.map((p, i) => {
        let fromIdx = 0;
        if (prev.passDirection === 'left') fromIdx = (i + 1) % 4;
        else if (prev.passDirection === 'right') fromIdx = (i + 3) % 4;
        else if (prev.passDirection === 'across') fromIdx = (i + 2) % 4;
        
        const newHand = p.hand.filter(c => !p.selectedToPass.includes(c.id)).concat(cardsToPass[fromIdx]);
        return { ...p, hand: newHand.sort((a,b) => a.suit === b.suit ? a.value - b.value : a.suit.localeCompare(b.suit)), selectedToPass: [] };
      });
      
      const receiverIdx = (0 + (prev.passDirection === 'left' ? 1 : prev.passDirection === 'right' ? 3 : 2)) % 4;
      return { 
        ...prev, 
        players: newPlayers, 
        gameStatus: 'receiving', 
        receivedCards: cardsToPass[receiverIdx], 
        turnIndex: startingPlayerIndex 
      };
    });
  };

  const currentTrickValue = useMemo(() => {
    let pts = 10; 
    if (gameState.currentTrick && gameState.currentTrick.length > 0) {
      gameState.currentTrick.forEach(t => {
        if (t.card.suit === 'hearts') pts -= t.card.value;
        if (t.card.suit === 'spades' && t.card.rank === 'Q') pts -= 26;
      });
    }
    return pts;
  }, [gameState.currentTrick]);

  // Helper per ottenere la direzione passata in base all'indice del round (usato nella tabella)
  const getRoundDirectionChar = (roundIndex: number) => {
      const dir = calculatePassDirection(roundIndex + 1);
      switch (dir) {
          case 'left': return 'S';
          case 'right': return 'D';
          case 'across': return 'C';
          case 'none': return '-';
          default: return '-';
      }
  };

  // Helper per ottenere l'etichetta dell'AI
  const getAiLabel = (aiType?: AiType) => {
      if (!aiType) return 'BOT';
      switch(aiType) {
          case 'GEM': return 'GEM';
          case 'GPT52': return 'GPT';
          case 'HAL': return 'HAL-B';
          default: return 'BOT';
      }
  };

  // Helper UI small
  const PlayerInfoWidget = ({ player, isBot, isCurrent, isLastWinner }: { player: Player, isBot: boolean, isCurrent: boolean, isLastWinner: boolean }) => (
    <div className="flex flex-col items-center gap-1">
      <div className={`flex flex-row items-center gap-2 bg-black/65 px-3 py-2 rounded-xl border 
        ${isCurrent 
            ? 'border-white/40 scale-105' 
            : 'border-white/10'
        } 
        shadow-xl backdrop-blur-md transition-all duration-300 pointer-events-auto`}>
        <div className="flex flex-col min-w-[70px]">
          <span className="text-[9px] font-bold uppercase opacity-40 leading-none mb-0.5">
            {isBot ? getAiLabel(player.aiType) : 'Giocatore'}
          </span>
          <span className="font-bold text-sm tracking-tight truncate">{player.name}</span>
        </div>
        <div className="w-[1px] h-6 bg-white/10" />
        <div className="flex flex-col items-center w-[40px]">
          <span className="text-[9px] font-bold opacity-40 uppercase">Rank</span>
          <span className="font-bold text-yellow-400 text-base">{getRank(player.id)}°</span>
        </div>
        <div className="w-[1px] h-6 bg-white/10" />
        <div className="flex flex-col items-center w-[40px]">
          <span className="text-[9px] font-bold opacity-40 uppercase">Prese</span>
          <span className="font-bold text-base text-sky-400">{player.tricksWon}</span>
        </div>
        <div className="w-[1px] h-6 bg-white/10" />
        <div className="flex flex-col items-center w-[40px]">
          <span className="text-[9px] font-bold opacity-40 uppercase">Punti</span>
          <span className={`font-bold text-base ${player.score >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {player.score}
          </span>
        </div>
      </div>
      
      {((isCurrent && gameState.gameStatus === 'playing') || isLastWinner) && (
        <TimeBar 
            total={isLastWinner ? 1 : BOT_MAX_TIME} 
            current={isLastWinner ? 0 : timeLeft} 
            isWinner={isLastWinner} 
        />
      )}
    </div>
  );

  const getTranslatedDirection = (dir: PassDirection) => {
    switch (dir) {
      case 'left': return 'S';
      case 'right': return 'D';
      case 'across': return 'C';
      case 'none': return '-';
      default: return dir;
    }
  };

  const getPassDirectionDescription = (dir: PassDirection) => {
    switch (dir) {
      case 'left': return 'LE CARTE SI PASSANO A SINISTRA';
      case 'right': return 'LE CARTE SI PASSANO A DESTRA';
      case 'across': return 'LE CARTE SI PASSANO AL CENTRO';
      case 'none': return 'LE CARTE NON SI PASSANO';
      default: return '';
    }
  };

  // Componente ScoreTable riutilizzabile
  const ScoreTable = () => (
    <div className="overflow-hidden bg-black/65 border border-white/20 rounded-lg shadow-2xl">
        <div className="w-full overflow-x-auto">
            <table className="text-center border-collapse">
                <thead>
                    <tr className="bg-white/10 text-white font-bold text-base md:text-sm h-14">
                        <th className="py-2 px-8 border-r border-white/10 w-12 text-white/50">#</th>
                        {gameState.players.map(p => (
                             <th key={p.id} className="p-2 border-r border-slate-700 w-[150px]">
                                <div className="flex flex-col items-center">
                                    <span>{p.name}</span>
                                    {!p.isHuman && <span className="text-[9px] opacity-50">{getAiLabel(p.aiType)}</span>}
                                </div>
                             </th>
                        ))}
                        <th className="py-2 px-8 w-12 text-yellow-400">R</th>
                    </tr>
                </thead>
                <tbody className="text-base md:text-base font-medium">
                    {/* Genera righe in base allo storico del primo giocatore */}
                    {gameState.players[0].scoreHistory.map((_, roundIndex) => (
                        <tr key={roundIndex} className="border-b border-white/10 hover:bg-white/5 transition-colors">
                            <td className="p-2 border-r border-slate-700 text-white/50">{roundIndex + 1}</td>
                            {gameState.players.map(p => {
                                const score = p.scoreHistory[roundIndex];
                                const colorClass = score > 0 ? 'text-emerald-400' : (score < 0 ? 'text-red-400' : 'text-white/30');
                                const valStr = score > 0 ? `+${score}` : score;
                                const cellBg = score === 45 ? 'bg-rose-900/40' : '';
                                return (
                                    <td key={p.id} className={`p-2 border-r border-white/10 ${colorClass} ${cellBg}`}>
                                        {valStr}
                                    </td>
                                );
                            })}
                            <td className="p-2 text-yellow-400 font-bold">{getRoundDirectionChar(roundIndex)}</td>
                        </tr>
                    ))}
                </tbody>
                <tfoot className="bg-white/10 font-bold text-base md:text-lg border-t-2 border-white/20 h-14">
                    <tr>
                        <td className="p-3 border-r border-slate-700 text-white/50">TOT</td>
                        {gameState.players.map(p => (
                             <td key={p.id} className={`p-3 border-r border-white/10 ${p.score >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {p.score}
                             </td>
                        ))}
                        <td className="p-3 text-white/50">-</td>
                    </tr>
                </tfoot>
            </table>
        </div>
    </div>
  );

  // --- RENDER ---
  
  // 1. Schermata SETUP
  if (gameState.gameStatus === 'setup') {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black/45 backdrop-blur-sm text-white font-sans p-4">
        <div className="bg-black/65 p-8 rounded-3xl border border-yellow-400/30 shadow-[0_0_50px_rgba(250,204,21,0.1)] max-w-lg w-full animate-deal">
          <h1 className="text-4xl font-black text-emerald-400 mb-8 text-center tracking-tighter uppercase">SETUP</h1>
          
          <div className="mb-6">
            <label className="block text-xs font-bold uppercase opacity-50 mb-2">Inserisci il tuo Nome</label>
            <input 
              type="text" 
              value={tempConfig.playerName}
              onChange={(e) => setTempConfig({...tempConfig, playerName: e.target.value})}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 font-bold text-lg focus:outline-none focus:border-yellow-400 transition-colors"
              placeholder="Inserisci nome..."
            />
          </div>

          <div className="mb-6">
            <label className="block text-xs font-bold uppercase opacity-50 mb-2">Intelligenza Artificiale</label>
            <div className="grid grid-cols-4 gap-2">
              <button 
                onClick={() => setTempConfig({...tempConfig, aiType: 'GPT52'})}
                className={`py-3 rounded-xl font-bold border text-xs sm:text-sm transition-all ${tempConfig.aiType === 'GPT52' ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-transparent border-white/20 text-white/50 hover:bg-white/5'}`}
              >
                GPT
              </button>
              <button 
                onClick={() => setTempConfig({...tempConfig, aiType: 'GEM'})}
                className={`py-3 rounded-xl font-bold border text-xs sm:text-sm transition-all ${tempConfig.aiType === 'GEM' ? 'bg-sky-400 text-black border-sky-400' : 'bg-transparent border-white/20 text-white/50 hover:bg-white/5'}`}
              >
                GEM
              </button>
              <button 
                onClick={() => setTempConfig({...tempConfig, aiType: 'HAL'})}
                className={`py-3 rounded-xl font-bold border text-xs sm:text-sm transition-all ${tempConfig.aiType === 'HAL' ? 'bg-orange-400 text-black border-orange-400' : 'bg-transparent border-white/20 text-white/50 hover:bg-white/5'}`}
              >
                HAL-B
              </button>
              <button 
                onClick={() => setTempConfig({...tempConfig, aiType: 'MIXED'})}
                className={`py-3 rounded-xl font-bold border text-xs sm:text-sm transition-all ${tempConfig.aiType === 'MIXED' ? 'bg-pink-500 text-white border-pink-500 shadow-[0_0_15px_rgba(236,72,153,0.5)]' : 'bg-transparent border-white/20 text-white/50 hover:bg-white/5'}`}
              >
                MISTO
              </button>
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-xs font-bold uppercase opacity-50 mb-2">Durata Partita (Mani)</label>
            <div className="flex gap-2">
              {[4, 8, 12].map(r => (
                <button 
                  key={r}
                  onClick={() => setTempConfig({...tempConfig, maxRounds: r})}
                  className={`flex-1 py-2 rounded-xl font-bold border transition-all ${tempConfig.maxRounds === r ? 'bg-white text-black border-white' : 'bg-transparent border-white/20 text-white/50 hover:bg-white/5'}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-xs font-bold uppercase opacity-50 mb-2">Limite Punteggio (Fine Gioco)</label>
            <div className="flex gap-2">
              {[50, 100].map(s => (
                <button 
                  key={s}
                  onClick={() => setTempConfig({...tempConfig, maxScore: s})}
                  className={`flex-1 py-2 rounded-xl font-bold border transition-all ${tempConfig.maxScore === s ? 'bg-white text-black border-white' : 'bg-transparent border-white/20 text-white/50 hover:bg-white/5'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-8">
            <label className="block text-xs font-bold uppercase opacity-50 mb-2">Sequenza Passaggio</label>
            <div className="flex gap-2">
               <button 
                  onClick={() => setTempConfig({...tempConfig, passSequenceName: 'DSC-'})}
                  className={`flex-1 py-2 rounded-xl font-bold border transition-all ${tempConfig.passSequenceName === 'DSC-' ? 'bg-yellow-400 text-black border-sky-400' : 'bg-transparent border-white/20 text-white/50 hover:bg-white/5'}`}
                >
                  D S C -
                </button>
                <button 
                  onClick={() => setTempConfig({...tempConfig, passSequenceName: 'DS-C'})}
                  className={`flex-1 py-2 rounded-xl font-bold border transition-all ${tempConfig.passSequenceName === 'DS-C' ? 'bg-yellow-400 text-black border-sky-400' : 'bg-transparent border-white/20 text-white/50 hover:bg-white/5'}`}
                >
                  D S - C
                </button>
            </div>
          </div>

          <button 
            onClick={initializeGame}
            className="w-full bg-emerald-400 hover:bg-white text-black font-black text-xl py-4 rounded-2xl shadow-xl transition-all active:scale-95"
          >
            INIZIA PARTITA
          </button>
        </div>
      </div>
    );
  }

  // 2. Schermata GIOCO
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center overflow-hidden text-white font-sans select-none relative">
      <div className="relative w-full h-full flex items-center justify-center z-10 pointer-events-none">
        {gameState.players.length > 0 && (
          <>
            <div className="absolute top-[3vh] left-1/2 -translate-x-1/2 z-20">
              <PlayerInfoWidget player={gameState.players[2]} isBot={true} isCurrent={gameState.turnIndex === 2 && gameState.gameStatus === 'playing'} isLastWinner={lastWinnerId === 2} />
            </div>
            <div className="absolute left-[1vw] top-[70vh] z-20">
              <PlayerInfoWidget player={gameState.players[1]} isBot={true} isCurrent={gameState.turnIndex === 1 && gameState.gameStatus === 'playing'} isLastWinner={lastWinnerId === 1} />
            </div>
            <div className="absolute right-[1vw] top-[70vh] z-20">
              <PlayerInfoWidget player={gameState.players[3]} isBot={true} isCurrent={gameState.turnIndex === 3 && gameState.gameStatus === 'playing'} isLastWinner={lastWinnerId === 3} />
            </div>
          </>
        )}

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none shadow-none">
          {gameState.currentTrick.map((t) => {
            let positionClasses = "";
            let rotation = "";
            switch (t.playerId) {
              case 0: positionClasses = "left-[48%] top-[69%] -translate-x-1/2 scale-120 z-[300]"; rotation = "rotate-0"; break; // SUD USER
              case 1: positionClasses = "left-[42%] top-[61%] -translate-y-1/2 z-[250]"; rotation = "-rotate-90"; break; // OVEST SINISTRA
              case 2: positionClasses = "left-[51%] top-[51%] -translate-x-1/2 z-[200]"; rotation = "rotate-180"; break; // NORD 
              case 3: positionClasses = "right-[40%] top-[62%] -translate-y-1/2 z-[250]"; rotation = "rotate-90"; break; // EST DESTRA
            }
            return (
              <div key={t.playerId} className={`absolute transition-all duration-500 animate-deal ${positionClasses} ${rotation} z-20`}>
                <PlayingCard card={t.card} isSmall scale={1.4} noShadow />
              </div>
            );
          })}
        </div>
      </div>

      {gameState.players.length > 0 && (
      <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[350] pointer-events-none">
        
        {((gameState.turnIndex === 0 && gameState.gameStatus === 'playing') || lastWinnerId === 0) && (
          <div className="absolute -top-[2px] left-1/2 -translate-x-1/2 z-[360]">
            <TimeBar 
                total={lastWinnerId === 0 ? 1 : USER_TURN_TIME} 
                current={lastWinnerId === 0 ? 0 : timeLeft} 
                isWinner={lastWinnerId === 0}
            />
          </div>
        )}

        <div className={`flex flex-row items-center justify-between gap-2 bg-black/65 px-2 py-2 rounded-xl border 
            ${(gameState.turnIndex === 0 && gameState.gameStatus === 'playing')
                ? 'border-white/40 shadow-lg' 
                : 'border-white/10'} 
            shadow-xl backdrop-blur-md transition-all duration-300 pointer-events-auto`}>
            
            <div className="flex flex-col items-center w-[40px]">
                <span className="text-[9px] font-bold uppercase opacity-40 leading-none mb-1">Mano</span>
                <span className="font-bold text-base text-white tracking-[-1.5]">{gameState.roundNumber} / {gameState.config.maxRounds}</span>
            </div>
            <div className="w-[1px] h-8 bg-white/10" />

            <div className="flex flex-col items-center w-[40px]">
                <span className="text-[9px] font-bold uppercase opacity-40 leading-none mb-1">Round</span>
                <span className="font-bold text-base text-yellow-400 uppercase">{getTranslatedDirection(gameState.passDirection)}</span>
            </div>
            <div className="w-[1px] h-8 bg-white/10" />

             <div className="flex flex-col items-center w-[40px]">
                <span className="text-[9px] font-bold uppercase opacity-40 leading-none mb-1">TRK.PT</span>
                <span className={`font-bold text-base ${gameState.currentTrick.length === 0 ? 'text-white/60' : (currentTrickValue >= 0 ? 'text-emerald-400' : 'text-red-400')}`}>
                   {gameState.currentTrick.length === 0 ? '--' : (currentTrickValue > 0 ? `+${currentTrickValue}` : currentTrickValue)}
                </span>
            </div>
            <div className="w-[1px] h-8 bg-white/10" />

            <div className="flex flex-col items-center w-max-[170px]">
                <span className="text-[9px] font-bold uppercase opacity-40 leading-none mb-1">Giocatore</span>
                <span className="font-bold text-xl text-white truncate w-full text-center">{gameState.players[0].name}</span>
            </div>
            <div className="w-[1px] h-8 bg-white/10" />

             <div className="flex flex-col items-center w-[40px]">
                <span className="text-[9px] font-bold opacity-40 uppercase mb-1">Rank</span>
                <span className="font-bold text-yellow-400 text-base">{getRank(0)}°</span>
            </div>
            <div className="w-[1px] h-8 bg-white/10" />

            <div className="flex flex-col items-center w-[40px]">
                <span className="text-[9px] font-bold opacity-40 uppercase mb-1">Prese</span>
                <span className="font-bold text-base text-sky-400">{gameState.players[0].tricksWon}</span>
            </div>
             <div className="w-[1px] h-8 bg-white/10" />

            <div className="flex flex-col items-center w-[40px]">
                <span className="text-[9px] font-bold opacity-40 uppercase mb-1">Punti</span>
                <span className={`font-bold text-base ${gameState.players[0].score >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {gameState.players[0].score}
                </span>
            </div>
        </div>
      </div>
      )}

      {gameState.players.length > 0 && (
      <div className="fixed bottom-[-15px] w-full flex justify-center z-[250] px-6">
        <div className="flex justify-center -space-x-[5rem] md:-space-x-[6rem] transition-all duration-500">
          {gameState.players[0].hand.map((card, i) => {
            const total = gameState.players[0].hand.length;
            const offset = i - (total - 1) / 2;
            const rotation = offset * 4; 
            const translateY = (offset * offset) * 1.65;

            const isSelected = gameState.players[0].selectedToPass.includes(card.id);
            const isPlayable = gameState.gameStatus === 'playing' && gameState.turnIndex === 0 && (
              !gameState.leadSuit || card.suit === gameState.leadSuit || gameState.players[0].hand.every(c => c.suit !== gameState.leadSuit)
            );
            
            return (
              <div 
                key={card.id} 
                className="group relative transition-all duration-300" 
                style={{ 
                    zIndex: i,
                    transform: `translateY(${translateY}px) rotate(${rotation}deg)`,
                    transformOrigin: '50% 120%'
                }}
              >
                <div 
                    className={`transition-all duration-200 ${isSelected ? '-translate-y-6 scale-110 z-10' : 'hover:-translate-y-12 hover:scale-110 hover:z-10'}`}
                >
                    <div className="scale-110 md:scale-120">
                      <PlayingCard 
                        card={card} 
                        noShadow 
                        highlighted={isSelected || (isPlayable && gameState.gameStatus === 'playing')} 
                        onClick={() => {
                            if (gameState.gameStatus === 'passing' && gameState.passDirection !== 'none') toggleSelectToPass(card.id);
                            if (gameState.gameStatus === 'playing' && isPlayable && !isProcessing) playCard(0, card);
                        }} 
                      />
                    </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}
      
      {gameState.gameStatus === 'passing' && gameState.players.length > 0 && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center pointer-events-none">
          <div className="bg-black/95 p-6 rounded-2xl border border-yellow-400/50 text-center shadow-[0_0_100px_rgba(0,0,0,0.8)] animate-deal pointer-events-auto max-w-md transform -translate-y-40">
            <h2 className="text-xl font-extrabold mb-1 text-yellow-400 uppercase tracking-tighter leading-none">{getPassDirectionDescription(gameState.passDirection)}</h2>
            {gameState.passDirection === 'none' ? (
                <button 
                  onClick={() => setGameState(prev => ({ ...prev, gameStatus: 'playing' }))}
                  className="w-full mt-4 py-3 rounded-xl font-extrabold text-lg transition-all duration-300 bg-yellow-400 text-black shadow-lg cursor-pointer hover:bg-white"
                >
                  GIOCA
                </button>
            ) : (
                <button 
                  disabled={gameState.players[0].selectedToPass.length !== 3} 
                  onClick={executePass} 
                  className={`w-full mt-4 py-3 rounded-xl font-extrabold text-lg transition-all duration-300 ${gameState.players[0].selectedToPass.length === 3 ? 'bg-yellow-400 text-black shadow-lg cursor-pointer hover:bg-white' : 'bg-white/5 text-white/50 cursor-not-allowed'}`}
                >
                  {gameState.players[0].selectedToPass.length === 3 ? 'CONFERMA' : `${3 - gameState.players[0].selectedToPass.length} DA SCEGLIERE`}
                </button>
            )}
          </div>
        </div>
      )}
      {gameState.gameStatus === 'receiving' && (
        <div className="fixed inset-0 bg-black/65 z-[500] flex items-center justify-center">
           <div className="bg-black/60 p-10 rounded-3xl border border-white/10 text-center animate-deal shadow-2xl backdrop-blur-xl transform -translate-y-24">
              <h2 className="text-3xl font-extrabold text-emerald-400 mb-8 uppercase tracking-tighter">Hai ricevuto:</h2>
              <div className="flex gap-4 mb-10 justify-center">{gameState.receivedCards.map(c => <PlayingCard key={c.id} card={c} isSmall />)}</div>
              <button onClick={() => setGameState(s => ({...s, gameStatus: 'playing'}))} className="w-full bg-emerald-500 py-5 rounded-full font-extrabold text-xl shadow-lg hover:bg-emerald-400 transition-colors">GIOCA</button>
           </div>
        </div>
      )}

      {/* -------------------  POPUP PUNTEGGI (SCORING) ----------------------*/}
      {gameState.gameStatus === 'scoring' && (
        <div className="fixed inset-0 bg-black/98 z-[600] flex items-center justify-center">
          <div className="w-full max-w-4xl bg-white/5 border border-white/10 p-6 md:p-10 rounded-3xl animate-deal backdrop-blur-xl flex flex-col items-center">
            {gameState.winningMessage && (
              <div className="bg-yellow-400 text-black text-center py-2 px-6 rounded-xl font-black text-2xl mb-8 animate-pulse uppercase shadow-lg">
                {gameState.winningMessage}
              </div>
            )}
            <h2 className="text-4xl font-bold text-center mb-8 uppercase tracking-tighter text-white">Classifica</h2>
            
            <div className="mb-8 w-full">
                <ScoreTable />
            </div>

            <button onClick={() => {
                const nextRound = gameState.roundNumber + 1;
                const nextDir = calculatePassDirection(nextRound);
                setGameState(s => ({...s, roundNumber: nextRound, passDirection: nextDir, gameStatus: 'dealing'}));
            }} className="w-full max-w-sm bg-emerald-500 py-5 rounded-full font-extrabold text-xl transition-all shadow-xl hover:bg-emerald-400 active:scale-95">PROSSIMO ROUND</button>
          </div>
        </div>
      )}
      {/* -------------------  SPLASH INIZIALE  ----------------------*/}
      {gameState.gameStatus === 'dealing' && gameState.players.length > 0 && (
        <div className="fixed bottom-[10%] bg-black/98 z-[700] flex items-center justify-center">
          <div className="text-center animate-deal">
            <h1 className="text-[12rem] font-extrabold tracking-tighter text-yellow-400 leading-none">ROUND{gameState.roundNumber}</h1>
            <p className="text-2xl mb-2 font-extrabold text-yellow-400 uppercase tracking-wide leading-none">{getPassDirectionDescription(gameState.passDirection)}</p>
            <p className="text-3xl mb-12 font-extrabold tracking-[0.5em]">{isUserDealer ? 'SERVI TU LE CARTE' : `SERVE LE CARTE: ${gameState.players[dealerIndex].name}`}</p>
            <button onClick={startNewRound} className="bg-white text-black px-6 py-2 rounded-xl font-extrabold text-3xl shadow-xl hover:scale-105 active:scale-95 transition-all">VAI</button>
          </div>
        </div>
      )}

      {/* -------------------  GAME OVER ----------------------*/}
      {gameState.gameStatus === 'gameOver' && (
        <div className="fixed inset-0 bg-black z-[1000] flex flex-col items-center justify-center p-6">
           <h1 className="text-6xl font-black text-yellow-400 mb-6 uppercase tracking-tighter">Fine Partita</h1>
           
           <div className="w-full max-w-4xl mb-10">
              <ScoreTable />
           </div>

           <button onClick={() => window.location.reload()} className="bg-white text-black px-12 py-5 rounded-full font-black text-2xl hover:scale-105 transition-transform shadow-2xl">GIOCA ANCORA</button>
        </div>
      )}
    </div>
  );
};

export default App;

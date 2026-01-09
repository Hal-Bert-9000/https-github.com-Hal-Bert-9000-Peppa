
import React from 'react';

interface TimeBarProps {
  total: number;
  current: number;
  isWinner?: boolean; // Nuova prop per stato vittoria
}

const TimeBar: React.FC<TimeBarProps> = ({ total, current, isWinner }) => {
  // Calcola il tempo trascorso
  const elapsed = total - current;
  
  // Se è vincitore, forza 100%, altrimenti calcola percentuale
  const percentage = isWinner ? 100 : Math.min(100, Math.max(0, (elapsed / total) * 100));
  
  // Calcola lo step attuale da 1 a 10 per decidere il colore (solo se non è vincitore)
  const step = Math.floor((percentage / 100) * 10) + 1;

  let colorClass = 'bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.9)]'; // Verde acceso
  
  if (isWinner) {
      // Stile VINCITORE: Sky Blue fisso
      colorClass = 'bg-sky-400 shadow-[0_0_10px_3px_rgba(56,189,248,0.9)]';
  } else {
      // Logica progressiva normale
      if (step > 4) colorClass = 'bg-yellow-400 shadow-[0_0_8px_2px_rgba(250,204,21,0.9)]'; // Giallo acceso
      if (step > 7) colorClass = 'bg-red-500 shadow-[0_0_8px_2px_rgba(239,68,68,0.9)]';   // Rosso acceso
  }

  return (
    // Sfondo più scuro (bg-gray-800) invece di trasparente per contrasto sul tavolo
    <div className="w-[100px] h-[2px] bg-gray-800 relative rounded-full -mt-[1px] z-50">
      <div 
        className={`h-full transition-all duration-1000 linear ${colorClass}`} 
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
};

export default TimeBar;

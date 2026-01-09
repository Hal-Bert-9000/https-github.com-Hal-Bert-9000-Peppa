
import React from 'react';
import { Card } from '../types';
import { getCardImageUrl, CARD_BACK_URL } from '../constants';

interface PlayingCardProps {
  card: Card;
  onClick?: () => void;
  disabled?: boolean;
  hidden?: boolean;
  isSmall?: boolean;
  scale?: number;
  highlighted?: boolean;
  noShadow?: boolean;
  noBorder?: boolean;
}

const PlayingCard: React.FC<PlayingCardProps> = ({ 
  card, 
  onClick, 
  disabled, 
  hidden, 
  isSmall,
  scale,
  highlighted,
  noShadow,
  noBorder
}) => {
  const imageUrl = hidden ? CARD_BACK_URL : getCardImageUrl(card);

  // Calcolo delle classi dimensionali: isSmall ora è leggermente più grande (w-28 vs w-24)
  const sizeClasses = isSmall 
    ? 'w-28 h-40 md:w-32 md:h-48' 
    : 'w-32 h-48 md:w-40 md:h-60';

  return (
    <div 
      onClick={!disabled ? onClick : undefined}
      style={scale ? { transform: `scale(${scale})` } : {}}
      className={`
        relative
        ${sizeClasses}
        rounded-xl transition-all duration-300 
        ${disabled ? 'cursor-default' : 'cursor-pointer active:scale-95'}
        ${highlighted ? '-translate-y-8 z-10 scale-110' : (noShadow ? '' : 'card-shadow')}
      `}
    >
      <img 
        src={imageUrl} 
        alt={hidden ? 'Dorso carta' : `${card.rank} di ${card.suit}`}
        className="w-full h-full object-contain rounded-xl block"
        draggable={false}
      />
      
      {/* Overlay di rifinitura bordo standard per profondità */}
      {!noBorder && <div className="absolute inset-0 rounded-xl border border-black/10 pointer-events-none" />}
      
      {/* Rimosso ogni effetto di bordo (ring) o bagliore colorato per l'evidenziazione */}
    </div>
  );
};

export default PlayingCard;

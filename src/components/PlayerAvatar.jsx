import React from 'react';
import { skillStyleSolid } from '../lib/skillStyles';

/* A player's photo, or their initials on a skill-coloured disc when there isn't
   one. Lives in its own file because the match reveal overlay needs it and must
   not import App.jsx.

   `xxl` exists for the reveal sequence, where the photo is the point of the
   whole screen rather than a detail on a row. */
export default function PlayerAvatar({ player, size, className = '' }) {
  const sizeClass =
    size === 'sm'  ? 'w-7 h-7 text-[10px]' :
    size === 'lg'  ? 'w-14 h-14 text-sm' :
    size === 'xl'  ? 'w-24 h-24 text-xl' :
    size === 'xxl' ? 'w-20 h-20 sm:w-[76px] sm:h-[76px] text-2xl' :
    'w-10 h-10 text-xs';

  const initials = player.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  if (player.photo) {
    return (
      <img
        src={player.photo}
        alt={player.name}
        className={`${sizeClass} rounded-full object-cover shrink-0 ${className}`}
      />
    );
  }
  return (
    <div
      className={`${sizeClass} rounded-full flex items-center justify-center shrink-0 font-bold ${skillStyleSolid(player.skill)} ${className}`}
    >
      <span className="text-zinc-950">{initials}</span>
    </div>
  );
}

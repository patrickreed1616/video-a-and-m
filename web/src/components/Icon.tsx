const PATHS: Record<string, string> = {
  play: 'M7 5v14l11-7z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  import: 'M12 3v10m0 0-4-4m4 4 4-4M4 15v4h16v-4',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.1 7.9 20 18M8.1 16.1 20 6',
  trash: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  export: 'M12 15V3m0 0-4 4m4-4 4 4M4 13v6h16v-6',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'm15 14 5-5-5-5m5 5H10a6 6 0 0 0 0 12h3',
  plus: 'M12 5v14M5 12h14',
  stop: 'M7 7h10v10H7z',
  install: 'M12 3v12m0 0-4-4m4 4 4-4M5 21h14',
  x: 'M6 6l12 12M18 6 6 18',
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  const filled = name === 'play' || name === 'pause' || name === 'stop';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'}
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

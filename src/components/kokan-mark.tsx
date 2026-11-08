export function KokanMark({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M10 15 13 8h14l3 7H10Z" fill="#F2C76F" />
      <path
        d="M10 15h20v2.2a3 3 0 0 1-3 3 3 3 0 0 1-3-3 3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-2-2.2Z"
        fill="#FFFDF5"
      />
      <path d="M12 20h16v12H12z" fill="#FFFDF5" />
      <path d="M14 22h12v4H14z" fill="#DCEBE1" />
      <path d="M19 27h4v5h-4z" fill="#F2C76F" />
      <path d="M21.5 29.5h.01" stroke="#174F3B" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

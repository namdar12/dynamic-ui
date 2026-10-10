type IconProps = { className?: string };

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  viewBox: '0 0 24 24',
};

export function GridIcon({ className }: IconProps) {
  return (
    <svg {...stroke} strokeWidth={1.75} className={className}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  );
}

export function ArrowUpIcon({ className }: IconProps) {
  return (
    <svg {...stroke} strokeWidth={2} className={className}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

export function ArrowRightIcon({ className }: IconProps) {
  return (
    <svg {...stroke} strokeWidth={2} className={className}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function AlertIcon({ className }: IconProps) {
  return (
    <svg {...stroke} strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5h.01" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...stroke} strokeWidth={2.25} className={className}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

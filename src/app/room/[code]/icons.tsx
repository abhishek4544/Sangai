/**
 * Inline SVG icons used across the room UI. Kept in one file so we can swap the
 * icon set later without hunting through every component. Sizing is via
 * `className` (Tailwind `size-*`) — the SVGs are viewBox-normalized to 24×24.
 */

type IconProps = { className?: string; "aria-hidden"?: boolean };

const base = "shrink-0";

export function CopyIcon({ className = "size-4", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${base} ${className}`}
      aria-hidden={rest["aria-hidden"] ?? true}
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  );
}

export function FullscreenIcon({ className = "size-4", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${base} ${className}`}
      aria-hidden={rest["aria-hidden"] ?? true}
    >
      <path d="M4 9V4h5" />
      <path d="M15 4h5v5" />
      <path d="M20 15v5h-5" />
      <path d="M9 20H4v-5" />
    </svg>
  );
}

export function MicIcon({ className = "size-4", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${base} ${className}`}
      aria-hidden={rest["aria-hidden"] ?? true}
    >
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

export function MicOffIcon({ className = "size-4", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${base} ${className}`}
      aria-hidden={rest["aria-hidden"] ?? true}
    >
      <path d="M9 9v3a3 3 0 0 0 5 2.2" />
      <path d="M15 12V6a3 3 0 0 0-5.7-1.3" />
      <path d="M5 11a7 7 0 0 0 11.3 5.5" />
      <path d="M19 11c0 .7-.1 1.4-.3 2" />
      <path d="M12 18v3" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export function VideoIcon({ className = "size-4", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${base} ${className}`}
      aria-hidden={rest["aria-hidden"] ?? true}
    >
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3z" />
    </svg>
  );
}

export function VideoOffIcon({ className = "size-4", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${base} ${className}`}
      aria-hidden={rest["aria-hidden"] ?? true}
    >
      <path d="M10 6h4a2 2 0 0 1 2 2v4" />
      <path d="M16 16H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1" />
      <path d="M16 10l5-3v10l-5-3z" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export function ShareScreenIcon({ className = "size-4", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${base} ${className}`}
      aria-hidden={rest["aria-hidden"] ?? true}
    >
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8" />
      <path d="M12 16v4" />
      <path d="M12 12V7" />
      <path d="M9 9l3-3 3 3" />
    </svg>
  );
}

export function WhisperGroupIcon({ className = "size-5", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 32 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${base} ${className}`}
      aria-hidden={rest["aria-hidden"] ?? true}
    >
      <circle cx="11" cy="8" r="4" />
      <path d="M3 20c1.5-3 5-5 8-5s6.5 2 8 5" />
      <circle cx="23" cy="10" r="3" />
      <path d="M20 20c.8-2.2 2.5-3.5 4.5-3.5" />
      <path d="M14 4c-1.5 1-1.5 5 0 6" />
    </svg>
  );
}

export function SparkleIcon({ className = "size-4", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`${base} ${className}`}
      aria-hidden={rest["aria-hidden"] ?? true}
    >
      <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
    </svg>
  );
}

export function DragHandleIcon({ className = "size-3.5", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`${base} ${className}`}
      aria-hidden={rest["aria-hidden"] ?? true}
    >
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

export function PaletteIcon({ className = "size-4", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${base} ${className}`}
      aria-hidden={rest["aria-hidden"] ?? true}
    >
      <path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.4-.3-.4-.5-.9-.5-1.4 0-1.1.9-2 2-2h1.7a4.3 4.3 0 0 0 4.3-4.3C21 6.4 17 3 12 3Z" />
      <circle cx="7.5" cy="10.5" r="1" fill="currentColor" />
      <circle cx="10.5" cy="7" r="1" fill="currentColor" />
      <circle cx="15" cy="7" r="1" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r="1" fill="currentColor" />
    </svg>
  );
}

export function LeaveIcon({ className = "size-4", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${base} ${className}`}
      aria-hidden={rest["aria-hidden"] ?? true}
    >
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 17l-5-5 5-5" />
      <path d="M5 12h11" />
    </svg>
  );
}

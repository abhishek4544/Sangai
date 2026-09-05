/**
 * Landing-page navbar — yellow "S" logo tile + "Movie Night" pill.
 * Matches Figma node 9:173 (left-side variant used on the landing).
 * The room-code/avatar pill is only rendered inside a room, so it's not here.
 */
export function LandingHeader() {
  return (
    <header className="relative flex items-center gap-3 px-4 pt-4 sm:px-6 sm:pt-5 lg:px-8">
      {/* Yellow "S" logo tile */}
      <div className="relative flex size-10 items-center justify-center overflow-hidden rounded-md border border-white bg-[#FFCC00] shadow-sm backdrop-blur">
        <span
          aria-hidden
          className="absolute left-[5px] top-[-10px] font-[family-name:var(--font-gasoek)] text-[38px] leading-none text-[#443506]"
        >
          S
        </span>
        <span className="sr-only">Sangai</span>
      </div>

      {/* Movie Night brand pill */}
      <div className="rounded-lg border border-white bg-white/80 px-3 py-1.5 shadow-sm backdrop-blur">
        <span className="font-[family-name:var(--font-outfit)] text-sm text-zinc-900">
          Movie Night
        </span>
      </div>
    </header>
  );
}

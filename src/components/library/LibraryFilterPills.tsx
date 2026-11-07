import type { LibrarySection } from "@/types";
import { cn } from "@/lib/cn";
import { Disc3, ListMusic, ListVideo, UserRound } from "lucide-react";

const FILTERS: {
  id: LibrarySection;
  label: string;
  icon: typeof ListMusic;
}[] = [
  { id: "tracks", label: "All tracks", icon: ListMusic },
  { id: "albums", label: "Albums", icon: Disc3 },
  { id: "artists", label: "Artists", icon: UserRound },
  { id: "playlists", label: "Playlists", icon: ListVideo },
];

export function LibraryFilterPills({
  active,
  onSelect,
}: {
  active: LibrarySection;
  onSelect: (section: LibrarySection) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Library filters"
      className="flex flex-wrap items-center gap-1.5"
    >
      {FILTERS.map((filter) => {
        const selected = filter.id === active;
        const Icon = filter.icon;
        return (
          <button
            key={filter.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(filter.id)}
            className={cn(
              "library-filter-pill flex h-[30px] items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-semibold outline-none transition-[background-color,border-color,color,transform] duration-200 focus-visible:ring-2 focus-visible:ring-accent/60 active:scale-[0.98]",
              selected
                ? "text-white"
                : "border-white/[0.06] bg-white/[0.03] text-white/40 hover:border-white/[0.1] hover:bg-white/[0.06] hover:text-white/75",
            )}
          >
            <Icon
              className={cn(
                "h-3 w-3",
                selected ? "text-accent" : "text-white/30",
              )}
              strokeWidth={2}
            />
            {filter.label}
          </button>
        );
      })}
    </div>
  );
}

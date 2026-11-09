import { Check, Download, Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";

export type TrackDownloadState = "queued" | "downloading";

interface TrackStatusActionProps {
  downloaded: boolean;
  format?: string | null;
  pending?: TrackDownloadState | null;
  onDownload: () => void;
  className?: string;
}

/**
 * Compact status control for a track row:
 * - downloaded: quiet check + "In library" + actual local format;
 * - missing: ghost download action + target format;
 * - pending: spinner + queue state.
 *
 * Deliberately borderless so the status column stays calm next to the row.
 */
export function TrackStatusAction({
  downloaded,
  format,
  pending,
  onDownload,
  className,
}: TrackStatusActionProps) {
  if (downloaded) {
    return (
      <span
        className={cn(
          "inline-flex h-7 items-center gap-1.5 whitespace-nowrap text-[9.5px] font-medium text-white/45",
          className,
        )}
        title={format ? `In library · ${format}` : "In library"}
      >
        <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-400/10 text-emerald-300/90">
          <Check className="h-2.5 w-2.5" strokeWidth={3} />
        </span>
        <span>In library</span>
        {format && (
          <span className="text-[8px] font-bold uppercase tracking-[0.1em] text-white/25">
            {format}
          </span>
        )}
      </span>
    );
  }

  const label =
    pending === "downloading"
      ? "Downloading"
      : pending === "queued"
        ? "Queued"
        : "Download";

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onDownload();
      }}
      disabled={Boolean(pending)}
      aria-label={pending ? label : format ? `Download ${format}` : "Download"}
      title={pending ? label : format ? `Download ${format}` : "Download"}
      className={cn(
        "group/status -mr-1 inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 text-[9.5px] font-medium text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/85 focus-visible:bg-white/[0.06] focus-visible:text-white focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60",
        className,
      )}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent/70" />
      ) : (
        <Download className="h-3.5 w-3.5 shrink-0 text-white/35 transition-colors group-hover/status:text-white/65" />
      )}
      <span>{label}</span>
      {!pending && format && (
        <span className="text-[8px] font-bold uppercase tracking-[0.1em] text-white/20 transition-colors group-hover/status:text-white/40">
          {format}
        </span>
      )}
    </button>
  );
}

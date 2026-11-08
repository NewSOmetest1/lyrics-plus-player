import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  Download,
  Loader2,
  Music2,
  Trash2,
  X,
} from "lucide-react";

import type { DownloadStage, DownloadTask } from "@/types";
import { cn } from "@/lib/cn";
import { useDownloadStore } from "@/store/downloadStore";

const EASE = [0.2, 0, 0, 1] as const;

const STAGE_LABEL: Record<DownloadStage, string> = {
  queued: "Waiting in queue",
  mornye: "Mornye Lossless",
  soulseek: "Soulseek P2P",
  deezer: "Deezer / Streamrip",
  bandcamp: "Bandcamp",
  soundcloud: "SoundCloud",
  youtube: "YouTube",
  cropping: "Cropping cover",
  done: "Finishing",
};

const SOURCE_TONE: Record<string, string> = {
  Mornye: "border-amber-300/25 bg-amber-300/10 text-amber-200/85",
  "Soulseek P2P": "border-fuchsia-300/25 bg-fuchsia-300/10 text-fuchsia-200/85",
  Deezer: "border-sky-300/25 bg-sky-300/10 text-sky-200/85",
  Bandcamp: "border-cyan-300/25 bg-cyan-300/10 text-cyan-200/85",
  SoundCloud: "border-orange-300/25 bg-orange-300/10 text-orange-200/85",
  YouTube: "border-red-300/25 bg-red-300/10 text-red-200/85",
};

function isActive(task: DownloadTask): boolean {
  return task.status === "queued" || task.status === "downloading";
}

function statusLine(task: DownloadTask): string {
  switch (task.status) {
    case "queued":
      return "Queued";
    case "downloading":
      return STAGE_LABEL[task.stage];
    case "completed":
      return task.message || "Downloaded";
    case "duplicate":
      return task.message || "Duplicate skipped";
    case "failed":
      return task.message || "Download failed";
    case "cancelled":
      return task.message || "Cancelled";
    default:
      return "";
  }
}

function TaskRow({ task }: { task: DownloadTask }) {
  const cancel = useDownloadStore((state) => state.cancel);
  const active = isActive(task);
  const done = task.status === "completed" || task.status === "duplicate";
  const failed = task.status === "failed";
  const percent = Math.max(0, Math.min(100, task.percent));

  return (
    <div
      className={cn(
        "group relative flex gap-2.5 rounded-xl px-2 py-2 transition-colors",
        active ? "bg-white/[0.035]" : "hover:bg-white/[0.03]",
      )}
    >
      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/[0.05]">
        {task.coverUrl ? (
          <img
            src={task.coverUrl}
            alt=""
            loading="lazy"
            draggable={false}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            <Music2 className="h-4 w-4 text-white/25" />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11.5px] font-semibold text-white/85">
              {task.title}
            </p>
            <p className="truncate text-[10px] text-white/35">{task.artist}</p>
          </div>
          {task.source && (
            <span
              className={cn(
                "shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em]",
                SOURCE_TONE[task.source] ??
                  "border-white/10 bg-white/[0.05] text-white/45",
              )}
            >
              {task.source}
            </span>
          )}
          {active ? (
            <button
              type="button"
              onClick={() => void cancel(task.id)}
              title="Cancel download"
              aria-label={`Cancel download of ${task.title}`}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white/25 transition hover:bg-white/10 hover:text-white/80"
            >
              <X className="h-3 w-3" />
            </button>
          ) : done ? (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
              <Check className="h-3 w-3" />
            </span>
          ) : failed ? (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-400/15 text-red-300">
              <X className="h-3 w-3" />
            </span>
          ) : null}
        </div>

        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
            <motion.div
              className={cn(
                "h-full rounded-full",
                failed
                  ? "bg-red-400/70"
                  : done
                    ? "bg-emerald-400/80"
                    : "bg-accent",
              )}
              initial={false}
              animate={{ width: `${done ? 100 : percent}%` }}
              transition={{ duration: 0.25, ease: EASE }}
            />
          </div>
          <span className="shrink-0 text-[9px] tabular-nums text-white/30">
            {done ? "100%" : `${Math.round(percent)}%`}
          </span>
        </div>

        <div className="mt-1 flex items-center gap-1.5 text-[9.5px] text-white/30">
          {active && task.status === "downloading" && (
            <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin text-accent/70" />
          )}
          <span className="truncate">{statusLine(task)}</span>
          {active && task.speed && (
            <span className="shrink-0 text-white/20">{task.speed}</span>
          )}
          {active && task.message && !task.speed && (
            <span className="shrink-0 text-white/20">{task.message}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function DownloadDrawer() {
  const open = useDownloadStore((state) => state.open);
  const tasks = useDownloadStore((state) => state.tasks);
  const activeCount = useDownloadStore((state) => state.activeCount);
  const completedCount = useDownloadStore((state) => state.completedCount);
  const close = useDownloadStore((state) => state.close);
  const clearCompleted = useDownloadStore((state) => state.clearCompleted);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="downloads"
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.985 }}
          transition={{ duration: 0.22, ease: EASE }}
          className="lucid-glass-panel glass fixed bottom-[104px] right-4 z-[70] flex w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
          role="dialog"
          aria-label="Downloads"
        >
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-3.5 py-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Download className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-[12.5px] font-bold text-white">
                Downloads
              </h2>
              <p className="text-[9.5px] text-white/35">
                {activeCount > 0
                  ? `${activeCount} active · cascading FLAC`
                  : "All downloads finished"}
              </p>
            </div>
            {completedCount > 0 && activeCount === 0 && (
              <button
                type="button"
                onClick={() => void clearCompleted()}
                title="Clear finished downloads"
                aria-label="Clear finished downloads"
                className="flex h-6 items-center gap-1 rounded-full border border-white/[0.08] px-2 text-[9px] font-semibold text-white/40 transition hover:bg-white/[0.08] hover:text-white/80"
              >
                <Trash2 className="h-2.5 w-2.5" />
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={close}
              title="Close downloads"
              aria-label="Close downloads"
              className="flex h-6 w-6 items-center justify-center rounded-full text-white/35 transition hover:bg-white/[0.08] hover:text-white"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="no-scrollbar max-h-[min(52vh,420px)] min-h-0 overflow-y-auto p-1.5">
            {tasks.length === 0 ? (
              <div className="flex flex-col items-center px-4 py-10 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.05] text-white/25">
                  <Download className="h-4 w-4" />
                </span>
                <p className="mt-2.5 text-[11px] font-semibold text-white/55">
                  No downloads yet
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-white/25">
                  Download a release from New Releases and it will appear here.
                </p>
              </div>
            ) : (
              tasks.map((task) => <TaskRow key={task.id} task={task} />)
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

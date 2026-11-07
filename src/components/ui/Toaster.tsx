import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useToastStore } from "@/store/toastStore";
import { cn } from "@/lib/cn";

const icons = {
  info: Info,
  success: CheckCircle2,
  error: AlertTriangle,
};

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    <div
      role="status"
      aria-live="polite"
      className="toast-container toast-notification-root notification-center pointer-events-none fixed bottom-[112px] left-1/2 z-[99999] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col items-center gap-2"
    >
      {toasts.map((toast) => {
        const Icon = icons[toast.kind];
        return (
          <div
            key={toast.id}
            className="toast-item pointer-events-auto relative z-[100000] flex w-full items-start gap-3 px-4 py-3"
          >
            <span
              className={cn(
                "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset",
                toast.kind === "error" &&
                  "bg-red-500/15 text-red-300 ring-red-400/20",
                toast.kind === "success" &&
                  "bg-emerald-500/15 text-emerald-300 ring-emerald-300/20",
                toast.kind === "info" &&
                  "bg-white/10 text-white/85 ring-white/10",
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-white">{toast.title}</p>
              {toast.description && (
                <p className="mt-0.5 text-[12px] leading-relaxed text-white/70">
                  {toast.description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="toast-dismiss mt-0.5 rounded-full p-1 transition hover:bg-white/10"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

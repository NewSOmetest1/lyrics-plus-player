import { useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  Loader2,
  LogIn,
  LogOut,
  PlugZap,
  X,
} from "lucide-react";

import {
  backend,
  isDesktop,
  type ProviderTestResult,
} from "@/lib/api";
import { cn } from "@/lib/cn";
import { useToastStore } from "@/store/toastStore";

const SP_DC_KEY = "spotify_sp_dc";
const SP_KEY_KEY = "spotify_sp_key";

function testToast(result: ProviderTestResult) {
  const lines = `${result.lines} line${result.lines === 1 ? "" : "s"}`;
  if (result.ok) {
    useToastStore.getState().push({
      kind: "success",
      title: `✓ Spotify Connected (${lines} ${result.synced ? "synced" : "unsynced"})`,
      description: result.sample[0] ?? result.message,
    });
  } else {
    useToastStore.getState().push({
      kind: "error",
      title: `✕ Spotify Error: ${result.statusText || "Failed"}`,
      description: result.message || lines,
    });
  }
}

export function SpotifyAuthCard({ open }: { open: boolean }) {
  const [spDc, setSpDc] = useState("");
  const [spKey, setSpKey] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [busy, setBusy] = useState<"login" | "logout" | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      try {
        const [storedDc, storedKey, status] = await Promise.all([
          backend.getSetting(SP_DC_KEY),
          backend.getSetting(SP_KEY_KEY),
          backend.spotifyStatus().catch(() => null),
        ]);
        if (!active) return;
        const dc = storedDc?.trim() ?? "";
        const key = storedKey?.trim() ?? "";
        setSpDc(dc);
        setSpKey(key);
        const hasBoth = Boolean((dc && key) || status?.authenticated);
        setAuthenticated(hasBoth);
        // A legacy sp_dc-only setup stays usable as a manual migration path.
        if ((dc && !key) || (status?.hasSpDc && !status.hasSpKey)) {
          setManualOpen(true);
        }
      } catch {
        // Settings are best-effort when the main process is unavailable.
      }
    })();
    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !isDesktop || !window.electronAPI) return;
    const offSuccess = window.electronAPI.on<{ ok: boolean }>(
      "spotify:auth-success",
      () => {
        setBusy(null);
        setAuthenticated(true);
        setManualOpen(false);
      },
    );
    const offLogout = window.electronAPI.on<{ ok: boolean }>(
      "spotify:auth-logout",
      () => {
        setAuthenticated(false);
        setSpDc("");
        setSpKey("");
        setTestResult(null);
      },
    );
    const offTest = window.electronAPI.on<ProviderTestResult>(
      "spotify:auth-test",
      (result) => {
        setTestResult(result.ok ? "success" : "error");
        testToast(result);
      },
    );
    return () => {
      offSuccess();
      offLogout();
      offTest();
    };
  }, [open]);

  const login = async () => {
    if (!isDesktop) {
      useToastStore.getState().push({
        kind: "info",
        title: "Desktop app only",
        description: "Spotify login needs the Electron desktop app.",
      });
      return;
    }
    setBusy("login");
    setTestResult(null);
    try {
      const result = await backend.spotifyLogin();
      if (!result.ok) {
        if (!result.cancelled) {
          useToastStore.getState().push({
            kind: "error",
            title: "Spotify login failed",
            description: result.message || "The login window was closed.",
          });
        }
        return;
      }
      setSpDc(result.spDc ?? "");
      setSpKey(result.spKey ?? "");
      setAuthenticated(true);
      setManualOpen(false);
      useToastStore.getState().push({
        kind: "success",
        title: "✓ Авторизован в Spotify",
        description: "sp_dc и sp_key сохранены. Проверяю подключение…",
      });
    } catch (error) {
      useToastStore.getState().push({
        kind: "error",
        title: "Spotify login failed",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const logout = async () => {
    setBusy("logout");
    try {
      await backend.spotifyLogout();
      setAuthenticated(false);
      setSpDc("");
      setSpKey("");
      setTestResult(null);
      useToastStore.getState().push({
        kind: "info",
        title: "Вы вышли из Spotify",
        description: "Куки sp_dc и sp_key удалены.",
      });
    } catch (error) {
      useToastStore.getState().push({
        kind: "error",
        title: "Spotify logout failed",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const saveManual = async () => {
    setSaving(true);
    try {
      await Promise.all([
        backend.setSetting(SP_DC_KEY, spDc.trim()),
        backend.setSetting(SP_KEY_KEY, spKey.trim()),
      ]);
      const both = Boolean(spDc.trim() && spKey.trim());
      setAuthenticated(both);
      useToastStore.getState().push({
        kind: "success",
        title: both ? "Spotify cookies saved" : "Spotify cookies removed",
        description: both
          ? "Both sp_dc and sp_key are stored."
          : "Both cookie fields must be filled to authorize.",
      });
    } catch (error) {
      useToastStore.getState().push({
        kind: "error",
        title: "Could not save Spotify cookies",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (!isDesktop) {
      useToastStore.getState().push({
        kind: "info",
        title: "Desktop app only",
        description: "Provider test needs the Electron main process.",
      });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      // Test the values currently visible in the form, not the older copies
      // that may still be on disk.
      const result = await backend.testProvider("spotify", {
        spDc: spDc.trim(),
        spKey: spKey.trim(),
      });
      setTestResult(result?.ok ? "success" : "error");
      if (result) testToast(result);
    } catch (error) {
      setTestResult("error");
      useToastStore.getState().push({
        kind: "error",
        title: "Spotify test failed",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-white/70">
            Spotify account
          </p>
          {authenticated ? (
            <p className="mt-1 flex items-center gap-1.5 text-[10.5px] font-medium text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              ✓ Авторизован в Spotify
            </p>
          ) : (
            <p className="mt-1 text-[10px] leading-relaxed text-white/30">
              Нативный вход в окне Spotify. Сохраняются обе куки: sp_dc и sp_key.
            </p>
          )}
        </div>
        {authenticated ? (
          <button
            type="button"
            onClick={() => void logout()}
            disabled={busy !== null}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.04] px-2.5 py-1.5 text-[10.5px] font-semibold text-white/60 transition hover:border-white/[0.16] hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
          >
            {busy === "logout" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogOut className="h-3.5 w-3.5" />
            )}
            Выйти
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void login()}
            disabled={busy !== null}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#1DB954] px-2.5 py-1.5 text-[10.5px] font-bold text-black shadow-[0_4px_18px_rgba(29,185,84,0.22)] transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          >
            {busy === "login" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogIn className="h-3.5 w-3.5" />
            )}
            Войти в Spotify
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void test()}
          disabled={testing}
          data-test-result={testing ? "testing" : (testResult ?? "idle")}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[9.5px] font-semibold transition disabled:opacity-50",
            testResult === "success"
              ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15"
              : testResult === "error"
                ? "border-red-400/30 bg-red-500/10 text-red-300 hover:bg-red-500/15"
                : "border-white/[0.08] bg-white/[0.04] text-white/45 hover:bg-white/[0.09] hover:text-white/80",
          )}
        >
          {testing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : testResult === "success" ? (
            <Check className="h-3 w-3" strokeWidth={3} />
          ) : testResult === "error" ? (
            <X className="h-3 w-3" strokeWidth={3} />
          ) : (
            <PlugZap className="h-3 w-3" />
          )}
          {testing ? "Testing…" : "Test Connection"}
        </button>

        <button
          type="button"
          onClick={() => setManualOpen((value) => !value)}
          className="inline-flex items-center gap-1 text-[10px] font-medium text-white/30 transition hover:text-white/60"
          aria-expanded={manualOpen}
        >
          <ChevronDown
            className={cn(
              "h-3 w-3 transition-transform",
              manualOpen && "rotate-180",
            )}
          />
          Вручную (sp_dc + sp_key)
        </button>
      </div>

      {manualOpen && (
        <div className="mt-2.5 space-y-2 border-t border-white/[0.06] pt-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[9.5px] leading-relaxed text-white/25">
              Fallback для старых сессий. Обе куки должны быть из одного браузера.
            </p>
            <button
              type="button"
              onClick={() => setRevealed((value) => !value)}
              className="rounded-md p-1 text-white/30 transition hover:text-white/70"
              aria-label={revealed ? "Hide cookies" : "Show cookies"}
            >
              {revealed ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <label className="block">
            <span className="mb-1 block text-[9px] font-bold uppercase tracking-[0.14em] text-white/30">
              sp_dc
            </span>
            <input
              type={revealed ? "text" : "password"}
              value={spDc}
              onChange={(event) => setSpDc(event.target.value)}
              placeholder="Paste sp_dc cookie"
              autoComplete="off"
              spellCheck={false}
              className="h-8 w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 text-[11px] text-white placeholder:text-white/25 outline-none transition focus:border-accent/40 focus:bg-white/[0.06]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[9px] font-bold uppercase tracking-[0.14em] text-white/30">
              sp_key
            </span>
            <input
              type={revealed ? "text" : "password"}
              value={spKey}
              onChange={(event) => setSpKey(event.target.value)}
              placeholder="Paste sp_key cookie"
              autoComplete="off"
              spellCheck={false}
              className="h-8 w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 text-[11px] text-white placeholder:text-white/25 outline-none transition focus:border-accent/40 focus:bg-white/[0.06]"
            />
          </label>
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => void saveManual()}
              disabled={saving}
              className="rounded-lg border border-white/[0.1] bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-semibold text-white/55 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save cookies"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

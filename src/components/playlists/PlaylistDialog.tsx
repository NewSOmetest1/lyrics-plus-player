import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ListMusic, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { usePlaylistDialogStore } from "@/store/playlistDialogStore";
import { usePlaylistStore } from "@/store/playlistStore";
import { useToastStore } from "@/store/toastStore";

export function PlaylistDialog() {
  const open = usePlaylistDialogStore((state) => state.open);
  const mode = usePlaylistDialogStore((state) => state.mode);
  const playlistId = usePlaylistDialogStore((state) => state.playlistId);
  const initialName = usePlaylistDialogStore((state) => state.initialName);
  const initialDescription = usePlaylistDialogStore(
    (state) => state.initialDescription,
  );
  const pendingTrackPath = usePlaylistDialogStore(
    (state) => state.pendingTrackPath,
  );
  const close = usePlaylistDialogStore((state) => state.close);

  const createPlaylist = usePlaylistStore((state) => state.create);
  const updatePlaylist = usePlaylistStore((state) => state.update);

  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setDescription(initialDescription);
    setBusy(false);
  }, [open, initialName, initialDescription]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);

    if (mode === "rename" && playlistId) {
      const playlist = await updatePlaylist(playlistId, {
        name: trimmed,
        description,
      });
      setBusy(false);
      if (!playlist) return;
      useToastStore.getState().push({
        kind: "success",
        title: "Playlist renamed",
        description: playlist.name,
      });
      close();
      return;
    }

    const playlist = await createPlaylist({
      name: trimmed,
      description,
      trackPaths: pendingTrackPath ? [pendingTrackPath] : [],
    });
    setBusy(false);
    if (!playlist) return;

    useToastStore.getState().push({
      kind: "success",
      title: pendingTrackPath
        ? `Added to "${playlist.name}"`
        : "Playlist created",
      description: pendingTrackPath
        ? undefined
        : `${playlist.name} is ready for tracks.`,
    });
    close();
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="playlist-dialog"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[180] flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <motion.form
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="playlist-dialog-title"
            className="settings-modal w-full max-w-[430px] overflow-hidden rounded-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <ListMusic className="h-4 w-4" />
                </span>
                <div>
                  <h2
                    id="playlist-dialog-title"
                    className="text-[14px] font-bold text-white"
                  >
                    {mode === "rename" ? "Edit playlist" : "New playlist"}
                  </h2>
                  <p className="text-[10.5px] text-white/30">
                    {mode === "rename"
                      ? "Update the name or description."
                      : pendingTrackPath
                        ? "The selected track will be added automatically."
                        : "Give your collection a name."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={close}
                className="rounded-full p-1.5 text-white/30 transition hover:bg-white/10 hover:text-white"
                aria-label="Close dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3.5 px-5 py-4">
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">
                  Name
                </span>
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Late night favourites"
                  maxLength={100}
                  className="h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-[12.5px] text-white placeholder:text-white/20 outline-none transition focus:border-accent/40 focus:bg-white/[0.06]"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">
                  Description <span className="normal-case tracking-normal text-white/15">optional</span>
                </span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What is this playlist for?"
                  rows={2}
                  maxLength={240}
                  className="w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12.5px] text-white placeholder:text-white/20 outline-none transition focus:border-accent/40 focus:bg-white/[0.06]"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] px-5 py-3.5">
              <button
                type="button"
                onClick={close}
                className="h-8 rounded-full px-3.5 text-[11.5px] font-semibold text-white/40 transition hover:bg-white/[0.06] hover:text-white/75"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name.trim() || busy}
                className={cn(
                  "h-8 rounded-full bg-accent px-4 text-[11.5px] font-bold text-black transition hover:brightness-110 disabled:opacity-40",
                )}
              >
                {busy
                  ? "Saving…"
                  : mode === "rename"
                    ? "Save changes"
                    : "Create playlist"}
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

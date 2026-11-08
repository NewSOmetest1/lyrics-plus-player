import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  promises as fs,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

import { scanLibrary } from "./scanner";
import type { LibraryStore } from "./store";
import type {
  DownloadRequest,
  DownloadSnapshot,
  DownloadStage,
  DownloadTask,
  DownloadTaskStatus,
  ScanSummary,
  TrackRecord,
} from "./types";

export const DEFAULT_PYTHON_PATH = "python3";
export const DEFAULT_SCRIPT_PATH = "";
export const DEFAULT_MUSIC_DIR = "~/StreamripDownloads";

const SOULSEEK_PERCENT = /(\d+(?:\.\d+)?)\s*%/;
const SOULSEEK_SPEED = /(\d+(?:\.\d+)?)\s*KiB\/s/i;
const SOULSEEK_SIZE = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*MiB/i;

const STAGE_PERCENT: Record<DownloadStage, number> = {
  queued: 0,
  mornye: 12,
  soulseek: 24,
  deezer: 48,
  bandcamp: 64,
  soundcloud: 78,
  youtube: 88,
  cropping: 96,
  done: 100,
};

export function expandHomePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

export interface DownloaderSettings {
  pythonPath: string;
  scriptPath: string;
  musicDir: string;
}

export function resolveDownloaderSettings(store: {
  getSetting(key: string): string | undefined;
}): DownloaderSettings {
  const pythonPath =
    store.getSetting("downloader_python_path")?.trim() || DEFAULT_PYTHON_PATH;
  const scriptPath =
    store.getSetting("downloader_script_path")?.trim() || DEFAULT_SCRIPT_PATH;
  const musicDir =
    store.getSetting("downloader_music_dir")?.trim() || DEFAULT_MUSIC_DIR;
  return {
    pythonPath,
    scriptPath: scriptPath ? expandHomePath(scriptPath) : "",
    musicDir: expandHomePath(musicDir),
  };
}

export interface DownloadManagerCompletion {
  snapshot: DownloadSnapshot;
  completed: DownloadTask[];
  failed: DownloadTask[];
  scan: ScanSummary | null;
}

interface DownloadManagerOptions {
  store: LibraryStore;
  coversDir: string;
  userDataDir: string;
  getSettings: () => DownloaderSettings;
  onProgress: (snapshot: DownloadSnapshot) => void;
  onComplete: (payload: DownloadManagerCompletion) => void | Promise<void>;
}

interface Batch {
  id: string;
  tasks: DownloadTask[];
  links: string[];
  linksFile: string;
  startedAt: number;
  process: ReturnType<typeof spawn> | null;
  currentTaskId: string | null;
  cancelled: boolean;
  finished: boolean;
  stdoutPaths: Map<string, string>;
}

function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function titleKey(value: string): string {
  return normalizeName(
    value
      .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
      .replace(/\b(feat|ft|featuring)\b.*$/i, " ")
      .replace(
        /\b(explicit|remaster(?:ed)?|deluxe|bonus|single version|album version)\b/gi,
        " ",
      ),
  );
}

function artistKeys(value: string): string[] {
  const keys = new Set<string>();
  const full = normalizeName(value);
  if (full) keys.add(full);
  for (const part of value.split(
    /\s*(?:,|;|&|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b)\s*/i,
  )) {
    const key = normalizeName(part);
    if (key) keys.add(key);
  }
  return [...keys];
}

function stageToSource(stage: DownloadStage): string | null {
  switch (stage) {
    case "mornye":
      return "Mornye";
    case "soulseek":
      return "Soulseek P2P";
    case "deezer":
      return "Deezer";
    case "bandcamp":
      return "Bandcamp";
    case "soundcloud":
      return "SoundCloud";
    case "youtube":
      return "YouTube";
    default:
      return null;
  }
}

function isActiveStatus(status: DownloadTaskStatus): boolean {
  return status === "queued" || status === "downloading";
}

function isFinishedStatus(status: DownloadTaskStatus): boolean {
  return !isActiveStatus(status);
}

function safeText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export class DownloadManager {
  private readonly tasks = new Map<string, DownloadTask>();
  private readonly batches: Batch[] = [];
  private readonly batchByTask = new Map<string, Batch>();
  private activeBatch: Batch | null = null;
  private disposed = false;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEmitAt = 0;

  constructor(private readonly options: DownloadManagerOptions) {}

  getSnapshot(): DownloadSnapshot {
    const rank = (task: DownloadTask): number => {
      if (task.status === "downloading") return 0;
      if (task.status === "queued") return 1;
      return 2;
    };
    const tasks = [...this.tasks.values()].sort((a, b) => {
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      return (
        (b.completedAt ?? b.startedAt ?? 0) -
        (a.completedAt ?? a.startedAt ?? 0)
      );
    });
    return {
      tasks: tasks.map((task) => ({ ...task })),
      activeCount: tasks.filter((task) => isActiveStatus(task.status)).length,
      completedCount: tasks.filter(
        (task) => task.status === "completed" || task.status === "duplicate",
      ).length,
    };
  }

  start(requests: DownloadRequest[]): DownloadSnapshot {
    if (this.disposed) return this.getSnapshot();
    const batch: Batch = {
      id: randomUUID(),
      tasks: [],
      links: [],
      linksFile: "",
      startedAt: Date.now(),
      process: null,
      currentTaskId: null,
      cancelled: false,
      finished: false,
      stdoutPaths: new Map(),
    };
    const seen = new Set<string>();
    for (const request of requests) {
      const url = safeText(request.spotifyUrl);
      const trackId = safeText(request.trackId);
      if (!url || !trackId || seen.has(url)) continue;
      seen.add(url);
      const existing = [...this.tasks.values()].find(
        (task) =>
          task.trackId === trackId &&
          (task.status === "queued" ||
            task.status === "downloading" ||
            task.status === "completed"),
      );
      if (existing) continue;

      const task: DownloadTask = {
        id: randomUUID(),
        releaseId: safeText(request.releaseId),
        trackId,
        title: safeText(request.title) || "Unknown track",
        artist: safeText(request.artist) || "Unknown artist",
        album: safeText(request.album),
        coverUrl: request.coverUrl ?? null,
        spotifyUrl: url,
        status: "queued",
        stage: "queued",
        source: null,
        percent: 0,
        speed: null,
        message: null,
        startedAt: null,
        completedAt: null,
        filePath: null,
      };
      this.tasks.set(task.id, task);
      batch.tasks.push(task);
      batch.links.push(url);
      this.batchByTask.set(task.id, batch);
    }

    if (batch.tasks.length > 0) {
      this.batches.push(batch);
      this.emit();
      this.pump();
    }
    return this.getSnapshot();
  }

  cancel(taskId: string): DownloadSnapshot {
    const task = this.tasks.get(taskId);
    if (!task || !isActiveStatus(task.status)) return this.getSnapshot();
    const batch = this.batchByTask.get(taskId);
    if (!batch) return this.getSnapshot();

    if (batch === this.activeBatch) {
      for (const item of batch.tasks) {
        if (isActiveStatus(item.status)) {
          item.status = "cancelled";
          item.stage = "done";
          item.message =
            item.id === taskId
              ? "Cancelled by user"
              : "Cancelled with the active download";
          item.completedAt = Date.now();
          item.speed = null;
        }
      }
      batch.cancelled = true;
      this.killProcess(batch);
    } else {
      task.status = "cancelled";
      task.stage = "done";
      task.message = "Cancelled by user";
      task.completedAt = Date.now();
      task.speed = null;
      batch.tasks = batch.tasks.filter((item) => item.id !== taskId);
      batch.links = batch.links.filter((link) => link !== task.spotifyUrl);
      this.batchByTask.delete(taskId);
      if (batch.tasks.length === 0) {
        const index = this.batches.indexOf(batch);
        if (index >= 0) this.batches.splice(index, 1);
      }
    }
    this.emit();
    return this.getSnapshot();
  }

  clearCompleted(): DownloadSnapshot {
    for (const [id, task] of this.tasks) {
      if (isFinishedStatus(task.status)) {
        this.tasks.delete(id);
        this.batchByTask.delete(id);
      }
    }
    this.emit();
    return this.getSnapshot();
  }

  dispose(): void {
    this.disposed = true;
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    if (this.activeBatch) {
      this.activeBatch.cancelled = true;
      this.killProcess(this.activeBatch);
    }
    this.batches.length = 0;
  }

  private emit(): void {
    this.options.onProgress(this.getSnapshot());
  }

  /**
   * Stdout can be chatty (Soulseek prints a progress line every ~1.5 s, and
   * yt-dlp/streamrip emit their own output), so coalesce UI updates instead of
   * crossing the IPC bridge for every single line.
   */
  private scheduleEmit(): void {
    if (this.disposed) return;
    const interval = 180;
    const elapsed = Date.now() - this.lastEmitAt;
    if (elapsed >= interval) {
      this.lastEmitAt = Date.now();
      this.emit();
      return;
    }
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.lastEmitAt = Date.now();
      this.emit();
    }, interval - elapsed);
  }

  private killProcess(batch: Batch): void {
    const child = batch.process;
    if (!child || child.killed) return;
    try {
      child.kill("SIGTERM");
    } catch {
      // Process already exited.
    }
    setTimeout(() => {
      if (child.exitCode === null) {
        try {
          child.kill("SIGKILL");
        } catch {
          // Process already exited.
        }
      }
    }, 3000);
  }

  private pump(): void {
    if (this.disposed || this.activeBatch) return;
    const batch = this.batches.shift();
    if (!batch) return;
    const settings = this.options.getSettings();

    if (!settings.scriptPath) {
      this.failBatch(
        batch,
        "Downloader script path is not configured. Set it in Settings → Downloader.",
      );
      return;
    }
    if (!existsSync(settings.scriptPath)) {
      this.failBatch(
        batch,
        `Downloader script not found: ${settings.scriptPath}`,
      );
      return;
    }
    const scriptDir = path.dirname(settings.scriptPath);
    mkdirSync(this.options.userDataDir, { recursive: true });
    const linksFile = path.join(
      this.options.userDataDir,
      `download-links-${Date.now()}-${batch.id.slice(0, 8)}.txt`,
    );
    try {
      writeFileSync(linksFile, `${batch.links.join("\n")}\n`, "utf8");
    } catch (error) {
      this.failBatch(
        batch,
        `Could not write download queue: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    batch.linksFile = linksFile;
    this.activeBatch = batch;
    this.emit();

    const env = {
      ...process.env,
      RIP_FIX_COVERS: "true",
      PYTHONUNBUFFERED: "1",
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        settings.pythonPath,
        [settings.scriptPath, linksFile],
        {
          cwd: scriptDir,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch (error) {
      this.failBatch(
        batch,
        `Could not start the downloader: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    batch.process = child;
    batch.startedAt = Date.now();

    let stderr = "";
    if (child.stdout) {
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => this.handleLine(batch, line));
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString("utf8")}`.slice(-6000);
      });
    }
    child.on("error", (error) => {
      if (batch.finished) return;
      this.failBatch(
        batch,
        `Downloader failed to start: ${error.message}`,
      );
    });
    child.on("close", (code) => {
      void this.finishBatch(batch, code, stderr);
    });
  }

  private handleLine(batch: Batch, line: string): void {
    try {
      this.processLine(batch, line);
    } finally {
      this.scheduleEmit();
    }
  }

  private processLine(batch: Batch, line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    const header = /Spotify:\s*(https?:\/\/\S+)/i.exec(trimmed);
    if (header) {
      this.settleCurrent(batch);
      const url = header[1].replace(/[.,;]+$/, "");
      const index = batch.links.findIndex((link) => link === url);
      const task =
        (index >= 0 ? batch.tasks[index] : undefined) ??
        batch.tasks.find((item) => item.spotifyUrl === url) ??
        batch.tasks.find((item) => item.status === "queued");
      if (task) {
        task.status = "downloading";
        task.stage = "queued";
        task.percent = Math.max(task.percent, 1);
        task.startedAt = Date.now();
        task.message = null;
        batch.currentTaskId = task.id;
      }
      return;
    }

    const current = batch.currentTaskId
      ? this.tasks.get(batch.currentTaskId)
      : undefined;
    if (!current) return;

    if (/⛔\s*Не найдено совпадений/i.test(trimmed)) {
      this.failTask(current, "No source matched this track");
      return;
    }
    if (/Не удалось получить метаданные Spotify/i.test(trimmed)) {
      this.failTask(current, "Could not read Spotify metadata");
      return;
    }
    if (/Spotify не вернул название трека/i.test(trimmed)) {
      this.failTask(current, "Spotify returned no track title");
      return;
    }
    if (/Неожиданная ошибка/i.test(trimmed)) {
      this.failTask(current, "Downloader error: unexpected exception");
      return;
    }

    if (/Дубликат FLAC\s*—\s*удаляю копию/i.test(trimmed)) {
      current.status = "duplicate";
      current.stage = "done";
      current.percent = 100;
      current.completedAt = Date.now();
      current.message = "Duplicate skipped";
      current.speed = null;
      return;
    }

    if (/\[История\]\s*Уже скачано/i.test(trimmed)) {
      current.status = "duplicate";
      current.stage = "done";
      current.percent = 100;
      current.completedAt = Date.now();
      current.message = "Already downloaded";
      current.speed = null;
      return;
    }
    if (/\[Диск\]\s*Уже есть в медиатеке/i.test(trimmed)) {
      current.status = "duplicate";
      current.stage = "done";
      current.percent = 100;
      current.completedAt = Date.now();
      current.message = "Already in library";
      current.speed = null;
      const pathMatch = /:\s*(.+)$/.exec(trimmed);
      if (pathMatch?.[1] && pathMatch[1].trim().startsWith("/")) {
        current.filePath = pathMatch[1].trim();
      }
      return;
    }

    if (/Mornye Lossless/i.test(trimmed)) {
      this.setStage(current, "mornye");
    } else if (/Soulseek\s*\[/i.test(trimmed)) {
      this.setStage(current, "soulseek");
    } else if (/Streamrip\s*\//i.test(trimmed)) {
      this.setStage(current, "deezer");
    } else if (/yt-dlp\s*\/\s*Bandcamp/i.test(trimmed)) {
      this.setStage(current, "bandcamp");
    } else if (/yt-dlp\s*\/\s*SoundCloud/i.test(trimmed)) {
      this.setStage(current, "soundcloud");
    } else if (/yt-dlp\s*\/\s*YouTube/i.test(trimmed)) {
      this.setStage(current, "youtube");
    } else if (/Исправлена квадратная обложка/i.test(trimmed)) {
      this.setStage(current, "cropping");
      current.percent = Math.max(current.percent, 99);
      current.message = "Cropped to 1:1";
      return;
    }

    if (SOULSEEK_PERCENT.test(trimmed) && current.stage === "soulseek") {
      const percent = Number(SOULSEEK_PERCENT.exec(trimmed)?.[1] ?? 0);
      if (Number.isFinite(percent)) {
        // Map the P2P transfer onto the Soulseek band so a fallback to the
        // next source never leaves the bar stuck at 100%.
        const start = STAGE_PERCENT.soulseek;
        const end = STAGE_PERCENT.deezer;
        const banded =
          start + (Math.min(100, Math.max(0, percent)) / 100) * (end - start);
        current.percent = Math.max(current.percent, banded);
      }
      const speed = SOULSEEK_SPEED.exec(trimmed)?.[1];
      if (speed) current.speed = `${speed} KiB/s`;
      const size = SOULSEEK_SIZE.exec(trimmed);
      if (size) current.message = `${size[1]} / ${size[2]} MiB`;
    }

    if (/✅\s*Soulseek FLAC принят/i.test(trimmed)) {
      current.source = "Soulseek P2P";
      const pathMatch = /:\s*(.+)$/.exec(trimmed);
      if (pathMatch?.[1] && pathMatch[1].startsWith("/")) {
        current.filePath = pathMatch[1].trim();
        batch.stdoutPaths.set(current.id, current.filePath);
      }
    } else if (/✅\s*Mornye успешно загрузил Lossless/i.test(trimmed)) {
      current.source = "Mornye";
    } else if (/✅\s*Deezer:/i.test(trimmed)) {
      current.source = "Deezer";
    }
  }

  private setStage(task: DownloadTask, stage: DownloadStage): void {
    task.stage = stage;
    task.source = stageToSource(stage) ?? task.source;
    task.percent = Math.max(task.percent, STAGE_PERCENT[stage]);
    if (stage !== "soulseek") task.speed = null;
  }

  private failTask(task: DownloadTask, message: string): void {
    task.status = "failed";
    task.stage = "done";
    task.message = message;
    task.completedAt = Date.now();
    task.speed = null;
  }

  private settleCurrent(batch: Batch): void {
    if (!batch.currentTaskId) return;
    const task = this.tasks.get(batch.currentTaskId);
    batch.currentTaskId = null;
    if (!task || task.status !== "downloading") return;
    task.status = "completed";
    task.stage = "done";
    task.percent = 100;
    task.completedAt = Date.now();
    task.speed = null;
  }

  private failBatch(batch: Batch, message: string): void {
    for (const task of batch.tasks) {
      if (isActiveStatus(task.status)) {
        task.status = "failed";
        task.stage = "done";
        task.message = message;
        task.completedAt = Date.now();
        task.speed = null;
      }
    }
    batch.finished = true;
    if (batch.linksFile) {
      void fs.unlink(batch.linksFile).catch(() => undefined);
    }
    if (this.activeBatch === batch) this.activeBatch = null;
    this.emit();
    const snapshot = this.getSnapshot();
    const failed = batch.tasks.filter((task) => task.status === "failed");
    void Promise.resolve(
      this.options.onComplete({
        snapshot,
        completed: [],
        failed,
        scan: null,
      }),
    );
    this.pump();
  }

  private matchDownloadsToLibrary(batch: Batch): void {
    const tracks = this.options.store.getTracks();
    const index = new Map<string, TrackRecord[]>();
    for (const track of tracks) {
      const key = titleKey(track.title);
      if (!key) continue;
      for (const artist of artistKeys(track.artist)) {
        const composite = `${artist}\u0000${key}`;
        const list = index.get(composite) ?? [];
        list.push(track);
        index.set(composite, list);
      }
    }

    for (const task of batch.tasks) {
      if (task.status !== "completed") continue;
      if (task.filePath && existsSync(task.filePath)) continue;
      const key = titleKey(task.title);
      if (!key) continue;
      for (const artist of artistKeys(task.artist)) {
        const found = index.get(`${artist}\u0000${key}`)?.[0];
        if (found) {
          task.filePath = found.path;
          break;
        }
      }
    }
  }

  private async finishBatch(
    batch: Batch,
    code: number | null,
    stderr: string,
  ): Promise<void> {
    if (batch.finished) return;
    batch.finished = true;

    if (batch.cancelled) {
      for (const task of batch.tasks) {
        if (isActiveStatus(task.status)) {
          task.status = "cancelled";
          task.stage = "done";
          task.message = "Cancelled by user";
          task.completedAt = Date.now();
          task.speed = null;
        }
      }
    } else {
      if (batch.currentTaskId) {
        const task = this.tasks.get(batch.currentTaskId);
        batch.currentTaskId = null;
        if (task && task.status === "downloading") {
          if (code === 0) {
            task.status = "completed";
            task.stage = "done";
            task.percent = 100;
            task.completedAt = Date.now();
            task.speed = null;
          } else {
            task.status = "failed";
            task.stage = "done";
            task.message =
              stderr.split(/\r?\n/).filter(Boolean).pop()?.slice(0, 220) ||
              `Downloader exited with code ${code ?? "unknown"}`;
            task.completedAt = Date.now();
            task.speed = null;
          }
        }
      }
      for (const task of batch.tasks) {
        if (task.status === "queued") {
          task.status = code === 0 ? "cancelled" : "failed";
          task.stage = "done";
          task.message =
            code === 0 ? "Not processed" : "Downloader stopped unexpectedly";
          task.completedAt = Date.now();
        }
      }
    }

    if (batch.linksFile) {
      void fs.unlink(batch.linksFile).catch(() => undefined);
    }

    const completed = batch.tasks.filter(
      (task) => task.status === "completed" || task.status === "duplicate",
    );
    let scan: ScanSummary | null = null;
    if (completed.length > 0) {
      const roots = new Set<string>();
      const settings = this.options.getSettings();
      roots.add(settings.musicDir);
      roots.add(path.join(os.homedir(), "StreamripDownloads"));
      const existingRoots = [...roots].filter((root) => existsSync(root));
      if (existingRoots.length > 0) {
        try {
          scan = await scanLibrary(
            this.options.store,
            this.options.coversDir,
            existingRoots,
            () => undefined,
          );
          this.matchDownloadsToLibrary(batch);
        } catch (error) {
          console.error("[downloader] library scan failed:", error);
        }
      }
    }

    if (this.activeBatch === batch) this.activeBatch = null;
    this.emit();

    const snapshot = this.getSnapshot();
    const failed = batch.tasks.filter((task) => task.status === "failed");
    void Promise.resolve(
      this.options.onComplete({
        snapshot,
        completed: completed.map((task) => ({ ...task })),
        failed: failed.map((task) => ({ ...task })),
        scan,
      }),
    );
    this.pump();
  }
}

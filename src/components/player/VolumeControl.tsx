import type { CSSProperties } from "react";
import { Volume1, Volume2, VolumeX } from "lucide-react";
import { usePlayerStore } from "@/store/playerStore";
import { IconButton } from "@/components/ui/IconButton";

export function VolumeControl() {
  const volume = usePlayerStore((state) => state.volume);
  const muted = usePlayerStore((state) => state.muted);
  const setVolume = usePlayerStore((state) => state.setVolume);
  const toggleMute = usePlayerStore((state) => state.toggleMute);

  const effective = muted ? 0 : volume;
  const percent = Math.round(effective * 100);
  const Icon = muted || volume === 0 ? VolumeX : volume < 0.45 ? Volume1 : Volume2;

  return (
    <div className="group/volume flex items-center gap-0.5">
      <IconButton
        label={muted ? "Unmute" : "Mute"}
        size="sm"
        onClick={toggleMute}
      >
        <Icon className="h-4 w-4" />
      </IconButton>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={effective}
        onChange={(event) => setVolume(Number(event.target.value))}
        aria-label="Volume"
        title={`Volume ${percent}%`}
        className="range-input w-[74px] transition-[width] duration-300 group-hover/volume:w-[92px] focus-visible:w-[92px]"
        style={{ "--range-progress": `${percent}%` } as CSSProperties}
      />
    </div>
  );
}

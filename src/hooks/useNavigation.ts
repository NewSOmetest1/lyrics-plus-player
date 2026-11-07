import { usePlayerStore } from "@/store/playerStore";

/**
 * App-wide screen history. Back/forward move through the recorded entries
 * without touching playback state.
 */
export function useNavigation() {
  const currentIndex = usePlayerStore((state) => state.currentIndex);
  const historyLength = usePlayerStore((state) => state.history.length);
  const navigate = usePlayerStore((state) => state.navigate);
  const goBack = usePlayerStore((state) => state.goBack);
  const goForward = usePlayerStore((state) => state.goForward);

  return {
    currentIndex,
    historyLength,
    canGoBack: currentIndex > 0,
    canGoForward: currentIndex < historyLength - 1,
    navigate,
    goBack,
    goForward,
  };
}

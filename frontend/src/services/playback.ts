import { PlaybackState, RecordingFrame } from '../types';

export const PLAYBACK_TICK_INTERVAL_MS = 100;
export const PLAYBACK_TICK_STEP_SECONDS = 0.1;

export const EMPTY_PLAYBACK_STATE: PlaybackState = {
  isPlaying: false,
  currentTime: 0,
  currentFrame: null,
};

export const clampPlaybackTime = (time: number, duration: number): number =>
  Math.max(0, Math.min(time, duration));

/**
 * The single frame-location rule shared by entering playback, seeking,
 * clicking the progress bar and the playback clock: the last frame whose
 * relativeTime is at or before the requested time; for times before the
 * first frame the first frame is used (frames are captured in time order).
 */
export const findFrameAtTime = (
  frames: RecordingFrame[],
  time: number,
): RecordingFrame | null => {
  if (frames.length === 0) return null;
  let frameIndex = 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].relativeTime <= time) {
      frameIndex = i;
    } else {
      break;
    }
  }
  return frames[frameIndex];
};

/** One clock step: pins to the end (caller pauses) or advances one tick. */
export const nextPlaybackTime = (
  currentTime: number,
  duration: number,
): { time: number; reachedEnd: boolean } => {
  const newTime = currentTime + PLAYBACK_TICK_STEP_SECONDS;
  if (newTime >= duration) {
    return { time: duration, reachedEnd: true };
  }
  return { time: newTime, reachedEnd: false };
};

import { PlaybackState, Recording, RecordingFrame } from '../types';

/**
 * 回放帧定位的唯一实现，进入回放、拖动进度条、播放时钟推进共用此结果。
 *
 * 规则与历史行为保持一致：
 * - relativeTime <= time 的最后一帧（线性向后查找）；
 * - time 早于第一帧时返回第一帧；
 * - 时间先被夹在 [0, duration]，保证进度条/连续切换录制时不会越界。
 */
export const findFrameAtTime = (recording: Recording, time: number): RecordingFrame | null => {
  const frames = recording.frames;
  if (frames.length === 0) return null;
  const clamped = Math.max(0, Math.min(recording.duration, time));
  let frameIndex = 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].relativeTime <= clamped) {
      frameIndex = i;
    } else {
      break;
    }
  }
  return frames[frameIndex];
};

export const clampPlaybackTime = (recording: Recording, time: number): number =>
  Math.max(0, Math.min(recording.duration, time));

export const initialPlaybackState: PlaybackState = {
  isPlaying: false,
  currentTime: 0,
  currentFrame: null,
};

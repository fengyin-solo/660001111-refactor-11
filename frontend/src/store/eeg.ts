import { create } from 'zustand';
import { EEGData, BandPower, BrainState, CorrelationData, Recording, RecordingFrame, PlaybackState } from '../types';
import { loadRecordings, saveRecordings } from './recordingsStorage';
import { initialPlaybackState, findFrameAtTime, clampPlaybackTime } from './playback';

interface EEGState {
  eegData: EEGData | null;
  selectedChannel: string;
  bandPower: BandPower | null;
  isStreaming: boolean;
  brainState: BrainState | null;
  correlationData: CorrelationData | null;
  isRecording: boolean;
  recordingStartTime: number;
  currentRecordingFrames: RecordingFrame[];
  recordings: Recording[];
  playbackMode: boolean;
  activeRecording: Recording | null;
  playbackState: PlaybackState;
  setEEGData: (d: EEGData | null) => void;
  setChannel: (c: string) => void;
  setBandPower: (b: BandPower | null) => void;
  setStreaming: (v: boolean) => void;
  setBrainState: (s: BrainState | null) => void;
  setCorrelationData: (c: CorrelationData | null) => void;
  startRecording: () => void;
  stopRecording: (name: string) => void;
  discardRecording: () => void;
  addRecordingFrame: (eeg: EEGData, bands: BandPower, brainState: BrainState, correlation: CorrelationData) => void;
  deleteRecording: (id: string) => void;
  enterPlaybackMode: (recording: Recording) => void;
  exitPlaybackMode: () => void;
  setPlaybackTime: (time: number) => void;
  tickPlayback: (stepSeconds?: number) => void;
  togglePlayback: () => void;
  setPlaybackPlaying: (playing: boolean) => void;
}

const idleRecordingState = {
  isRecording: false,
  recordingStartTime: 0,
  currentRecordingFrames: [] as RecordingFrame[],
};

const idlePlaybackState = {
  playbackMode: false,
  activeRecording: null as Recording | null,
  playbackState: initialPlaybackState,
};

/**
 * 定位到某一帧后，回放面板与各图表（波形/频段/脑状态/相关性）共用的数据更新。
 * 所有需要切换帧的路径（进入回放、seek、播放推进）都经过这里，保证各处看到同一份结果。
 */
const applyPlaybackFrame = (
  recording: Recording,
  time: number,
  patch: Partial<PlaybackState>,
) => {
  const clampedTime = clampPlaybackTime(recording, time);
  const frame = findFrameAtTime(recording, clampedTime);
  return {
    playbackState: {
      isPlaying: false,
      currentTime: clampedTime,
      currentFrame: frame,
      ...patch,
    } as PlaybackState,
    eegData: frame?.eeg ?? null,
    bandPower: frame?.bands ?? null,
    brainState: frame?.brainState ?? null,
    correlationData: frame?.correlation ?? null,
  };
};

export const useEEGStore = create<EEGState>((set, get) => ({
  eegData: null,
  selectedChannel: 'Fp1',
  bandPower: null,
  isStreaming: false,
  brainState: null,
  correlationData: null,
  isRecording: false,
  recordingStartTime: 0,
  currentRecordingFrames: [],
  recordings: loadRecordings(),
  playbackMode: false,
  activeRecording: null,
  playbackState: initialPlaybackState,
  setEEGData: (d) => set({ eegData: d }),
  setChannel: (c) => set({ selectedChannel: c }),
  setBandPower: (b) => set({ bandPower: b }),
  setStreaming: (v) => set({ isStreaming: v }),
  setBrainState: (s) => set({ brainState: s }),
  setCorrelationData: (c) => set({ correlationData: c }),
  startRecording: () => {
    set({
      isRecording: true,
      recordingStartTime: Date.now(),
      currentRecordingFrames: [],
      ...idlePlaybackState,
    });
  },
  stopRecording: (name: string) => {
    const { currentRecordingFrames, recordingStartTime, selectedChannel } = get();
    // 空录制不落盘、不进入历史，与原有行为一致
    if (currentRecordingFrames.length === 0) {
      set({ ...idleRecordingState });
      return;
    }
    const endTime = Date.now();
    const duration = (endTime - recordingStartTime) / 1000;
    const newRecording: Recording = {
      id: `rec_${endTime}`,
      name: name || `录制 ${new Date(recordingStartTime).toLocaleString()}`,
      channel: selectedChannel,
      startTime: recordingStartTime,
      endTime,
      duration,
      frames: currentRecordingFrames,
    };
    const recordings = [...get().recordings, newRecording];
    // 存储失败时仍保留内存中的录制（本次会话可回放），与原有容错行为一致
    saveRecordings(recordings);
    set({ ...idleRecordingState, recordings });
  },
  /** 放弃本次录制（命名对话框点击“取消”），与 stopRecording 共用同一套收尾规则。 */
  discardRecording: () => {
    set({ ...idleRecordingState });
  },
  addRecordingFrame: (eeg, bands, brainState, correlation) => {
    const { isRecording, recordingStartTime, currentRecordingFrames } = get();
    if (!isRecording) return;
    const relativeTime = (Date.now() - recordingStartTime) / 1000;
    const frame: RecordingFrame = { relativeTime, eeg, bands, brainState, correlation };
    set({ currentRecordingFrames: [...currentRecordingFrames, frame] });
  },
  deleteRecording: (id) => {
    const recordings = get().recordings.filter(r => r.id !== id);
    saveRecordings(recordings);
    // 删除的是正在回放的录制时，退出回放；删除其他录制时回放不受影响
    if (get().activeRecording?.id === id) {
      set({ recordings, ...idlePlaybackState });
    } else {
      set({ recordings });
    }
  },
  enterPlaybackMode: (recording) => {
    // 空录制无法回放（按钮虽不会出现，仍兜底），状态保持不变
    if (recording.frames.length === 0) return;
    // 进入回放与 seek 共用同一份帧定位结果；连续切换录制也由此完整重置
    set({
      playbackMode: true,
      activeRecording: recording,
      ...applyPlaybackFrame(recording, 0, { isPlaying: false }),
    });
  },
  exitPlaybackMode: () => {
    set({ ...idlePlaybackState });
  },
  setPlaybackTime: (time) => {
    const { activeRecording } = get();
    if (!activeRecording || activeRecording.frames.length === 0) return;
    set(applyPlaybackFrame(activeRecording, time, { isPlaying: get().playbackState.isPlaying }));
  },
  /** 播放时钟每拍推进，结束规则收拢到此处，面板不再自行判断。 */
  tickPlayback: (stepSeconds = 0.1) => {
    const { activeRecording, playbackState } = get();
    if (!activeRecording || activeRecording.frames.length === 0 || !playbackState.isPlaying) return;
    const newTime = playbackState.currentTime + stepSeconds;
    if (newTime >= activeRecording.duration) {
      set(applyPlaybackFrame(activeRecording, activeRecording.duration, { isPlaying: false }));
    } else {
      set(applyPlaybackFrame(activeRecording, newTime, { isPlaying: true }));
    }
  },
  togglePlayback: () => {
    const { playbackState } = get();
    set({ playbackState: { ...playbackState, isPlaying: !playbackState.isPlaying } });
  },
  setPlaybackPlaying: (playing) => {
    set({
      playbackState: {
        ...get().playbackState,
        isPlaying: playing,
      },
    });
  },
}));

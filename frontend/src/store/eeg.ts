import { create } from 'zustand';
import { EEGData, BandPower, BrainState, CorrelationData, Recording, RecordingFrame, PlaybackState } from '../types';
import { loadRecordings, saveRecordings } from '../services/recordingStorage';
import {
  EMPTY_PLAYBACK_STATE,
  PLAYBACK_TICK_INTERVAL_MS,
  clampPlaybackTime,
  findFrameAtTime,
  nextPlaybackTime,
} from '../services/playback';

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
  storageError: string | null;
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
  togglePlayback: () => void;
  setPlaybackPlaying: (playing: boolean) => void;
}

export const useEEGStore = create<EEGState>((set, get) => {
  // Module-owned playback clock. It lives next to the state it drives so the
  // play/end/pause rule exists once instead of being recreated in a view.
  let playbackTimer: number | null = null;

  const stopPlaybackClock = () => {
    if (playbackTimer !== null) {
      clearInterval(playbackTimer);
      playbackTimer = null;
    }
  };

  // The single frame-seeking path: locate the frame (shared rule), pin the
  // time into [0, duration] and publish that frame's slices together so the
  // list, playback panel and waveform/dashboard views read one result.
  const seekTo = (time: number) => {
    const { activeRecording, playbackState } = get();
    if (!activeRecording) return;
    const frame = findFrameAtTime(activeRecording.frames, time);
    if (!frame) return;
    set({
      playbackState: {
        ...playbackState,
        currentTime: clampPlaybackTime(time, activeRecording.duration),
        currentFrame: frame,
      },
      eegData: frame.eeg,
      bandPower: frame.bands,
      brainState: frame.brainState,
      correlationData: frame.correlation,
    });
  };

  const tickPlayback = () => {
    const { activeRecording, playbackState } = get();
    if (!activeRecording || !playbackState.isPlaying) return;
    const { time, reachedEnd } = nextPlaybackTime(playbackState.currentTime, activeRecording.duration);
    seekTo(time);
    if (reachedEnd) {
      get().setPlaybackPlaying(false);
    }
  };

  // The single play/pause rule; both togglePlayback and setPlaybackPlaying
  // go through it, and the clock follows isPlaying exactly.
  const applyPlaying = (playing: boolean) => {
    const { playbackState } = get();
    if (playbackState.isPlaying === playing) return;
    set({ playbackState: { ...playbackState, isPlaying: playing } });
    if (playing) {
      stopPlaybackClock();
      playbackTimer = window.setInterval(tickPlayback, PLAYBACK_TICK_INTERVAL_MS);
    } else {
      stopPlaybackClock();
    }
  };

  // The single exit rule: leaving playback (button, delete, starting a new
  // recording) always tears down the clock and resets playback state fully.
  const resetPlayback = () => {
    stopPlaybackClock();
    if (!get().playbackMode) return;
    set({
      playbackMode: false,
      activeRecording: null,
      playbackState: { ...EMPTY_PLAYBACK_STATE },
    });
  };

  // The single discard rule for cancelling the name dialog or stopping an
  // empty recording.
  const resetRecordingDraft = () => {
    set({
      isRecording: false,
      recordingStartTime: 0,
      currentRecordingFrames: [],
    });
  };

  // The single persistence path: memory is updated together with the disk
  // write; failure is surfaced once instead of being swallowed.
  const persistRecordings = (recordings: Recording[]) => {
    const ok = saveRecordings(recordings);
    set({ recordings, storageError: ok ? null : '本地存储写入失败，录制未能保存到浏览器' });
  };

  return {
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
    playbackState: { ...EMPTY_PLAYBACK_STATE },
    storageError: null,
    setEEGData: (d) => set({ eegData: d }),
    setChannel: (c) => set({ selectedChannel: c }),
    setBandPower: (b) => set({ bandPower: b }),
    setStreaming: (v) => set({ isStreaming: v }),
    setBrainState: (s) => set({ brainState: s }),
    setCorrelationData: (c) => set({ correlationData: c }),
    startRecording: () => {
      const { selectedChannel } = get();
      resetPlayback();
      set({
        isRecording: true,
        recordingStartTime: Date.now(),
        currentRecordingFrames: [],
        playbackMode: false,
        activeRecording: null,
      });
    },
    stopRecording: (name: string) => {
      const { currentRecordingFrames, recordingStartTime, selectedChannel } = get();
      if (currentRecordingFrames.length === 0) {
        resetRecordingDraft();
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
      persistRecordings([...get().recordings, newRecording]);
      set({
        isRecording: false,
        recordingStartTime: 0,
        currentRecordingFrames: [],
      });
    },
    discardRecording: () => {
      resetRecordingDraft();
    },
    addRecordingFrame: (eeg, bands, brainState, correlation) => {
      const { isRecording, recordingStartTime, currentRecordingFrames } = get();
      if (!isRecording) return;
      const relativeTime = (Date.now() - recordingStartTime) / 1000;
      const frame: RecordingFrame = { relativeTime, eeg, bands, brainState, correlation };
      set({ currentRecordingFrames: [...currentRecordingFrames, frame] });
    },
    deleteRecording: (id) => {
      persistRecordings(get().recordings.filter(r => r.id !== id));
      if (get().activeRecording?.id === id) {
        resetPlayback();
      }
    },
    enterPlaybackMode: (recording) => {
      const firstFrame = findFrameAtTime(recording.frames, 0);
      if (!firstFrame) return;
      stopPlaybackClock();
      set({
        playbackMode: true,
        activeRecording: recording,
        playbackState: {
          ...EMPTY_PLAYBACK_STATE,
          currentTime: 0,
          currentFrame: firstFrame,
        },
        eegData: firstFrame.eeg,
        bandPower: firstFrame.bands,
        brainState: firstFrame.brainState,
        correlationData: firstFrame.correlation,
      });
    },
    exitPlaybackMode: () => {
      resetPlayback();
    },
    setPlaybackTime: (time) => {
      seekTo(time);
    },
    togglePlayback: () => {
      applyPlaying(!get().playbackState.isPlaying);
    },
    setPlaybackPlaying: (playing) => {
      applyPlaying(playing);
    },
  };
});

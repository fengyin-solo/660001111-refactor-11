declare const require: any;
declare const globalThis: any;

// 在 require store 之前安装内存 localStorage（store 初始化即读取）
let storeData: Record<string, string> = {};
let mode: 'ok' | 'fail' = 'ok';

const memoryStorage = {
  getItem: (key: string) => (key in storeData ? storeData[key] : null),
  setItem: (key: string, value: string) => {
    if (mode === 'fail') throw new Error('quota exceeded');
    storeData[key] = value;
  },
  removeItem: (key: string) => {
    delete storeData[key];
  },
};
(globalThis as any).localStorage = memoryStorage;
(globalThis as any).window = { ...memoryStorage };

const { test } = require('node:test') as { test: (name: string, fn: (done?: any) => void) => void };
const assert: any = require('node:assert/strict');

const { useEEGStore } = require('../src/store/eeg') as typeof import('../src/store/eeg');
const { loadRecordings } = require('../src/store/recordingsStorage') as typeof import('../src/store/recordingsStorage');
const { findFrameAtTime } = require('../src/store/playback') as typeof import('../src/store/playback');

import { BrainState, Recording, RecordingFrame } from '../src/types';

const payloadAt = (t: number) => ({
  eeg: { channels: ['Fp1'], sample_rate: 256, data: { Fp1: [t] }, time: [0], duration: 3 },
  bands: { delta: t, theta: 0, alpha: 0, beta: 0, gamma: 0 },
  brainState: { focus: t, relaxation: 0, fatigue: 0, status: 'neutral' as const, statusLabel: '平稳', statusColor: '#000', timestamp: t } as BrainState,
  correlation: { targetChannel: 'Fp1', correlations: [] },
});

const makeRecording = (id: string, times: number[], duration?: number): Recording => {
  const frames: RecordingFrame[] = times.map((relativeTime) => ({ relativeTime, ...payloadAt(relativeTime) }));
  return {
    id, name: id, channel: 'Fp1', startTime: 1000, endTime: 2000,
    duration: duration ?? Math.max(...times, 0), frames,
  };
};

const resetState = () => {
  mode = 'ok';
  storeData = {};
  useEEGStore.setState({
    eegData: null, bandPower: null, brainState: null, correlationData: null,
    isRecording: false, recordingStartTime: 0, currentRecordingFrames: [],
    recordings: [], playbackMode: false, activeRecording: null,
    playbackState: { isPlaying: false, currentTime: 0, currentFrame: null },
  });
};

test('空录制：停止时不落盘、不进入历史列表', () => {
  resetState();
  const s = useEEGStore.getState();
  s.startRecording();
  s.stopRecording('');
  const after = useEEGStore.getState();
  assert.equal(after.isRecording, false);
  assert.equal(after.recordingStartTime, 0);
  assert.deepEqual(after.currentRecordingFrames, []);
  assert.deepEqual(after.recordings, []);
  assert.equal(storeData['eeg_recordings'], undefined);
});

test('正常录制：持久化格式与时间标注保持兼容', async () => {
  resetState();
  const s = useEEGStore.getState();
  s.startRecording();
  const start = useEEGStore.getState().recordingStartTime;
  await new Promise((resolve) => setTimeout(resolve, 20));
  const p = payloadAt(0);
  s.addRecordingFrame(p.eeg, p.bands, p.brainState, p.correlation);
  const frame = useEEGStore.getState().currentRecordingFrames[0];
  assert.ok(frame.relativeTime >= 0 && frame.relativeTime < 1);
  s.stopRecording(''); // 空名称走默认命名
  const after = useEEGStore.getState();
  assert.equal(after.recordings.length, 1);
  const rec = after.recordings[0];
  assert.equal(rec.startTime, start);
  assert.ok(rec.duration >= 0);
  assert.match(rec.name, /^录制 /);
  assert.equal(rec.frames[0].relativeTime, frame.relativeTime);
  // localStorage 中仍是旧格式：Recording[] 的 JSON
  const raw = JSON.parse(storeData['eeg_recordings']);
  assert.ok(Array.isArray(raw));
  assert.deepEqual(
    Object.keys(raw[0]).sort(),
    ['channel', 'duration', 'endTime', 'frames', 'id', 'name', 'startTime'].sort(),
  );
});

test('本地存储写入失败：录制/删除不崩溃，内存中仍可见', () => {
  resetState();
  mode = 'fail';
  const s = useEEGStore.getState();
  s.startRecording();
  const p = payloadAt(0);
  s.addRecordingFrame(p.eeg, p.bands, p.brainState, p.correlation);
  assert.doesNotThrow(() => s.stopRecording('x'));
  assert.equal(useEEGStore.getState().recordings.length, 1);
  assert.doesNotThrow(() => useEEGStore.getState().deleteRecording(useEEGStore.getState().recordings[0].id));
  assert.equal(useEEGStore.getState().recordings.length, 0);
});

test('本地存储脏数据：损坏 JSON / 非数组均按空列表处理', () => {
  resetState();
  storeData['eeg_recordings'] = '{not json';
  assert.deepEqual(loadRecordings(), []);
  storeData['eeg_recordings'] = JSON.stringify({ foo: 1 });
  assert.deepEqual(loadRecordings(), []);
  storeData['eeg_recordings'] = JSON.stringify([makeRecording('r1', [0, 3])]);
  assert.equal(loadRecordings().length, 1);
  delete storeData['eeg_recordings'];
  assert.deepEqual(loadRecordings(), []);
});

test('进入回放：定位首帧，列表/面板/波形共用同一份帧数据', () => {
  resetState();
  const rec = makeRecording('r1', [0, 3, 6], 9);
  useEEGStore.getState().enterPlaybackMode(rec);
  const s = useEEGStore.getState();
  assert.equal(s.playbackMode, true);
  assert.equal(s.activeRecording, rec);
  assert.equal(s.playbackState.currentTime, 0);
  assert.equal(s.playbackState.isPlaying, false);
  assert.equal(s.playbackState.currentFrame, rec.frames[0]);
  assert.equal(s.eegData, rec.frames[0].eeg);
  assert.equal(s.bandPower, rec.frames[0].bands);
  assert.equal(s.brainState, rec.frames[0].brainState);
  assert.equal(s.correlationData, rec.frames[0].correlation);
});

test('空录制进入回放为 no-op', () => {
  resetState();
  useEEGStore.getState().enterPlaybackMode(makeRecording('empty', []));
  assert.equal(useEEGStore.getState().playbackMode, false);
});

test('帧定位与旧的线性扫描规则一致，并对越界时间夹取', () => {
  resetState();
  const rec = makeRecording('r1', [0, 3, 6], 9);
  assert.equal(findFrameAtTime(rec, -5), rec.frames[0]);
  assert.equal(findFrameAtTime(rec, 0), rec.frames[0]);
  assert.equal(findFrameAtTime(rec, 2.9), rec.frames[0]);
  assert.equal(findFrameAtTime(rec, 3), rec.frames[1]);
  assert.equal(findFrameAtTime(rec, 5.9), rec.frames[1]);
  assert.equal(findFrameAtTime(rec, 9), rec.frames[2]);
  assert.equal(findFrameAtTime(rec, 999), rec.frames[2]);
});

test('seek：图表数据同步到对应帧且保持播放状态', () => {
  resetState();
  const rec = makeRecording('r1', [0, 3, 6], 9);
  useEEGStore.getState().enterPlaybackMode(rec);
  useEEGStore.getState().setPlaybackPlaying(true);
  useEEGStore.getState().setPlaybackTime(3);
  const s = useEEGStore.getState();
  assert.equal(s.playbackState.currentTime, 3);
  assert.equal(s.playbackState.currentFrame, rec.frames[1]);
  assert.equal(s.eegData, rec.frames[1].eeg);
  assert.equal(s.playbackState.isPlaying, true);
});

test('播放推进：tick 到结尾自动暂停并定格末帧', () => {
  resetState();
  const rec = makeRecording('r1', [0, 3, 6], 9);
  useEEGStore.getState().enterPlaybackMode(rec);
  useEEGStore.getState().setPlaybackTime(8.95);
  useEEGStore.getState().setPlaybackPlaying(true);
  useEEGStore.getState().tickPlayback(0.1);
  const s = useEEGStore.getState();
  assert.equal(s.playbackState.isPlaying, false);
  assert.equal(s.playbackState.currentTime, 9);
  assert.equal(s.playbackState.currentFrame, rec.frames[2]);
  assert.equal(s.eegData, rec.frames[2].eeg);
  // 已暂停后 tick 不再推进
  useEEGStore.getState().tickPlayback(0.1);
  assert.equal(useEEGStore.getState().playbackState.currentTime, 9);
});

test('连续切换录制：后进入的录制完整重置播放状态', () => {
  resetState();
  const a = makeRecording('a', [0, 3], 6);
  const b = makeRecording('b', [0, 2, 4], 6);
  useEEGStore.getState().enterPlaybackMode(a);
  useEEGStore.getState().setPlaybackPlaying(true);
  useEEGStore.getState().tickPlayback(3); // 播到结尾
  assert.equal(useEEGStore.getState().playbackState.currentFrame, a.frames[1]);
  useEEGStore.getState().enterPlaybackMode(b);
  const s = useEEGStore.getState();
  assert.equal(s.activeRecording, b);
  assert.equal(s.playbackState.currentTime, 0);
  assert.equal(s.playbackState.isPlaying, false);
  assert.equal(s.playbackState.currentFrame, b.frames[0]);
  assert.equal(s.eegData, b.frames[0].eeg);
});

test('删除正在回放的录制会退出回放；删除其他录制不影响回放', () => {
  resetState();
  const a = makeRecording('a', [0, 3], 6);
  const b = makeRecording('b', [0, 2], 4);
  useEEGStore.setState({ recordings: [a, b] });
  useEEGStore.getState().enterPlaybackMode(a);
  useEEGStore.getState().deleteRecording(b.id);
  let s = useEEGStore.getState();
  assert.equal(s.playbackMode, true);
  assert.equal(s.activeRecording, a);
  assert.deepEqual(s.recordings.map((r) => r.id), ['a']);
  useEEGStore.getState().deleteRecording(a.id);
  s = useEEGStore.getState();
  assert.equal(s.playbackMode, false);
  assert.equal(s.activeRecording, null);
  assert.equal(s.playbackState.currentFrame, null);
  assert.equal(s.playbackState.currentTime, 0);
  assert.deepEqual(s.recordings, []);
});

test('退出回放走统一重置路径', () => {
  resetState();
  const rec = makeRecording('r1', [0, 3], 6);
  useEEGStore.getState().enterPlaybackMode(rec);
  useEEGStore.getState().setPlaybackPlaying(true);
  useEEGStore.getState().exitPlaybackMode();
  const s = useEEGStore.getState();
  assert.equal(s.playbackMode, false);
  assert.equal(s.activeRecording, null);
  assert.equal(s.playbackState.isPlaying, false);
  assert.equal(s.playbackState.currentTime, 0);
  assert.equal(s.playbackState.currentFrame, null);
});

test('取消保存（discardRecording）与空录制停止使用同一套收尾规则', () => {
  resetState();
  const s0 = useEEGStore.getState();
  s0.startRecording();
  const p = payloadAt(0);
  s0.addRecordingFrame(p.eeg, p.bands, p.brainState, p.correlation);
  useEEGStore.getState().discardRecording();
  const s = useEEGStore.getState();
  assert.equal(s.isRecording, false);
  assert.equal(s.recordingStartTime, 0);
  assert.deepEqual(s.currentRecordingFrames, []);
  assert.deepEqual(s.recordings, []);
  assert.equal(storeData['eeg_recordings'], undefined);
});

test('开始录制会收拢任何遗留的回放状态', () => {
  resetState();
  const rec = makeRecording('r1', [0, 3], 6);
  useEEGStore.getState().enterPlaybackMode(rec);
  useEEGStore.getState().startRecording();
  const s = useEEGStore.getState();
  assert.equal(s.playbackMode, false);
  assert.equal(s.activeRecording, null);
  assert.equal(s.playbackState.currentFrame, null);
  assert.equal(s.isRecording, true);
});

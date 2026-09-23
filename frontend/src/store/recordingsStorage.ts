import { Recording } from '../types';

const STORAGE_KEY = 'eeg_recordings';

/**
 * 录制持久化的唯一入口。
 * 历史数据格式保持不变：localStorage 中直接存放 Recording[] 的 JSON。
 */

const isRecordings = (value: unknown): value is Recording[] =>
  Array.isArray(value) && value.every((item) => item && typeof item === 'object' && Array.isArray((item as Recording).frames));

export const loadRecordings = (): Recording[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    // 兼容旧数据：仅接受数组形式的录制列表，损坏/被其他逻辑占用时按空列表处理
    return isRecordings(parsed) ? parsed : [];
  } catch {
    // JSON 解析失败（含历史脏数据）不影响应用启动
    return [];
  }
};

/**
 * 写入录制列表。本地存储失败（隐私模式、配额超限等）时静默降级为仅内存生效，
 * 不阻断录制/删除流程；返回是否持久化成功，便于上层保持一致的状态更新。
 */
export const saveRecordings = (recordings: Recording[]): boolean => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recordings));
    return true;
  } catch {
    return false;
  }
};

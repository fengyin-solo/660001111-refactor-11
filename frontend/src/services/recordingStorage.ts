import { Recording } from '../types';

export const STORAGE_KEY = 'eeg_recordings';

/**
 * Historical data was written as a bare JSON array under STORAGE_KEY and that
 * shape is preserved. A single malformed entry must not discard the rest of
 * the history, so each record is validated independently; only entries that
 * would crash frame location (missing/non-array frames) are dropped.
 */
const isValidStoredRecording = (value: unknown): value is Recording =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as Recording).id === 'string' &&
  Array.isArray((value as Recording).frames);

export const loadRecordings = (): Recording[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidStoredRecording);
  } catch {
    return [];
  }
};

/**
 * The single persistence path. Returns false when the write fails
 * (quota exceeded / serialization error / unavailable storage in private
 * mode) so callers can keep the in-memory list usable and surface the error
 * instead of silently diverging from what is on disk.
 */
export const saveRecordings = (recordings: Recording[]): boolean => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recordings));
    return true;
  } catch {
    return false;
  }
};

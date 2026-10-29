import { create } from 'zustand';
import { safeStorage } from '@/shared/lib/safeStorage';
import { DEFAULT_STUDIES, STUDY_IDS, isStudyId, type StudyId } from './studies';

export const STUDIES_STORAGE_KEY = 'nth.chart.studies';

/** The studies stored on this device, or the defaults when nothing (or nothing valid) is stored. */
export function readStudies(): StudyId[] {
  const raw = safeStorage.get(STUDIES_STORAGE_KEY);
  if (raw === null) return [...DEFAULT_STUDIES];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? STUDY_IDS.filter((id) => parsed.includes(id)) : [];
  } catch {
    return [...DEFAULT_STUDIES];
  }
}

export type ChartStudiesState = {
  studies: StudyId[];
  toggleStudy: (study: StudyId) => void;
};

/**
 * Which studies every chart shows (NSTOCK-0460). One choice for all charts, so the dashboard,
 * instrument and index pages agree, remembered on this device.
 */
export const useChartStudies = create<ChartStudiesState>()((set, get) => ({
  studies: readStudies(),
  toggleStudy: (study) => {
    if (!isStudyId(study)) return;
    const current = get().studies;
    const next = STUDY_IDS.filter((id) =>
      id === study ? !current.includes(id) : current.includes(id),
    );
    safeStorage.set(STUDIES_STORAGE_KEY, JSON.stringify(next));
    set({ studies: next });
  },
}));

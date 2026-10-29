import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_STUDIES } from './studies';
import { STUDIES_STORAGE_KEY, readStudies, useChartStudies } from './studiesStore';

afterEach(() => {
  window.localStorage.clear();
  useChartStudies.setState({ studies: readStudies() });
});

describe('chart studies store (NSTOCK-0460)', () => {
  it('starts on the defaults when nothing is stored', () => {
    expect(readStudies()).toEqual([...DEFAULT_STUDIES]);
  });

  it('restores the stored studies in menu order and drops unknown ids', () => {
    window.localStorage.setItem(
      STUDIES_STORAGE_KEY,
      JSON.stringify(['vwap', 'nonsense', 'sma20', 'volume']),
    );
    expect(readStudies()).toEqual(['volume', 'sma20', 'vwap']);
  });

  it('keeps an empty stored choice: the user turned everything off', () => {
    window.localStorage.setItem(STUDIES_STORAGE_KEY, '[]');
    expect(readStudies()).toEqual([]);
  });

  it('falls back to the defaults for corrupt JSON or a non-array', () => {
    window.localStorage.setItem(STUDIES_STORAGE_KEY, '{not json');
    expect(readStudies()).toEqual([...DEFAULT_STUDIES]);
    window.localStorage.setItem(STUDIES_STORAGE_KEY, '{"a":1}');
    expect(readStudies()).toEqual([...DEFAULT_STUDIES]);
  });

  it('toggling adds or removes a study and remembers the choice', () => {
    useChartStudies.setState({ studies: ['volume'] });
    useChartStudies.getState().toggleStudy('sma20');
    expect(useChartStudies.getState().studies).toEqual(['volume', 'sma20']);
    expect(window.localStorage.getItem(STUDIES_STORAGE_KEY)).toBe('["volume","sma20"]');
    useChartStudies.getState().toggleStudy('volume');
    expect(useChartStudies.getState().studies).toEqual(['sma20']);
    expect(readStudies()).toEqual(['sma20']);
  });

  it('ignores an id that is not a study', () => {
    useChartStudies.setState({ studies: ['volume'] });
    useChartStudies.getState().toggleStudy('bogus' as never);
    expect(useChartStudies.getState().studies).toEqual(['volume']);
  });
});

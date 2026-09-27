import { describe, expect, it } from 'vitest';
import { createMapInstrumentSource, type InstrumentInfo } from './instruments.js';

const INFY: InstrumentInfo = {
  token: 1594,
  symbol: 'INFY',
  exchange: 'NSE',
  lowerCircuit: 1_200_00,
  upperCircuit: 1_800_00,
};

describe('createMapInstrumentSource', () => {
  it('looks instruments up by token and keeps its own copy', () => {
    const info = { ...INFY };
    const source = createMapInstrumentSource([info]);
    info.upperCircuit = 1;
    expect(source.getInstrument(1594)).toEqual(INFY);
    expect(source.getInstrument(1)).toBeNull();
    source.set({ ...INFY, upperCircuit: 1_900_00 });
    expect(source.getInstrument(1594)?.upperCircuit).toBe(1_900_00);
  });

  it('refuses a circuit band that is not positive paise or is upside down', () => {
    const source = createMapInstrumentSource();
    expect(() => source.set({ ...INFY, lowerCircuit: 0 })).toThrow(/positive/);
    expect(() => source.set({ ...INFY, upperCircuit: 1.5 })).toThrow(/integer/);
    expect(() => source.set({ ...INFY, lowerCircuit: 1_900_00 })).toThrow(/upside down/);
  });
});

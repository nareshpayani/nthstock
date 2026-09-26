import { describe, expect, it } from 'vitest';
import { highlightName, highlightSymbol, queryWords } from './highlight';

describe('queryWords', () => {
  it('splits like the search index and upper-cases', () => {
    expect(queryWords(' tata  con-s ')).toEqual(['TATA', 'CON', 'S']);
    expect(queryWords('m&m')).toEqual(['M&M']);
    expect(queryWords('  ')).toEqual([]);
  });
});

describe('highlightSymbol', () => {
  it('marks the prefix the query types, ignoring case', () => {
    expect(highlightSymbol('INFY', 'inf')).toEqual([
      { text: 'INF', match: true },
      { text: 'Y', match: false },
    ]);
    expect(highlightSymbol('INFY', 'infy')).toEqual([{ text: 'INFY', match: true }]);
  });

  it('marks nothing when the symbol does not start with the query', () => {
    expect(highlightSymbol('TCS', 'tata')).toEqual([{ text: 'TCS', match: false }]);
    expect(highlightSymbol('TCS', '')).toEqual([{ text: 'TCS', match: false }]);
  });
});

describe('highlightName', () => {
  it('marks the start of every word a query word begins', () => {
    expect(highlightName('Tata Consultancy Services Ltd', 'tata con')).toEqual([
      { text: 'Tata', match: true },
      { text: ' ', match: false },
      { text: 'Con', match: true },
      { text: 'sultancy Services Ltd', match: false },
    ]);
  });

  it('prefers the longest query word and keeps punctuation', () => {
    expect(highlightName('Mahindra & Mahindra Ltd', 'ma mahi')).toEqual([
      { text: 'Mahi', match: true },
      { text: 'ndra & ', match: false },
      { text: 'Mahi', match: true },
      { text: 'ndra Ltd', match: false },
    ]);
  });

  it('marks nothing for no match or an empty query', () => {
    expect(highlightName('Infosys Ltd', 'tcs')).toEqual([{ text: 'Infosys Ltd', match: false }]);
    expect(highlightName('Infosys Ltd', '')).toEqual([{ text: 'Infosys Ltd', match: false }]);
  });
});

import type { Exchange, IndexRef, MarketCapCategory } from '@nthstock/contracts';
import type { Sector } from './sectors.js';

/** One plain sentence about what companies in each sector do. Generic, never company-specific. */
export const SECTOR_ABOUT: Readonly<Record<Sector, string>> = {
  'Financial Services':
    'Companies in this sector lend, take deposits, insure, and manage or move money for households and businesses.',
  'Information Technology':
    'Companies in this sector build software, run IT services and manage technology for clients in India and abroad.',
  'Oil & Gas':
    'Companies in this sector explore for, refine and distribute crude oil, natural gas and fuels.',
  FMCG: 'Companies in this sector make and sell everyday consumer goods such as food, drinks and personal care products.',
  Automobile:
    'Companies in this sector make cars, two-wheelers, commercial vehicles and the parts that go into them.',
  Healthcare:
    'Companies in this sector make medicines and medical products or run hospitals and diagnostic labs.',
  'Metals & Mining':
    'Companies in this sector mine minerals and produce steel, aluminium, copper and other metals.',
  Power:
    'Companies in this sector generate, transmit and distribute electricity from thermal and renewable sources.',
  Telecom:
    'Companies in this sector run mobile, broadband and network services and the towers behind them.',
  Construction:
    'Companies in this sector build roads, bridges, buildings and other infrastructure projects.',
  'Consumer Durables':
    'Companies in this sector make long-lasting household goods such as appliances, electricals and electronics.',
  Chemicals:
    'Companies in this sector make industrial, agricultural and specialty chemicals used by other industries.',
  'Capital Goods':
    'Companies in this sector make machinery, electrical equipment and engineering products for industry.',
  Realty: 'Companies in this sector develop and sell homes, offices and commercial property.',
  Cement:
    'Companies in this sector make cement and building materials for housing and infrastructure.',
  'Consumer Services':
    'Companies in this sector run retail stores, hotels, travel and other services for consumers.',
  Textiles: 'Companies in this sector spin yarn and make fabrics, garments and home textiles.',
  Media:
    'Companies in this sector run television, film, music, print and digital media businesses.',
};

const CAP_WORDS: Readonly<Record<MarketCapCategory, string>> = {
  LARGE: 'a large-cap',
  MID: 'a mid-cap',
  SMALL: 'a small-cap',
};

const EXCHANGE_NAMES: Readonly<Record<Exchange, string>> = {
  NSE: 'the National Stock Exchange (NSE)',
  BSE: 'BSE',
};

/** "A", "A and B", "A, B and C". */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

export type ProfileAboutInput = {
  name: string;
  sector: Sector;
  capCategory: MarketCapCategory;
  exchange: Exchange;
  indices: readonly IndexRef[];
};

/**
 * The overview's about text for the mock market: built only from facts the symbol master holds
 * (sector, size, listing, index membership) plus a sector description, and it says so. It never
 * invents company history or figures, because many mock names are real companies.
 */
export function profileAbout({
  name,
  sector,
  capCategory,
  exchange,
  indices,
}: ProfileAboutInput): string {
  const membership =
    indices.length === 0
      ? 'It is not a constituent of any of the headline indices shown on nthstock.'
      : `It is a constituent of the ${listOf(indices.map((ix) => ix.name))} ${
          indices.length === 1 ? 'index' : 'indices'
        }.`;
  return [
    `${name} is ${CAP_WORDS[capCategory]} company in the ${sector} sector, listed on ${EXCHANGE_NAMES[exchange]}.`,
    SECTOR_ABOUT[sector],
    membership,
    'Its share price moves with company results, sector trends and the wider market, so investors often compare it with peers in the same sector before buying or selling.',
    'This overview is sample text generated for nthstock paper trading, not an official company description.',
  ].join(' ');
}

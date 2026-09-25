/** Sectors used by the mock symbol master, with GBM parameters per sector. */
export const SECTORS = [
  'Financial Services',
  'Information Technology',
  'Oil & Gas',
  'FMCG',
  'Automobile',
  'Healthcare',
  'Metals & Mining',
  'Power',
  'Telecom',
  'Construction',
  'Consumer Durables',
  'Chemicals',
  'Capital Goods',
  'Realty',
  'Cement',
  'Consumer Services',
  'Textiles',
  'Media',
] as const;

export type Sector = (typeof SECTORS)[number];

/** Annualised drift (μ) and volatility (σ) for geometric Brownian motion. */
export type GbmParams = { drift: number; volatility: number };

export const SECTOR_GBM: Readonly<Record<Sector, GbmParams>> = {
  'Financial Services': { drift: 0.12, volatility: 0.28 },
  'Information Technology': { drift: 0.1, volatility: 0.25 },
  'Oil & Gas': { drift: 0.08, volatility: 0.27 },
  FMCG: { drift: 0.09, volatility: 0.18 },
  Automobile: { drift: 0.12, volatility: 0.3 },
  Healthcare: { drift: 0.11, volatility: 0.24 },
  'Metals & Mining': { drift: 0.08, volatility: 0.38 },
  Power: { drift: 0.1, volatility: 0.32 },
  Telecom: { drift: 0.1, volatility: 0.26 },
  Construction: { drift: 0.12, volatility: 0.3 },
  'Consumer Durables': { drift: 0.12, volatility: 0.28 },
  Chemicals: { drift: 0.1, volatility: 0.32 },
  'Capital Goods': { drift: 0.13, volatility: 0.33 },
  Realty: { drift: 0.1, volatility: 0.4 },
  Cement: { drift: 0.09, volatility: 0.26 },
  'Consumer Services': { drift: 0.12, volatility: 0.34 },
  Textiles: { drift: 0.06, volatility: 0.35 },
  Media: { drift: 0.05, volatility: 0.4 },
};

/** Words that make a generated company name read like its sector, and the symbol suffix. */
export const SECTOR_NAMING: Readonly<Record<Sector, { words: readonly string[]; code: string }>> = {
  'Financial Services': { words: ['Finance', 'Capital', 'Finserv', 'Credit'], code: 'FIN' },
  'Information Technology': { words: ['Infotech', 'Software', 'Systems', 'Digital'], code: 'TECH' },
  'Oil & Gas': { words: ['Petro', 'Energy', 'Gas', 'Oil'], code: 'PET' },
  FMCG: { words: ['Foods', 'Consumer', 'Agro', 'Beverages'], code: 'FOOD' },
  Automobile: { words: ['Motors', 'Auto', 'Autocomp', 'Tyres'], code: 'AUTO' },
  Healthcare: { words: ['Pharma', 'Lifesciences', 'Healthcare', 'Labs'], code: 'PHAR' },
  'Metals & Mining': { words: ['Steel', 'Metals', 'Alloys', 'Minerals'], code: 'MET' },
  Power: { words: ['Power', 'Renewables', 'Energy', 'Solar'], code: 'POW' },
  Telecom: { words: ['Telecom', 'Networks', 'Communications'], code: 'TEL' },
  Construction: { words: ['Infra', 'Constructions', 'Projects', 'Buildcon'], code: 'INFRA' },
  'Consumer Durables': { words: ['Appliances', 'Electricals', 'Home'], code: 'CD' },
  Chemicals: { words: ['Chemicals', 'Polymers', 'Specialty', 'Organics'], code: 'CHEM' },
  'Capital Goods': { words: ['Engineering', 'Industries', 'Machines', 'Electric'], code: 'ENG' },
  Realty: { words: ['Realty', 'Estates', 'Developers', 'Housing'], code: 'RLTY' },
  Cement: { words: ['Cements', 'Cement'], code: 'CEM' },
  'Consumer Services': { words: ['Retail', 'Hotels', 'Travels', 'Services'], code: 'SERV' },
  Textiles: { words: ['Textiles', 'Fabrics', 'Spinning', 'Mills'], code: 'TEX' },
  Media: { words: ['Media', 'Entertainment', 'Broadcast'], code: 'MEDIA' },
};

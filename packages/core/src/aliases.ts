/**
 * Alias map for entity normalization
 * Maps common variations to canonical forms
 */

export const ENTITY_ALIASES: Record<string, string> = {
  // Cryptocurrencies
  'btc': 'BITCOIN',
  'bitcoin': 'BITCOIN',
  'eth': 'ETHEREUM',
  'ethereum': 'ETHEREUM',
  'sol': 'SOLANA',
  'solana': 'SOLANA',
  'xrp': 'XRP',
  'ripple': 'XRP',
  'doge': 'DOGECOIN',
  'dogecoin': 'DOGECOIN',
  'ada': 'CARDANO',
  'cardano': 'CARDANO',
  'bnb': 'BNB',
  'binance': 'BNB',
  'avax': 'AVALANCHE',
  'avalanche': 'AVALANCHE',
  'matic': 'POLYGON',
  'polygon': 'POLYGON',
  'dot': 'POLKADOT',
  'polkadot': 'POLKADOT',
  'link': 'CHAINLINK',
  'chainlink': 'CHAINLINK',
  'ltc': 'LITECOIN',
  'litecoin': 'LITECOIN',

  // Politicians - US
  'trump': 'DONALD_TRUMP',
  'donald trump': 'DONALD_TRUMP',
  'donald j trump': 'DONALD_TRUMP',
  'biden': 'JOE_BIDEN',
  'joe biden': 'JOE_BIDEN',
  'joseph biden': 'JOE_BIDEN',
  'harris': 'KAMALA_HARRIS',
  'kamala harris': 'KAMALA_HARRIS',
  'kamala': 'KAMALA_HARRIS',
  'desantis': 'RON_DESANTIS',
  'ron desantis': 'RON_DESANTIS',
  'newsom': 'GAVIN_NEWSOM',
  'gavin newsom': 'GAVIN_NEWSOM',
  'haley': 'NIKKI_HALEY',
  'nikki haley': 'NIKKI_HALEY',
  'ramaswamy': 'VIVEK_RAMASWAMY',
  'vivek ramaswamy': 'VIVEK_RAMASWAMY',
  'vivek': 'VIVEK_RAMASWAMY',
  'pence': 'MIKE_PENCE',
  'mike pence': 'MIKE_PENCE',
  'rfk': 'RFK_JR',
  'rfk jr': 'RFK_JR',
  'robert kennedy': 'RFK_JR',
  'kennedy': 'RFK_JR',
  'obama': 'BARACK_OBAMA',
  'barack obama': 'BARACK_OBAMA',

  // Politicians - International
  'putin': 'VLADIMIR_PUTIN',
  'vladimir putin': 'VLADIMIR_PUTIN',
  'zelensky': 'VOLODYMYR_ZELENSKY',
  'zelenskyy': 'VOLODYMYR_ZELENSKY',
  'xi': 'XI_JINPING',
  'xi jinping': 'XI_JINPING',
  'netanyahu': 'BENJAMIN_NETANYAHU',
  'bibi': 'BENJAMIN_NETANYAHU',
  'macron': 'EMMANUEL_MACRON',
  'starmer': 'KEIR_STARMER',
  'sunak': 'RISHI_SUNAK',
  'trudeau': 'JUSTIN_TRUDEAU',
  'modi': 'NARENDRA_MODI',
  'erdogan': 'RECEP_ERDOGAN',
  'bolsonaro': 'JAIR_BOLSONARO',
  'lula': 'LULA_DA_SILVA',
  'milei': 'JAVIER_MILEI',

  // Economic indicators
  'gdp': 'GDP',
  'cpi': 'CPI',
  'ppi': 'PPI',
  'pce': 'PCE',
  'nfp': 'NFP',
  'non-farm payrolls': 'NFP',
  'nonfarm payrolls': 'NFP',
  'unemployment': 'UNEMPLOYMENT',
  'unemployment rate': 'UNEMPLOYMENT',
  'inflation': 'INFLATION',
  'interest rate': 'INTEREST_RATE',
  'fed rate': 'FED_RATE',
  'fed funds': 'FED_RATE',
  'federal funds': 'FED_RATE',
  'fomc': 'FOMC',

  // Sports teams - NFL
  'chiefs': 'KC_CHIEFS',
  'kansas city chiefs': 'KC_CHIEFS',
  '49ers': 'SF_49ERS',
  'san francisco 49ers': 'SF_49ERS',
  'eagles': 'PHI_EAGLES',
  'philadelphia eagles': 'PHI_EAGLES',
  'cowboys': 'DAL_COWBOYS',
  'dallas cowboys': 'DAL_COWBOYS',
  'bills': 'BUF_BILLS',
  'buffalo bills': 'BUF_BILLS',
  'ravens': 'BAL_RAVENS',
  'baltimore ravens': 'BAL_RAVENS',
  'lions': 'DET_LIONS',
  'detroit lions': 'DET_LIONS',
  'packers': 'GB_PACKERS',
  'green bay packers': 'GB_PACKERS',

  // Sports teams - NBA
  'lakers': 'LA_LAKERS',
  'los angeles lakers': 'LA_LAKERS',
  'celtics': 'BOS_CELTICS',
  'boston celtics': 'BOS_CELTICS',
  'warriors': 'GS_WARRIORS',
  'golden state warriors': 'GS_WARRIORS',
  'nuggets': 'DEN_NUGGETS',
  'denver nuggets': 'DEN_NUGGETS',
  'heat': 'MIA_HEAT',
  'miami heat': 'MIA_HEAT',
  'bucks': 'MIL_BUCKS',
  'milwaukee bucks': 'MIL_BUCKS',

  // Events
  'super bowl': 'SUPER_BOWL',
  'superbowl': 'SUPER_BOWL',
  'world cup': 'WORLD_CUP',
  'world series': 'WORLD_SERIES',
  'nba finals': 'NBA_FINALS',
  'stanley cup': 'STANLEY_CUP',
  'olympics': 'OLYMPICS',
  'election': 'ELECTION',
  'presidential election': 'US_PRESIDENTIAL_ELECTION',
  'us election': 'US_PRESIDENTIAL_ELECTION',
  'midterms': 'US_MIDTERMS',
  'midterm': 'US_MIDTERMS',

  // Companies/Stocks
  'apple': 'AAPL',
  'aapl': 'AAPL',
  'google': 'GOOGL',
  'googl': 'GOOGL',
  'alphabet': 'GOOGL',
  'amazon': 'AMZN',
  'amzn': 'AMZN',
  'microsoft': 'MSFT',
  'msft': 'MSFT',
  'tesla': 'TSLA',
  'tsla': 'TSLA',
  'nvidia': 'NVDA',
  'nvda': 'NVDA',
  'meta': 'META',
  'facebook': 'META',
  'netflix': 'NFLX',
  'nflx': 'NFLX',
  'sp500': 'SP500',
  's&p 500': 'SP500',
  's&p500': 'SP500',
  'spy': 'SP500',
  'nasdaq': 'NASDAQ',
  'qqq': 'NASDAQ',
  'dow': 'DOW_JONES',
  'dow jones': 'DOW_JONES',
  'djia': 'DOW_JONES',

  // Weather/Natural
  'hurricane': 'HURRICANE',
  'earthquake': 'EARTHQUAKE',
  'tornado': 'TORNADO',
  'wildfire': 'WILDFIRE',

  // Misc
  'oscar': 'OSCARS',
  'oscars': 'OSCARS',
  'academy award': 'OSCARS',
  'grammy': 'GRAMMYS',
  'grammys': 'GRAMMYS',
  'emmy': 'EMMYS',
  'emmys': 'EMMYS',
  'ufc': 'UFC',
  'wwe': 'WWE',
  'f1': 'F1',
  'formula 1': 'F1',
  'formula one': 'F1',
};

/**
 * Regex patterns for extracting ticker-like entities
 */
export const TICKER_PATTERNS: RegExp[] = [
  // Crypto tickers: $BTC, BTC, etc.
  /\$?(?:BTC|ETH|SOL|XRP|DOGE|ADA|BNB|AVAX|MATIC|DOT|LINK|LTC|USDT|USDC)\b/gi,
  // Stock tickers: $AAPL, AAPL, etc.
  /\$(?:AAPL|GOOGL|GOOG|AMZN|MSFT|TSLA|NVDA|META|NFLX|SPY|QQQ)\b/gi,
];

/**
 * Normalize a token using the alias map
 */
export function normalizeEntity(token: string): string {
  const lower = token.toLowerCase().trim();
  return ENTITY_ALIASES[lower] || token.toUpperCase();
}

/**
 * Check if a token is a known entity
 */
export function isKnownEntity(token: string): boolean {
  const lower = token.toLowerCase().trim();
  return lower in ENTITY_ALIASES;
}

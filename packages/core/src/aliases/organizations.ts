/**
 * Organizations Aliases (v3.0.16)
 *
 * Central banks, leagues, companies, and other organizations.
 * Format: CANONICAL_NAME -> [aliases...]
 */

// ============================================================================
// CENTRAL BANKS
// ============================================================================

export const CENTRAL_BANKS: Record<string, string[]> = {
  'FED': ['fed', 'federal reserve', 'fomc', 'the fed', 'us fed', 'federal reserve board'],
  'ECB': ['ecb', 'european central bank', 'ecb frankfurt'],
  'BOE': ['boe', 'bank of england', 'boe london'],
  'BOJ': ['boj', 'bank of japan'],
  'PBOC': ['pboc', "people's bank of china", 'peoples bank of china'],
  'RBA': ['rba', 'reserve bank of australia'],
  'BOC': ['boc', 'bank of canada'],
  'SNB': ['snb', 'swiss national bank'],
  'RBNZ': ['rbnz', 'reserve bank of new zealand'],
  'RIKSBANK': ['riksbank', 'swedish central bank'],
  'NORGES_BANK': ['norges bank', 'norwegian central bank'],
};

// ============================================================================
// SPORTS LEAGUES
// ============================================================================

export const SPORTS_LEAGUES: Record<string, string[]> = {
  // US Major Leagues
  'NBA': ['nba', 'national basketball association', 'basketball'],
  'NFL': ['nfl', 'national football league', 'football', 'american football'],
  'MLB': ['mlb', 'major league baseball', 'baseball'],
  'NHL': ['nhl', 'national hockey league', 'hockey'],
  'MLS': ['mls', 'major league soccer'],
  'NCAA': ['ncaa', 'college', 'college sports'],
  'NCAA_BASKETBALL': ['ncaa basketball', 'march madness', 'college basketball', 'ncaab'],
  'NCAA_FOOTBALL': ['ncaa football', 'college football', 'cfb', 'cfp'],

  // European Soccer
  'EPL': ['epl', 'premier league', 'english premier league', 'prem'],
  'LA_LIGA': ['la liga', 'laliga', 'spanish league', 'liga'],
  'BUNDESLIGA': ['bundesliga', 'german league'],
  'SERIE_A': ['serie a', 'italian league', 'calcio'],
  'LIGUE_1': ['ligue 1', 'ligue1', 'french league'],
  'EREDIVISIE': ['eredivisie', 'dutch league'],
  'PRIMEIRA_LIGA': ['primeira liga', 'portuguese league', 'liga portugal'],
  'SCOTTISH_PREM': ['scottish premiership', 'spfl', 'scottish prem'],
  'CHAMPIONSHIP': ['championship', 'efl championship', 'english championship'],
  'SUPER_LIG': ['super lig', 'turkish league', 'turkish super lig'],

  // European Competitions
  'UCL': ['ucl', 'champions league', 'uefa champions league', 'cl'],
  'UEL': ['uel', 'europa league', 'uefa europa league', 'el'],
  'CONFERENCE_LEAGUE': ['conference league', 'uecl'],
  'EURO': ['euro', 'euros', 'european championship', 'uefa euro'],

  // International
  'WORLD_CUP': ['world cup', 'fifa world cup', 'wc'],
  'COPA_AMERICA': ['copa america', 'copa'],
  'AFCON': ['afcon', 'africa cup of nations', 'african cup'],
  'ASIAN_CUP': ['asian cup', 'afc asian cup'],

  // Combat Sports
  'UFC': ['ufc', 'ultimate fighting championship', 'mma', 'mixed martial arts'],
  'BELLATOR': ['bellator', 'bellator mma'],
  'ONE_FC': ['one fc', 'one championship'],
  'PFL': ['pfl', 'professional fighters league'],
  'BOXING': ['boxing', 'wba', 'wbc', 'wbo', 'ibf'],

  // Motorsports
  'F1': ['f1', 'formula 1', 'formula one', 'formula1'],
  'NASCAR': ['nascar'],
  'INDYCAR': ['indycar', 'indy'],
  'MOTOGP': ['motogp', 'moto gp'],

  // Tennis
  'ATP': ['atp', 'atp tour'],
  'WTA': ['wta', 'wta tour'],
  'GRAND_SLAM': ['grand slam'],
  'WIMBLEDON': ['wimbledon'],
  'US_OPEN_TENNIS': ['us open tennis', 'us open'],
  'AUSTRALIAN_OPEN': ['australian open', 'aus open'],
  'FRENCH_OPEN': ['french open', 'roland garros'],

  // Golf
  'PGA': ['pga', 'pga tour'],
  'LIV': ['liv', 'liv golf'],
  'LPGA': ['lpga', 'lpga tour'],
  'MASTERS': ['the masters', 'masters tournament', 'masters'],
  'RYDER_CUP': ['ryder cup'],

  // Esports
  'ESPORTS': ['esports', 'e-sports'],
  'LCS': ['lcs', 'league championship series'],
  'LEC': ['lec', 'league european championship'],
  'LCK': ['lck', 'league champions korea'],
  'LPL': ['lpl', 'league pro league'],
  'VCT': ['vct', 'valorant champions tour'],
  'BLAST': ['blast', 'blast premier'],
  'ESL': ['esl', 'esl pro league'],
  'IEM': ['iem', 'intel extreme masters'],
  'THE_INTERNATIONAL': ['ti', 'the international', 'dota international'],

  // Olympics
  'OLYMPICS': ['olympics', 'olympic games', 'summer olympics'],
  'WINTER_OLYMPICS': ['winter olympics', 'winter games'],
  'PARALYMPICS': ['paralympics', 'paralympic games'],
};

// ============================================================================
// TECH COMPANIES
// ============================================================================

export const TECH_COMPANIES: Record<string, string[]> = {
  'APPLE': ['apple', 'aapl', 'apple inc'],
  'GOOGLE': ['google', 'alphabet', 'googl', 'goog'],
  'MICROSOFT': ['microsoft', 'msft', 'ms'],
  'AMAZON': ['amazon', 'amzn', 'aws'],
  'META': ['meta', 'facebook', 'fb'],
  'NVIDIA': ['nvidia', 'nvda'],
  'TESLA': ['tesla', 'tsla'],
  'NETFLIX': ['netflix', 'nflx'],
  'OPENAI': ['openai', 'open ai'],
  'ANTHROPIC': ['anthropic'],
  'X': ['x', 'twitter'],
  'TIKTOK': ['tiktok', 'bytedance'],
  'COINBASE': ['coinbase', 'coin'],
  'BINANCE': ['binance', 'bnb'],
  'STRIPE': ['stripe'],
  'SPACEX': ['spacex', 'space x'],
  'PALANTIR': ['palantir', 'pltr'],
  'SALESFORCE': ['salesforce', 'crm'],
  'ORACLE': ['oracle', 'orcl'],
  'IBM': ['ibm'],
  'INTEL': ['intel', 'intc'],
  'AMD': ['amd', 'advanced micro devices'],
  'QUALCOMM': ['qualcomm', 'qcom'],
  'BROADCOM': ['broadcom', 'avgo'],
  'UBER': ['uber'],
  'LYFT': ['lyft'],
  'AIRBNB': ['airbnb', 'abnb'],
  'DOORDASH': ['doordash', 'dash'],
  'SNAP': ['snap', 'snapchat'],
  'PINTEREST': ['pinterest', 'pins'],
  'ZOOM': ['zoom', 'zm'],
  'SLACK': ['slack'],
  'SHOPIFY': ['shopify', 'shop'],
  'ROKU': ['roku'],
  'SPOTIFY': ['spotify', 'spot'],
  'DISCORD': ['discord'],
  'REDDIT': ['reddit', 'rddt'],
  'ROBLOX': ['roblox', 'rblx'],
};

// ============================================================================
// FINANCIAL INSTITUTIONS
// ============================================================================

export const FINANCIAL_INSTITUTIONS: Record<string, string[]> = {
  'JPMORGAN': ['jpmorgan', 'jp morgan', 'chase', 'jpm'],
  'BANK_OF_AMERICA': ['bank of america', 'bofa', 'boa', 'bac'],
  'WELLS_FARGO': ['wells fargo', 'wfc'],
  'CITIGROUP': ['citi', 'citigroup', 'c'],
  'GOLDMAN_SACHS': ['goldman', 'goldman sachs', 'gs'],
  'MORGAN_STANLEY': ['morgan stanley', 'ms'],
  'BLACKROCK': ['blackrock', 'blk'],
  'VANGUARD': ['vanguard'],
  'FIDELITY': ['fidelity'],
  'CHARLES_SCHWAB': ['schwab', 'charles schwab', 'schw'],
  'BERKSHIRE': ['berkshire', 'berkshire hathaway', 'brk'],
  'VISA': ['visa', 'v'],
  'MASTERCARD': ['mastercard', 'ma'],
  'AMERICAN_EXPRESS': ['amex', 'american express', 'axp'],
  'PAYPAL': ['paypal', 'pypl'],
  'ROBINHOOD': ['robinhood', 'hood'],
  'FTXL': ['ftx'],  // Historical
  'THREE_ARROWS': ['3ac', 'three arrows capital'],  // Historical
  'GRAYSCALE': ['grayscale', 'gbtc'],
  'MICROSTRATEGY': ['microstrategy', 'mstr'],
};

// ============================================================================
// GOVERNMENT AGENCIES
// ============================================================================

export const GOVERNMENT_AGENCIES: Record<string, string[]> = {
  // US
  'SEC': ['sec', 'securities and exchange commission'],
  'CFTC': ['cftc', 'commodity futures trading commission'],
  'DOJ': ['doj', 'department of justice', 'justice department'],
  'FBI': ['fbi', 'federal bureau of investigation'],
  'CIA': ['cia', 'central intelligence agency'],
  'NSA': ['nsa', 'national security agency'],
  'FDA': ['fda', 'food and drug administration'],
  'CDC': ['cdc', 'centers for disease control'],
  'EPA': ['epa', 'environmental protection agency'],
  'FTC': ['ftc', 'federal trade commission'],
  'IRS': ['irs', 'internal revenue service'],
  'TREASURY': ['treasury', 'us treasury', 'treasury department'],
  'STATE_DEPT': ['state department', 'state dept', 'foggy bottom'],
  'PENTAGON': ['pentagon', 'dod', 'department of defense'],
  'NASA': ['nasa', 'national aeronautics and space administration'],
  'CONGRESS': ['congress', 'us congress'],
  'SENATE': ['senate', 'us senate'],
  'HOUSE': ['house', 'house of representatives'],
  'SCOTUS': ['scotus', 'supreme court', 'us supreme court'],

  // International
  'UN': ['un', 'united nations'],
  'NATO': ['nato', 'north atlantic treaty organization'],
  'EU': ['eu', 'european union'],
  'IMF': ['imf', 'international monetary fund'],
  'WORLD_BANK': ['world bank'],
  'WTO': ['wto', 'world trade organization'],
  'WHO': ['who', 'world health organization'],
  'OPEC': ['opec'],
};

// ============================================================================
// CRYPTO PROJECTS / PROTOCOLS
// ============================================================================

export const CRYPTO_PROJECTS: Record<string, string[]> = {
  'BITCOIN': ['bitcoin', 'btc'],
  'ETHEREUM': ['ethereum', 'eth'],
  'SOLANA': ['solana', 'sol'],
  'XRP': ['xrp', 'ripple'],
  'CARDANO': ['cardano', 'ada'],
  'DOGECOIN': ['dogecoin', 'doge'],
  'AVALANCHE': ['avalanche', 'avax'],
  'POLKADOT': ['polkadot', 'dot'],
  'CHAINLINK': ['chainlink', 'link'],
  'POLYGON': ['polygon', 'matic'],
  'LITECOIN': ['litecoin', 'ltc'],
  'UNISWAP': ['uniswap', 'uni'],
  'AAVE': ['aave'],
  'MAKER': ['maker', 'mkr'],
  'COMPOUND': ['compound', 'comp'],
  'CURVE': ['curve', 'crv'],
  'ARBITRUM': ['arbitrum', 'arb'],
  'OPTIMISM': ['optimism', 'op'],
  'SUI': ['sui'],
  'APTOS': ['aptos', 'apt'],
  'SEI': ['sei'],
  'TONCOIN': ['toncoin', 'ton'],
  'NEAR': ['near', 'near protocol'],
  'COSMOS': ['cosmos', 'atom'],
  'FANTOM': ['fantom', 'ftm'],
  'TRON': ['tron', 'trx'],
  'SHIBA_INU': ['shiba', 'shib', 'shiba inu'],
  'PEPE': ['pepe', 'pepe coin'],
  'BONK': ['bonk'],
  'FLOKI': ['floki'],
  'KASPA': ['kaspa', 'kas'],
  'RENDER': ['render', 'rndr'],
  'INJECTIVE': ['injective', 'inj'],
  'STACKS': ['stacks', 'stx'],
  'IMMUTABLE': ['immutable', 'imx'],
  'LIDO': ['lido', 'ldo'],
  'ROCKETPOOL': ['rocket pool', 'rpl'],
};

// ============================================================================
// NEWS / MEDIA
// ============================================================================

export const MEDIA_ORGANIZATIONS: Record<string, string[]> = {
  'CNN': ['cnn'],
  'FOX_NEWS': ['fox news', 'fox', 'foxnews'],
  'MSNBC': ['msnbc'],
  'ABC': ['abc', 'abc news'],
  'CBS': ['cbs', 'cbs news'],
  'NBC': ['nbc', 'nbc news'],
  'NYT': ['nyt', 'new york times', 'ny times'],
  'WASHINGTON_POST': ['wapo', 'washington post', 'wash post'],
  'WSJ': ['wsj', 'wall street journal'],
  'REUTERS': ['reuters'],
  'AP': ['ap', 'associated press'],
  'BLOOMBERG': ['bloomberg'],
  'CNBC': ['cnbc'],
  'BBC': ['bbc'],
  'GUARDIAN': ['the guardian', 'guardian'],
  'POLITICO': ['politico'],
  'AXIOS': ['axios'],
  'THE_HILL': ['the hill'],
  'BREITBART': ['breitbart'],
  'DAILY_WIRE': ['daily wire'],
  'HUFFPOST': ['huffpost', 'huffington post'],
  'VOX': ['vox'],
  'VICE': ['vice'],
  'BUZZFEED': ['buzzfeed'],
  'ESPN': ['espn'],
  'BLEACHER_REPORT': ['bleacher report', 'br'],
  'THE_ATHLETIC': ['the athletic', 'athletic'],
};

// ============================================================================
// COMBINED EXPORT
// ============================================================================

export const ALL_ORGANIZATIONS: Record<string, string[]> = {
  ...CENTRAL_BANKS,
  ...SPORTS_LEAGUES,
  ...TECH_COMPANIES,
  ...FINANCIAL_INSTITUTIONS,
  ...GOVERNMENT_AGENCIES,
  ...CRYPTO_PROJECTS,
  ...MEDIA_ORGANIZATIONS,
};

/**
 * Build a reverse lookup map: alias -> canonical name
 */
export function buildOrgLookup(aliases: Record<string, string[]>): Map<string, string> {
  const lookup = new Map<string, string>();

  for (const [canonical, aliasList] of Object.entries(aliases)) {
    // Add canonical itself (lowercase)
    lookup.set(canonical.toLowerCase().replace(/_/g, ' '), canonical);

    // Add all aliases
    for (const alias of aliasList) {
      lookup.set(alias.toLowerCase(), canonical);
    }
  }

  return lookup;
}

// Pre-built lookup maps
export const CENTRAL_BANKS_LOOKUP = buildOrgLookup(CENTRAL_BANKS);
export const LEAGUES_LOOKUP = buildOrgLookup(SPORTS_LEAGUES);
export const TECH_COMPANIES_LOOKUP = buildOrgLookup(TECH_COMPANIES);
export const FINANCIAL_LOOKUP = buildOrgLookup(FINANCIAL_INSTITUTIONS);
export const GOVERNMENT_LOOKUP = buildOrgLookup(GOVERNMENT_AGENCIES);
export const CRYPTO_LOOKUP = buildOrgLookup(CRYPTO_PROJECTS);
export const MEDIA_LOOKUP = buildOrgLookup(MEDIA_ORGANIZATIONS);
export const ALL_ORGS_LOOKUP = buildOrgLookup(ALL_ORGANIZATIONS);

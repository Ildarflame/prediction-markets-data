/**
 * Team Normalization (v3.0.11)
 *
 * Normalizes team names for sports matching.
 * Handles abbreviations, city names, and common aliases.
 */

// ============================================================================
// LEAGUE ENUMS
// ============================================================================

export enum SportsLeague {
  NBA = 'NBA',
  NFL = 'NFL',
  MLB = 'MLB',
  NHL = 'NHL',
  MLS = 'MLS',
  EPL = 'EPL',       // English Premier League
  LA_LIGA = 'LA_LIGA',
  BUNDESLIGA = 'BUNDESLIGA',
  SERIE_A = 'SERIE_A',
  LIGUE_1 = 'LIGUE_1',
  UCL = 'UCL',       // UEFA Champions League
  UEL = 'UEL',       // UEFA Europa League
  NCAA_FB = 'NCAA_FB', // College Football
  NCAA_BB = 'NCAA_BB', // College Basketball
  UFC = 'UFC',
  TENNIS = 'TENNIS',
  GOLF = 'GOLF',
  F1 = 'F1',
  ESPORTS = 'ESPORTS',
  UNKNOWN = 'UNKNOWN',
}

// ============================================================================
// MARKET TYPE ENUMS
// ============================================================================

export enum SportsMarketType {
  MONEYLINE = 'MONEYLINE',   // Who wins
  SPREAD = 'SPREAD',         // Point spread / handicap
  TOTAL = 'TOTAL',           // Over/under total points
  PROP = 'PROP',             // Player props
  FUTURES = 'FUTURES',       // Season/tournament futures
  PARLAY = 'PARLAY',         // Multi-leg bets
  UNKNOWN = 'UNKNOWN',
}

export enum SportsPeriod {
  FULL_GAME = 'FULL_GAME',
  FIRST_HALF = '1H',
  SECOND_HALF = '2H',
  FIRST_QUARTER = 'Q1',
  SECOND_QUARTER = 'Q2',
  THIRD_QUARTER = 'Q3',
  FOURTH_QUARTER = 'Q4',
  FIRST_PERIOD = 'P1',    // Hockey
  SECOND_PERIOD = 'P2',
  THIRD_PERIOD = 'P3',
  OVERTIME = 'OT',
  UNKNOWN = 'UNKNOWN',
}

export enum SpreadSide {
  HOME = 'HOME',
  AWAY = 'AWAY',
  OVER = 'OVER',
  UNDER = 'UNDER',
  YES = 'YES',
  NO = 'NO',
  UNKNOWN = 'UNKNOWN',
}

// ============================================================================
// LEAGUE DETECTION KEYWORDS
// ============================================================================

export const LEAGUE_KEYWORDS: Record<SportsLeague, string[]> = {
  [SportsLeague.NBA]: ['nba', 'basketball', 'lakers', 'celtics', 'knicks', 'warriors', 'nets', 'bulls', 'heat', 'bucks', 'suns', 'mavs', 'mavericks', 'nuggets', 'clippers', 'grizzlies', 'cavaliers', 'cavs', 'raptors', 'sixers', '76ers', 'pacers', 'hawks', 'magic', 'wizards', 'pistons', 'hornets', 'blazers', 'trail blazers', 'jazz', 'pelicans', 'timberwolves', 'wolves', 'thunder', 'kings', 'spurs'],
  [SportsLeague.NFL]: ['nfl', 'football', 'chiefs', 'eagles', 'bills', 'cowboys', 'dolphins', 'ravens', 'bengals', 'chargers', 'lions', 'niners', '49ers', 'jaguars', 'jags', 'vikings', 'jets', 'giants', 'patriots', 'pats', 'seahawks', 'broncos', 'packers', 'raiders', 'steelers', 'browns', 'titans', 'colts', 'texans', 'cardinals', 'falcons', 'panthers', 'saints', 'buccaneers', 'bucs', 'commanders', 'bears', 'rams'],
  [SportsLeague.MLB]: ['mlb', 'baseball', 'yankees', 'dodgers', 'red sox', 'cubs', 'mets', 'braves', 'astros', 'phillies', 'padres', 'mariners', 'rays', 'guardians', 'twins', 'blue jays', 'orioles', 'tigers', 'royals', 'white sox', 'angels', 'rangers', 'athletics', 'reds', 'brewers', 'pirates', 'cardinals', 'nationals', 'marlins', 'rockies', 'diamondbacks', 'dbacks', 'giants'],
  [SportsLeague.NHL]: ['nhl', 'hockey', 'rangers', 'bruins', 'maple leafs', 'leafs', 'canadiens', 'habs', 'oilers', 'flames', 'canucks', 'kraken', 'avalanche', 'avs', 'wild', 'stars', 'predators', 'preds', 'blues', 'blackhawks', 'hawks', 'red wings', 'penguins', 'pens', 'capitals', 'caps', 'hurricanes', 'canes', 'lightning', 'bolts', 'panthers', 'islanders', 'isles', 'devils', 'flyers', 'sabres', 'senators', 'sens', 'jets', 'coyotes', 'golden knights', 'knights', 'ducks', 'sharks', 'kings'],
  [SportsLeague.MLS]: ['mls', 'atlanta united', 'lafc', 'la galaxy', 'galaxy', 'inter miami', 'sounders', 'seattle sounders', 'timbers', 'portland timbers', 'rapids', 'whitecaps', 'sporting kc', 'skc', 'fc dallas', 'houston dynamo', 'austin fc', 'real salt lake', 'rsl', 'minnesota united', 'loons', 'chicago fire', 'nashville sc', 'columbus crew', 'dc united', 'new york red bulls', 'red bulls', 'nycfc', 'new york city fc', 'philadelphia union', 'union', 'new england revolution', 'revs', 'montreal', 'cf montreal', 'toronto fc', 'tfc', 'orlando city', 'charlotte fc', 'cincinnati', 'fc cincinnati'],
  [SportsLeague.EPL]: ['premier league', 'epl', 'english premier', 'arsenal', 'gunners', 'chelsea', 'blues', 'liverpool', 'reds', 'manchester united', 'man united', 'man utd', 'manchester city', 'man city', 'tottenham', 'spurs', 'west ham', 'hammers', 'newcastle', 'magpies', 'aston villa', 'villa', 'brighton', 'seagulls', 'brentford', 'bees', 'fulham', 'cottagers', 'crystal palace', 'palace', 'nottingham forest', 'forest', 'bournemouth', 'cherries', 'wolves', 'wolverhampton', 'everton', 'toffees', 'leicester', 'foxes', 'leeds', 'southampton', 'saints', 'sheffield united', 'blades', 'burnley', 'clarets', 'luton', 'ipswich'],
  [SportsLeague.LA_LIGA]: ['la liga', 'laliga', 'spanish league', 'real madrid', 'barcelona', 'barca', 'atletico madrid', 'atletico', 'sevilla', 'real sociedad', 'villarreal', 'yellow submarine', 'real betis', 'betis', 'athletic bilbao', 'bilbao', 'valencia', 'osasuna', 'celta vigo', 'celta', 'mallorca', 'girona', 'getafe', 'rayo vallecano', 'rayo', 'alaves', 'cadiz', 'almeria', 'las palmas', 'granada'],
  [SportsLeague.BUNDESLIGA]: ['bundesliga', 'german league', 'bayern', 'bayern munich', 'borussia dortmund', 'dortmund', 'bvb', 'rb leipzig', 'leipzig', 'bayer leverkusen', 'leverkusen', 'union berlin', 'freiburg', 'eintracht frankfurt', 'frankfurt', 'wolfsburg', 'mainz', 'hoffenheim', 'werder bremen', 'bremen', 'borussia monchengladbach', 'gladbach', 'augsburg', 'koln', 'cologne', 'vfb stuttgart', 'stuttgart', 'bochum', 'heidenheim', 'darmstadt'],
  [SportsLeague.SERIE_A]: ['serie a', 'italian league', 'inter milan', 'inter', 'ac milan', 'milan', 'juventus', 'juve', 'napoli', 'roma', 'as roma', 'lazio', 'atalanta', 'fiorentina', 'viola', 'torino', 'toro', 'bologna', 'monza', 'udinese', 'sassuolo', 'empoli', 'lecce', 'verona', 'hellas verona', 'cagliari', 'genoa', 'salernitana', 'frosinone'],
  [SportsLeague.LIGUE_1]: ['ligue 1', 'ligue1', 'french league', 'psg', 'paris saint-germain', 'paris', 'marseille', 'om', 'monaco', 'lyon', 'ol', 'lille', 'losc', 'nice', 'lens', 'rennes', 'reims', 'montpellier', 'strasbourg', 'nantes', 'toulouse', 'brest', 'lorient', 'clermont', 'le havre', 'metz'],
  [SportsLeague.UCL]: ['champions league', 'ucl', 'uefa champions', 'cl final', 'cl group'],
  [SportsLeague.UEL]: ['europa league', 'uel', 'uefa europa', 'el final', 'el group'],
  [SportsLeague.NCAA_FB]: ['college football', 'ncaa football', 'cfb', 'cfp', 'college playoff', 'bowl game', 'rose bowl', 'sugar bowl', 'orange bowl', 'cotton bowl', 'fiesta bowl', 'peach bowl', 'sec championship', 'big ten championship', 'acc championship', 'big 12 championship', 'pac-12'],
  [SportsLeague.NCAA_BB]: ['college basketball', 'ncaa basketball', 'ncaab', 'march madness', 'final four', 'sweet sixteen', 'elite eight'],
  [SportsLeague.UFC]: ['ufc', 'mma', 'mixed martial arts', 'fight night', 'ppv'],
  [SportsLeague.TENNIS]: ['tennis', 'atp', 'wta', 'grand slam', 'wimbledon', 'us open tennis', 'australian open tennis', 'french open', 'roland garros'],
  [SportsLeague.GOLF]: ['golf', 'pga', 'lpga', 'masters', 'us open golf', 'british open', 'the open', 'pga championship', 'ryder cup'],
  [SportsLeague.F1]: ['formula 1', 'f1', 'grand prix', 'gp'],
  [SportsLeague.ESPORTS]: ['esports', 'e-sports', 'league of legends', 'lol', 'dota', 'cs:go', 'csgo', 'valorant', 'overwatch', 'call of duty', 'cod'],
  [SportsLeague.UNKNOWN]: [],
};

// ============================================================================
// TEAM ALIASES (normalized -> aliases)
// ============================================================================

export const TEAM_ALIASES: Record<string, string[]> = {
  // NBA
  'los angeles lakers': ['la lakers', 'lakers', 'lake show'],
  'los angeles clippers': ['la clippers', 'clippers', 'clips'],
  'golden state warriors': ['warriors', 'gsw', 'dubs'],
  'boston celtics': ['celtics', 'boston'],
  'new york knicks': ['knicks', 'ny knicks', 'nyc knicks'],
  'brooklyn nets': ['nets', 'bkn'],
  'chicago bulls': ['bulls', 'chicago'],
  'miami heat': ['heat', 'miami'],
  'milwaukee bucks': ['bucks', 'milwaukee'],
  'phoenix suns': ['suns', 'phoenix'],
  'dallas mavericks': ['mavs', 'mavericks', 'dallas'],
  'denver nuggets': ['nuggets', 'denver'],
  'philadelphia 76ers': ['sixers', '76ers', 'philly'],
  'memphis grizzlies': ['grizzlies', 'grizz', 'memphis'],
  'cleveland cavaliers': ['cavs', 'cavaliers', 'cleveland'],
  'toronto raptors': ['raptors', 'toronto'],
  'indiana pacers': ['pacers', 'indiana'],
  'atlanta hawks': ['hawks', 'atlanta'],
  'orlando magic': ['magic', 'orlando'],
  'washington wizards': ['wizards', 'washington', 'wiz'],
  'detroit pistons': ['pistons', 'detroit'],
  'charlotte hornets': ['hornets', 'charlotte'],
  'portland trail blazers': ['blazers', 'trail blazers', 'portland'],
  'utah jazz': ['jazz', 'utah'],
  'new orleans pelicans': ['pelicans', 'new orleans', 'nola', 'pels'],
  'minnesota timberwolves': ['timberwolves', 'wolves', 'minnesota', 'twolves'],
  'oklahoma city thunder': ['thunder', 'okc', 'oklahoma city'],
  'sacramento kings': ['kings', 'sacramento'],
  'san antonio spurs': ['spurs', 'san antonio'],
  'houston rockets': ['rockets', 'houston'],

  // NFL
  'kansas city chiefs': ['chiefs', 'kansas city', 'kc'],
  'philadelphia eagles': ['eagles', 'philly'],
  'buffalo bills': ['bills', 'buffalo'],
  'dallas cowboys': ['cowboys', 'dallas', 'americas team'],
  'miami dolphins': ['dolphins', 'miami'],
  'baltimore ravens': ['ravens', 'baltimore'],
  'cincinnati bengals': ['bengals', 'cincinnati', 'cincy'],
  'los angeles chargers': ['chargers', 'la chargers', 'bolts'],
  'detroit lions': ['lions', 'detroit'],
  'san francisco 49ers': ['49ers', 'niners', 'san francisco', 'sf'],
  'jacksonville jaguars': ['jaguars', 'jags', 'jacksonville'],
  'minnesota vikings': ['vikings', 'minnesota'],
  'new york jets': ['jets', 'ny jets'],
  'new york giants': ['giants', 'ny giants', 'big blue'],
  'new england patriots': ['patriots', 'pats', 'new england'],
  'seattle seahawks': ['seahawks', 'seattle'],
  'denver broncos': ['broncos', 'denver'],
  'green bay packers': ['packers', 'green bay', 'gb'],
  'las vegas raiders': ['raiders', 'las vegas', 'lv raiders', 'oakland raiders'],
  'pittsburgh steelers': ['steelers', 'pittsburgh'],
  'cleveland browns': ['browns', 'cleveland'],
  'tennessee titans': ['titans', 'tennessee'],
  'indianapolis colts': ['colts', 'indianapolis', 'indy'],
  'houston texans': ['texans', 'houston'],
  'arizona cardinals': ['cardinals', 'arizona', 'az cardinals'],
  'atlanta falcons': ['falcons', 'atlanta'],
  'carolina panthers': ['panthers', 'carolina'],
  'new orleans saints': ['saints', 'new orleans', 'nola'],
  'tampa bay buccaneers': ['buccaneers', 'bucs', 'tampa bay', 'tb'],
  'washington commanders': ['commanders', 'washington', 'dc'],
  'chicago bears': ['bears', 'chicago'],
  'los angeles rams': ['rams', 'la rams'],

  // EPL
  'manchester united': ['man united', 'man utd', 'mufc', 'red devils', 'united'],
  'manchester city': ['man city', 'mcfc', 'city', 'citizens'],
  'liverpool': ['liverpool fc', 'lfc', 'reds'],
  'chelsea': ['chelsea fc', 'cfc', 'blues'],
  'arsenal': ['arsenal fc', 'afc', 'gunners'],
  'tottenham hotspur': ['tottenham', 'spurs', 'thfc'],
  'west ham united': ['west ham', 'hammers', 'whu'],
  'newcastle united': ['newcastle', 'magpies', 'nufc'],
  'aston villa': ['villa', 'avfc'],
  'brighton': ['brighton & hove albion', 'seagulls', 'bhafc'],
  'wolverhampton wanderers': ['wolves', 'wolverhampton'],
  'crystal palace': ['palace', 'cpfc'],
  'nottingham forest': ['forest', 'nffc'],
  'everton': ['everton fc', 'efc', 'toffees'],
  'leicester city': ['leicester', 'foxes', 'lcfc'],

  // La Liga
  'real madrid': ['madrid', 'rmcf', 'los blancos'],
  'barcelona': ['barca', 'fcb', 'blaugrana'],
  'atletico madrid': ['atletico', 'atleti'],

  // Bundesliga
  'bayern munich': ['bayern', 'fcb', 'bavarians'],
  'borussia dortmund': ['dortmund', 'bvb'],
  'rb leipzig': ['leipzig', 'rbl'],
  'bayer leverkusen': ['leverkusen'],

  // Serie A
  'inter milan': ['inter', 'internazionale'],
  'ac milan': ['milan', 'rossoneri'],
  'juventus': ['juve'],

  // MLB
  'new york yankees': ['yankees', 'ny yankees', 'bronx bombers'],
  'los angeles dodgers': ['dodgers', 'la dodgers'],
  'boston red sox': ['red sox', 'boston', 'sox'],
  'chicago cubs': ['cubs', 'chicago cubs'],
  'new york mets': ['mets', 'ny mets'],
  'atlanta braves': ['braves', 'atlanta'],
  'houston astros': ['astros', 'houston', 'stros'],
  'philadelphia phillies': ['phillies', 'philly'],
  'san diego padres': ['padres', 'san diego'],
  'seattle mariners': ['mariners', 'seattle', 'ms'],
  'tampa bay rays': ['rays', 'tampa bay'],
  'cleveland guardians': ['guardians', 'cleveland', 'tribe'],
  'minnesota twins': ['twins', 'minnesota'],
  'toronto blue jays': ['blue jays', 'jays', 'toronto'],
  'baltimore orioles': ['orioles', 'baltimore', 'os'],
  'detroit tigers': ['tigers', 'detroit'],
  'kansas city royals': ['royals', 'kansas city', 'kc'],
  'chicago white sox': ['white sox', 'chi sox', 'south siders'],
  'los angeles angels': ['angels', 'la angels', 'anaheim angels'],
  'texas rangers': ['rangers', 'texas'],
  'oakland athletics': ['athletics', 'as', 'oakland'],
  'cincinnati reds': ['reds', 'cincinnati'],
  'milwaukee brewers': ['brewers', 'milwaukee', 'brew crew'],
  'pittsburgh pirates': ['pirates', 'pittsburgh', 'bucs'],
  'st louis cardinals': ['cardinals', 'st louis', 'cards'],
  'washington nationals': ['nationals', 'washington', 'nats'],
  'miami marlins': ['marlins', 'miami'],
  'colorado rockies': ['rockies', 'colorado'],
  'arizona diamondbacks': ['diamondbacks', 'dbacks', 'arizona'],
  'san francisco giants': ['giants', 'san francisco', 'sf giants'],

  // NHL
  'new york rangers': ['rangers', 'ny rangers', 'nyr', 'blueshirts'],
  'boston bruins': ['bruins', 'boston', 'bs'],
  'toronto maple leafs': ['maple leafs', 'leafs', 'toronto'],
  'montreal canadiens': ['canadiens', 'habs', 'montreal'],
  'edmonton oilers': ['oilers', 'edmonton'],
  'calgary flames': ['flames', 'calgary'],
  'vancouver canucks': ['canucks', 'vancouver'],
  'colorado avalanche': ['avalanche', 'avs', 'colorado'],
  'minnesota wild': ['wild', 'minnesota'],
  'dallas stars': ['stars', 'dallas'],
  'nashville predators': ['predators', 'preds', 'nashville'],
  'st louis blues': ['blues', 'st louis', 'stl'],
  'chicago blackhawks': ['blackhawks', 'hawks', 'chicago'],
  'detroit red wings': ['red wings', 'wings', 'detroit'],
  'pittsburgh penguins': ['penguins', 'pens', 'pittsburgh'],
  'washington capitals': ['capitals', 'caps', 'washington'],
  'carolina hurricanes': ['hurricanes', 'canes', 'carolina'],
  'tampa bay lightning': ['lightning', 'bolts', 'tampa bay'],
  'florida panthers': ['panthers', 'florida', 'cats'],
  'new york islanders': ['islanders', 'isles', 'ny islanders'],
  'new jersey devils': ['devils', 'new jersey', 'nj'],
  'philadelphia flyers': ['flyers', 'philadelphia', 'philly'],
  'buffalo sabres': ['sabres', 'buffalo'],
  'ottawa senators': ['senators', 'sens', 'ottawa'],
  'winnipeg jets': ['jets', 'winnipeg'],
  'seattle kraken': ['kraken', 'seattle'],
  'vegas golden knights': ['golden knights', 'knights', 'vegas', 'vgk'],
  'anaheim ducks': ['ducks', 'anaheim'],
  'san jose sharks': ['sharks', 'san jose', 'sj'],
  'los angeles kings': ['kings', 'la kings'],
};

// ============================================================================
// NORMALIZATION FUNCTIONS
// ============================================================================

/**
 * Normalize a team name to canonical form
 */
export function normalizeTeamName(name: string): string {
  if (!name) return '';

  // Basic normalization
  let normalized = name
    .toLowerCase()
    .trim()
    .replace(/['']/g, "'")           // Normalize apostrophes
    .replace(/[^\w\s'-]/g, ' ')      // Remove special chars except hyphens/apostrophes
    .replace(/\s+/g, ' ')            // Normalize spaces
    .trim();

  // Check aliases (reverse lookup)
  for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
    if (aliases.includes(normalized) || canonical === normalized) {
      return canonical;
    }
  }

  // Handle city + team pattern
  // e.g., "LA Lakers" -> "los angeles lakers"
  const cityAbbrevs: Record<string, string> = {
    'la': 'los angeles',
    'ny': 'new york',
    'sf': 'san francisco',
    'kc': 'kansas city',
    'dc': 'washington',
    'nola': 'new orleans',
    'okc': 'oklahoma city',
    'philly': 'philadelphia',
    'chi': 'chicago',
    'det': 'detroit',
    'bos': 'boston',
    'mia': 'miami',
    'atl': 'atlanta',
    'hou': 'houston',
    'dal': 'dallas',
    'min': 'minnesota',
    'den': 'denver',
    'phx': 'phoenix',
    'sea': 'seattle',
    'por': 'portland',
    'sac': 'sacramento',
    'tb': 'tampa bay',
    'lv': 'las vegas',
    'gb': 'green bay',
    'ind': 'indianapolis',
    'cle': 'cleveland',
    'cin': 'cincinnati',
    'pit': 'pittsburgh',
    'bal': 'baltimore',
    'buf': 'buffalo',
    'jax': 'jacksonville',
    'ten': 'tennessee',
    'car': 'carolina',
    'az': 'arizona',
    'no': 'new orleans',
  };

  for (const [abbrev, full] of Object.entries(cityAbbrevs)) {
    const pattern = new RegExp(`^${abbrev}\\s+`, 'i');
    if (pattern.test(normalized)) {
      normalized = normalized.replace(pattern, `${full} `);
      break;
    }
  }

  // Try alias lookup again after city expansion
  for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
    if (aliases.includes(normalized) || canonical === normalized) {
      return canonical;
    }
  }

  return normalized;
}

/**
 * Detect league from text
 */
export function detectLeague(text: string): SportsLeague {
  const textLower = text.toLowerCase();

  // Check explicit league mentions first (most reliable)
  const explicitPatterns: [RegExp, SportsLeague][] = [
    [/\bnba\b/i, SportsLeague.NBA],
    [/\bnfl\b/i, SportsLeague.NFL],
    [/\bmlb\b/i, SportsLeague.MLB],
    [/\bnhl\b/i, SportsLeague.NHL],
    [/\bmls\b/i, SportsLeague.MLS],
    [/\bepl\b|\bpremier\s+league\b/i, SportsLeague.EPL],
    [/\bla\s?liga\b|\blasliga\b/i, SportsLeague.LA_LIGA],
    [/\bbundesliga\b/i, SportsLeague.BUNDESLIGA],
    [/\bserie\s+a\b/i, SportsLeague.SERIE_A],
    [/\bligue\s*1\b/i, SportsLeague.LIGUE_1],
    [/\bchampions\s+league\b|\bucl\b/i, SportsLeague.UCL],
    [/\beuropa\s+league\b|\buel\b/i, SportsLeague.UEL],
    [/\bufc\b|\bmma\b/i, SportsLeague.UFC],
    [/\batp\b|\bwta\b|\btennis\b/i, SportsLeague.TENNIS],
    [/\bpga\b|\bgolf\b/i, SportsLeague.GOLF],
    [/\bf1\b|\bformula\s*1\b|\bgrand\s+prix\b/i, SportsLeague.F1],
    [/\besports?\b|\bvalorant\b|\bdota\b|\bleague\s+of\s+legends\b/i, SportsLeague.ESPORTS],
    [/\bncaa\s+football\b|\bcollege\s+football\b|\bcfb\b/i, SportsLeague.NCAA_FB],
    [/\bncaa\s+basketball\b|\bcollege\s+basketball\b|\bmarch\s+madness\b/i, SportsLeague.NCAA_BB],
  ];

  for (const [pattern, league] of explicitPatterns) {
    if (pattern.test(text)) {
      return league;
    }
  }

  // Check team/keyword based detection (less reliable, use scoring)
  const leaguePriority: SportsLeague[] = [
    SportsLeague.NBA,
    SportsLeague.NFL,
    SportsLeague.MLB,
    SportsLeague.NHL,
    SportsLeague.EPL,
    SportsLeague.LA_LIGA,
    SportsLeague.BUNDESLIGA,
    SportsLeague.SERIE_A,
    SportsLeague.MLS,
  ];

  for (const league of leaguePriority) {
    const keywords = LEAGUE_KEYWORDS[league];
    for (const keyword of keywords) {
      const pattern = new RegExp(`\\b${keyword}\\b`, 'i');
      if (pattern.test(textLower)) {
        return league;
      }
    }
  }

  return SportsLeague.UNKNOWN;
}

/**
 * Extract teams from title (X vs Y, X @ Y patterns)
 */
export function extractTeams(title: string): { teamA: string | null; teamB: string | null } {
  // Common separators for matchups
  const vsPatterns = [
    /^(.+?)\s+(?:vs\.?|v\.?|versus)\s+(.+?)(?:\s*[-–—]\s*|\s*$)/i,
    /^(.+?)\s+@\s+(.+?)(?:\s*[-–—]\s*|\s*$)/i,
    /^(.+?)\s+at\s+(.+?)(?:\s*[-–—]\s*|\s*$)/i,
  ];

  for (const pattern of vsPatterns) {
    const match = title.match(pattern);
    if (match) {
      const teamA = normalizeTeamName(match[1].trim());
      const teamB = normalizeTeamName(match[2].trim());
      if (teamA && teamB && teamA !== teamB) {
        return { teamA, teamB };
      }
    }
  }

  return { teamA: null, teamB: null };
}

/**
 * Detect market type from title
 */
export function detectMarketType(title: string): SportsMarketType {
  const titleLower = title.toLowerCase();

  // Detect parlays first (exclude them)
  if (/parlay|multi|combo|accumulator|acca/.test(titleLower)) {
    return SportsMarketType.PARLAY;
  }

  // Detect player props (exclude them)
  if (/\bpoints\b.*\b\d+\+|\bpassing\s+yards|\brushing\s+yards|\breceiving\s+yards|\btouchdown|first\s+scorer|\blast\s+scorer|\bgoals?\b.*\b\d+|\bassist|\brebound|\bstrikeout|\bhome\s+run|\bhr\b|\brbi\b/.test(titleLower)) {
    return SportsMarketType.PROP;
  }

  // Detect futures (exclude them)
  if (/champion|winner\s+of\s+the\s+(season|tournament|league|cup)|mvp|rookie|draft|award|playoffs?\s+berth|make\s+playoffs|win\s+total\s+(season|20\d\d)|next\s+(team|coach|manager)|fired|hired/.test(titleLower)) {
    return SportsMarketType.FUTURES;
  }

  // Spread detection (point spread / handicap)
  if (/spread|handicap|\+\d+\.?\d*|\-\d+\.?\d*\s*(point|pts)?/.test(titleLower)) {
    return SportsMarketType.SPREAD;
  }

  // Total detection (over/under)
  if (/over\/under|over\s*\/?\s*under|total\s+(points|goals|runs)|o\/u|\bo\s*\d+\.?\d*\b|\bu\s*\d+\.?\d*\b|over\s+\d+\.?\d*|under\s+\d+\.?\d*/.test(titleLower)) {
    return SportsMarketType.TOTAL;
  }

  // Moneyline detection (who wins)
  if (/(?:will\s+)?(.+?)\s+(win|beat|defeat)|moneyline|money\s+line|to\s+win|winner(\s+of)?/.test(titleLower) ||
      /^(.+?)\s+(?:vs\.?|v\.?|@)\s+(.+?)$/.test(titleLower)) {
    return SportsMarketType.MONEYLINE;
  }

  return SportsMarketType.UNKNOWN;
}

/**
 * Detect period from title
 */
export function detectPeriod(title: string): SportsPeriod {
  const titleLower = title.toLowerCase();

  if (/\b(1st|first)\s+(half|h)\b|\b1h\b/.test(titleLower)) return SportsPeriod.FIRST_HALF;
  if (/\b(2nd|second)\s+(half|h)\b|\b2h\b/.test(titleLower)) return SportsPeriod.SECOND_HALF;
  if (/\b(1st|first)\s+(quarter|q)\b|\bq1\b/.test(titleLower)) return SportsPeriod.FIRST_QUARTER;
  if (/\b(2nd|second)\s+(quarter|q)\b|\bq2\b/.test(titleLower)) return SportsPeriod.SECOND_QUARTER;
  if (/\b(3rd|third)\s+(quarter|q)\b|\bq3\b/.test(titleLower)) return SportsPeriod.THIRD_QUARTER;
  if (/\b(4th|fourth)\s+(quarter|q)\b|\bq4\b/.test(titleLower)) return SportsPeriod.FOURTH_QUARTER;
  if (/\b(1st|first)\s+period\b|\bp1\b/.test(titleLower)) return SportsPeriod.FIRST_PERIOD;
  if (/\b(2nd|second)\s+period\b|\bp2\b/.test(titleLower)) return SportsPeriod.SECOND_PERIOD;
  if (/\b(3rd|third)\s+period\b|\bp3\b/.test(titleLower)) return SportsPeriod.THIRD_PERIOD;
  if (/overtime|ot\b/.test(titleLower)) return SportsPeriod.OVERTIME;

  return SportsPeriod.FULL_GAME;
}

/**
 * Extract line value from title (for spread/total)
 */
export function extractLineValue(title: string, marketType: SportsMarketType): number | null {
  if (marketType === SportsMarketType.SPREAD) {
    // Look for spread values: +3.5, -7, etc.
    const spreadMatch = title.match(/([+-]?\d+\.?\d*)\s*(point|pts)?/i);
    if (spreadMatch) {
      return parseFloat(spreadMatch[1]);
    }
  }

  if (marketType === SportsMarketType.TOTAL) {
    // Look for over/under values
    const totalMatch = title.match(/(?:over|under|o\/u|total)\s*(\d+\.?\d*)/i);
    if (totalMatch) {
      return parseFloat(totalMatch[1]);
    }
  }

  return null;
}

/**
 * Extract side from title
 */
export function extractSide(title: string): SpreadSide {
  const titleLower = title.toLowerCase();

  if (/\bover\b/.test(titleLower)) return SpreadSide.OVER;
  if (/\bunder\b/.test(titleLower)) return SpreadSide.UNDER;
  if (/\bhome\b/.test(titleLower)) return SpreadSide.HOME;
  if (/\baway\b/.test(titleLower)) return SpreadSide.AWAY;
  if (/\byes\b/.test(titleLower)) return SpreadSide.YES;
  if (/\bno\b/.test(titleLower)) return SpreadSide.NO;

  return SpreadSide.UNKNOWN;
}

/**
 * Check if two team names match (using normalization)
 */
export function teamsMatch(teamA: string, teamB: string): boolean {
  const normA = normalizeTeamName(teamA);
  const normB = normalizeTeamName(teamB);
  return normA === normB && normA !== '';
}

/**
 * Generate event key from teams + start time bucket
 * This is the primary index key for event-first matching
 */
export function generateEventKey(
  league: SportsLeague,
  teamA: string,
  teamB: string,
  startTimeBucket: string
): string {
  // Sort teams alphabetically for consistent key regardless of order
  const teams = [normalizeTeamName(teamA), normalizeTeamName(teamB)].sort();
  return `${league}|${teams[0]}|${teams[1]}|${startTimeBucket}`;
}

/**
 * Generate start time bucket (30-minute windows)
 */
export function generateTimeBucket(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const halfHour = date.getUTCMinutes() < 30 ? '00' : '30';
  return `${year}-${month}-${day}T${hour}:${halfHour}`;
}

/**
 * Check if two time buckets are adjacent (for ±1 bucket tolerance)
 */
export function areTimeBucketsAdjacent(bucket1: string, bucket2: string): boolean {
  if (bucket1 === bucket2) return true;

  const parse = (b: string) => {
    const [date, time] = b.split('T');
    const [year, month, day] = date.split('-').map(Number);
    const [hour, min] = time.split(':').map(Number);
    return new Date(Date.UTC(year, month - 1, day, hour, min));
  };

  const d1 = parse(bucket1);
  const d2 = parse(bucket2);
  const diff = Math.abs(d1.getTime() - d2.getTime());

  // Adjacent = within 30 minutes
  return diff <= 30 * 60 * 1000;
}

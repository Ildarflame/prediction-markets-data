/**
 * Team Aliases (v3.0.16)
 *
 * Comprehensive team alias dictionary for universal matching.
 * Includes esports, traditional sports, and international teams.
 *
 * Format: CANONICAL_NAME -> [aliases...]
 * All values are lowercase for matching.
 */

// ============================================================================
// ESPORTS TEAMS - CS2, Valorant, LoL, Dota 2
// ============================================================================

export const ESPORTS_TEAMS: Record<string, string[]> = {
  // CS2 Tier 1
  'TEAM_VITALITY': ['vitality', 'team vitality', 'vit', 't.vitality', 'vita'],
  'TEAM_FALCONS': ['falcons', 'team falcons', 'fal', 't.falcons', 'the falcons'],
  'NAVI': ['navi', 'natus vincere', "na'vi", 'natus', 'navi cs'],
  'G2_ESPORTS': ['g2', 'g2 esports', 'g2.esports', 'g2esports'],
  'FAZE_CLAN': ['faze', 'faze clan', 'fazeclan'],
  'TEAM_SPIRIT': ['spirit', 'team spirit', 'ts'],
  'MOUZ': ['mouz', 'mousesports', 'mouse'],
  'HEROIC': ['heroic', 'heroic gg'],
  'COMPLEXITY': ['complexity', 'col', 'complexity gaming'],
  'CLOUD9': ['cloud9', 'c9', 'cloud 9'],
  'FNATIC': ['fnatic', 'fnc'],
  'ASTRALIS': ['astralis', 'ast'],
  'NINJAS_IN_PYJAMAS': ['nip', 'ninjas in pyjamas', 'ninjas'],
  'ENCE': ['ence', 'ence esports'],
  'BIG': ['big', 'big clan', 'berlin international gaming'],
  'VIRTUS_PRO': ['virtus pro', 'vp', 'virtus.pro', 'virtuspro'],
  'ETERNAL_FIRE': ['eternal fire', 'ef', 'eternalfire'],
  'LIQUID': ['liquid', 'team liquid', 'tl'],
  'PAIN_GAMING': ['pain', 'pain gaming', 'paingaming'],
  '3DMAX': ['3dmax', '3d max'],
  'MONTE': ['monte', 'monte esports'],
  'SAW': ['saw', 'saw esports'],
  'LEGACY': ['legacy', 'legacy esports'],
  'IMPERIAL': ['imperial', 'imperial esports'],
  'THE_MONGOLZ': ['the mongolz', 'mongolz'],
  'FLYQUEST': ['flyquest', 'fq'],
  'BETBOOM': ['betboom', 'betboom team', 'bb'],
  'PASSION_UA': ['passion ua', 'passionua', 'passion'],
  'GAMERLEGION': ['gamerlegion', 'gl', 'gamer legion'],

  // CS2 Tier 2
  'ECSTATIC': ['ecstatic'],
  'APEKS': ['apeks'],
  'AURORA': ['aurora', 'aurora gaming'],
  'LYNN_VISION': ['lynn vision', 'lynnvision'],
  'BLEED': ['bleed', 'bleed esports'],
  'SHARKS': ['sharks', 'sharks esports'],

  // Valorant Teams
  'SENTINELS': ['sentinels', 'sen'],
  'LOUD': ['loud', 'loud gg'],
  'DRX': ['drx', 'drx valorant'],
  'PAPER_REX': ['paper rex', 'prx', 'paperrex'],
  'GEN_G': ['gen.g', 'geng', 'gen g'],
  'EVIL_GENIUSES': ['evil geniuses', 'eg'],
  'NRG': ['nrg', 'nrg esports'],
  '100_THIEVES': ['100 thieves', '100t', '100thieves'],
  'T1': ['t1', 't1 esports'],
  'KARMINE_CORP': ['karmine corp', 'kc', 'karmine'],
  'KRU_ESPORTS': ['kru', 'kru esports'],
  'EDWARD_GAMING': ['edward gaming', 'edg'],
  'BILIBILI_GAMING': ['bilibili gaming', 'blg'],
  'TALON_ESPORTS': ['talon', 'talon esports'],
  'TEAM_HERETICS': ['team heretics', 'heretics', 'th'],

  // LoL Teams - LCK
  'T1_LOL': ['t1', 'sk telecom', 'skt', 'sk telecom t1'],
  'GEN_G_LOL': ['gen.g', 'geng', 'gen g', 'samsung', 'ssg'],
  'DK': ['damwon', 'dk', 'damwon kia', 'dwg'],
  'HANWHA_LIFE': ['hanwha', 'hanwha life', 'hle'],
  'KT_ROLSTER': ['kt', 'kt rolster', 'ktb'],
  'DPLUS_KIA': ['dplus', 'dplus kia', 'dk'],
  'KWANGDONG_FREECS': ['kwangdong', 'freecs', 'kdf'],

  // LoL Teams - LPL
  'JDG': ['jd gaming', 'jdg', 'jd'],
  'TOP_ESPORTS': ['top esports', 'tes', 'top'],
  'WEIBO_GAMING': ['weibo', 'weibo gaming', 'wbg'],
  'LNG_ESPORTS': ['lng', 'lng esports'],
  'ROYAL_NEVER_GIVE_UP': ['rng', 'royal never give up', 'royal'],
  'FUNPLUS_PHOENIX': ['fpx', 'funplus', 'funplus phoenix'],

  // LoL Teams - LEC
  'G2_ESPORTS_LOL': ['g2', 'g2 esports'],
  'FNATIC_LOL': ['fnatic', 'fnc'],
  'MAD_LIONS': ['mad lions', 'mad'],
  'ROGUE': ['rogue', 'rge'],
  'EXCEL': ['excel', 'xl'],
  'TEAM_BDS': ['bds', 'team bds'],
  'VITALITY_LOL': ['vitality', 'vit', 'team vitality'],
  'SK_GAMING': ['sk', 'sk gaming'],

  // LoL Teams - LCS
  'CLOUD9_LOL': ['cloud9', 'c9'],
  'TEAM_LIQUID_LOL': ['liquid', 'tl', 'team liquid'],
  'FLYQUEST_LOL': ['flyquest', 'fq', 'fly'],
  '100_THIEVES_LOL': ['100 thieves', '100t'],
  'NRG_LOL': ['nrg'],
  'DIGNITAS': ['dignitas', 'dig'],
  'IMMORTALS': ['immortals', 'imt'],
  'GOLDEN_GUARDIANS': ['golden guardians', 'gg'],

  // Dota 2 Teams
  'TEAM_SPIRIT_DOTA': ['spirit', 'team spirit', 'ts'],
  'GAIMIN_GLADIATORS': ['gaimin', 'gaimin gladiators', 'gg'],
  'TUNDRA_ESPORTS': ['tundra', 'tundra esports'],
  'QUEST': ['quest', 'quest esports'],
  'OG': ['og', 'og dota'],
  'NIGMA_GALAXY': ['nigma', 'nigma galaxy', 'ng'],
  'ENTITY': ['entity', 'entity esports'],
  'BEASTCOAST': ['beastcoast', 'bc'],
  'XTREME_GAMING': ['xtreme', 'xtreme gaming', 'xg'],
  'AZURE_RAY': ['azure ray', 'ar'],
};

// ============================================================================
// UFC FIGHTERS - Top ranked fighters
// ============================================================================

export const UFC_FIGHTERS: Record<string, string[]> = {
  'ISLAM_MAKHACHEV': ['islam', 'makhachev', 'islam makhachev'],
  'JON_JONES': ['jon jones', 'jones', 'bones'],
  'ALEX_PEREIRA': ['alex pereira', 'pereira', 'poatan'],
  'LEON_EDWARDS': ['leon edwards', 'edwards', 'rocky'],
  'ILIA_TOPURIA': ['ilia topuria', 'topuria', 'el matador'],
  'DRICUS_DU_PLESSIS': ['dricus', 'du plessis', 'stillknocks'],
  'TOM_ASPINALL': ['tom aspinall', 'aspinall'],
  'MAX_HOLLOWAY': ['max holloway', 'holloway', 'blessed'],
  'SEAN_STRICKLAND': ['sean strickland', 'strickland'],
  'BELAL_MUHAMMAD': ['belal', 'belal muhammad', 'remember the name'],
  'MERAB_DVALISHVILI': ['merab', 'dvalishvili', 'the machine'],
  'ALEXANDER_VOLKANOVSKI': ['volkanovski', 'volk', 'the great'],
  'CHARLES_OLIVEIRA': ['charles oliveira', 'oliveira', 'do bronx'],
  'DUSTIN_POIRIER': ['dustin poirier', 'poirier', 'the diamond'],
  'KAMARU_USMAN': ['kamaru usman', 'usman', 'nigerian nightmare'],
  'CONOR_MCGREGOR': ['conor', 'mcgregor', 'conor mcgregor', 'notorious'],
  'KHABIB_NURMAGOMEDOV': ['khabib', 'nurmagomedov', 'the eagle'],
  'SEAN_OMALLEY': ["sean o'malley", 'omalley', "o'malley", 'suga'],
  'JIRI_PROCHAZKA': ['jiri', 'prochazka', 'jiri prochazka'],
  'JAMAHAL_HILL': ['jamahal hill', 'hill', 'sweet dreams'],
  'MAGOMED_ANKALAEV': ['ankalaev', 'magomed ankalaev'],
  'ROBERT_WHITTAKER': ['robert whittaker', 'whittaker', 'bobby knuckles'],
  'ISRAEL_ADESANYA': ['israel adesanya', 'adesanya', 'izzy', 'stylebender'],
};

// ============================================================================
// TENNIS PLAYERS - ATP/WTA Top ranked
// ============================================================================

export const TENNIS_PLAYERS: Record<string, string[]> = {
  // ATP
  'JANNIK_SINNER': ['sinner', 'jannik sinner'],
  'CARLOS_ALCARAZ': ['alcaraz', 'carlos alcaraz', 'carlitos'],
  'NOVAK_DJOKOVIC': ['djokovic', 'novak', 'novak djokovic', 'nole'],
  'DANIIL_MEDVEDEV': ['medvedev', 'daniil medvedev'],
  'ALEXANDER_ZVEREV': ['zverev', 'sascha', 'alexander zverev'],
  'ANDREY_RUBLEV': ['rublev', 'andrey rublev'],
  'CASPER_RUUD': ['ruud', 'casper ruud'],
  'HUBERT_HURKACZ': ['hurkacz', 'hubert hurkacz', 'hubi'],
  'TAYLOR_FRITZ': ['fritz', 'taylor fritz'],
  'STEFANOS_TSITSIPAS': ['tsitsipas', 'stefanos', 'stefanos tsitsipas'],
  'RAFAEL_NADAL': ['nadal', 'rafa', 'rafael nadal'],
  'ROGER_FEDERER': ['federer', 'roger federer', 'fed'],
  'GRIGOR_DIMITROV': ['dimitrov', 'grigor dimitrov'],
  'ALEX_DE_MINAUR': ['de minaur', 'alex de minaur', 'demon'],
  'TOMMY_PAUL': ['tommy paul', 'paul'],
  'BEN_SHELTON': ['shelton', 'ben shelton'],
  'FRANCES_TIAFOE': ['tiafoe', 'frances tiafoe', 'big foe'],
  'HOLGER_RUNE': ['rune', 'holger rune'],
  'FELIX_AUGER_ALIASSIME': ['faa', 'auger-aliassime', 'felix auger-aliassime'],
  'JACK_DRAPER': ['draper', 'jack draper'],

  // WTA
  'IGA_SWIATEK': ['swiatek', 'iga swiatek', 'iga'],
  'ARYNA_SABALENKA': ['sabalenka', 'aryna sabalenka'],
  'COCO_GAUFF': ['gauff', 'coco gauff', 'coco'],
  'ELENA_RYBAKINA': ['rybakina', 'elena rybakina'],
  'JESSICA_PEGULA': ['pegula', 'jessica pegula'],
  'ONSJ_JABEUR': ['jabeur', 'ons jabeur'],
  'MARIA_SAKKARI': ['sakkari', 'maria sakkari'],
  'QINWEN_ZHENG': ['zheng', 'qinwen zheng', 'zheng qinwen'],
  'BARBORA_KREJCIKOVA': ['krejcikova', 'barbora krejcikova'],
  'EMMA_RADUCANU': ['raducanu', 'emma raducanu'],
  'NAOMI_OSAKA': ['osaka', 'naomi osaka'],
  'SERENA_WILLIAMS': ['serena', 'serena williams'],
  'VENUS_WILLIAMS': ['venus', 'venus williams'],
  'DANIELLE_COLLINS': ['collins', 'danielle collins'],
  'JASMINE_PAOLINI': ['paolini', 'jasmine paolini'],
  'MIRRA_ANDREEVA': ['andreeva', 'mirra andreeva'],
};

// ============================================================================
// EUROPEAN SOCCER TEAMS (extending existing aliases)
// ============================================================================

export const EUROPEAN_SOCCER_TEAMS: Record<string, string[]> = {
  // Portuguese Liga
  'BENFICA': ['benfica', 'sl benfica', 'sport lisboa', 'eagles'],
  'PORTO': ['porto', 'fc porto', 'dragoes'],
  'SPORTING_CP': ['sporting', 'sporting cp', 'sporting lisbon', 'lions'],
  'BRAGA': ['braga', 'sc braga', 'arsenalistas'],
  'VITORIA_SC': ['vitoria sc', 'vitoria guimaraes', 'vitoria'],

  // Scottish Premiership
  'CELTIC': ['celtic', 'celtic fc', 'hoops', 'bhoys'],
  'RANGERS': ['rangers', 'rangers fc', 'gers'],
  'ABERDEEN': ['aberdeen', 'aberdeen fc', 'dons'],
  'HEARTS': ['hearts', 'heart of midlothian', 'jambos'],
  'HIBERNIAN': ['hibernian', 'hibs', 'hibees'],
  'KILMARNOCK': ['kilmarnock', 'killie'],
  'MOTHERWELL': ['motherwell', 'well', 'steelmen'],
  'DUNDEE_UNITED': ['dundee united', 'dundee utd', 'united'],
  'ST_MIRREN': ['st mirren', 'saints', 'buddies'],
  'ROSS_COUNTY': ['ross county', 'county', 'staggies'],
  'ST_JOHNSTONE': ['st johnstone', 'saints'],
  'DUNDEE': ['dundee', 'dundee fc', 'dee'],

  // Turkish Super Lig
  'GALATASARAY': ['galatasaray', 'gala', 'cim bom'],
  'FENERBAHCE': ['fenerbahce', 'fener'],
  'BESIKTAS': ['besiktas', 'kara kartal', 'black eagles'],
  'TRABZONSPOR': ['trabzonspor', 'trabzon', 'ts'],
  'BASAKSEHIR': ['basaksehir', 'istanbul basaksehir'],

  // Dutch Eredivisie
  'AJAX': ['ajax', 'afc ajax', 'godenzonen'],
  'PSV': ['psv', 'psv eindhoven', 'eindhoven'],
  'FEYENOORD': ['feyenoord', 'rotterdam'],
  'AZ_ALKMAAR': ['az', 'az alkmaar', 'alkmaar'],
  'TWENTE': ['twente', 'fc twente'],
  'UTRECHT': ['utrecht', 'fc utrecht'],

  // Belgian Pro League
  'CLUB_BRUGGE': ['club brugge', 'brugge', 'blauw-zwart'],
  'ANDERLECHT': ['anderlecht', 'rsca', 'paars-wit'],
  'GENK': ['genk', 'krc genk'],
  'STANDARD_LIEGE': ['standard', 'standard liege', 'rouches'],
  'GENT': ['gent', 'kaa gent', 'buffalo'],
  'ANTWERP': ['antwerp', 'royal antwerp', 'great old'],

  // English Championship
  'LEEDS_UNITED': ['leeds', 'leeds united', 'lufc', 'whites'],
  'SHEFFIELD_WEDNESDAY': ['sheffield wednesday', 'wednesday', 'owls'],
  'SUNDERLAND': ['sunderland', 'black cats', 'safc'],
  'MIDDLESBROUGH': ['middlesbrough', 'boro', 'boro fc'],
  'NORWICH': ['norwich', 'norwich city', 'canaries'],
  'WEST_BROM': ['west brom', 'west bromwich', 'albion', 'baggies'],
  'WATFORD': ['watford', 'hornets'],
  'STOKE': ['stoke', 'stoke city', 'potters'],
  'COVENTRY': ['coventry', 'coventry city', 'sky blues'],
  'BRISTOL_CITY': ['bristol city', 'robins'],
  'BLACKBURN': ['blackburn', 'blackburn rovers', 'rovers'],
  'HULL': ['hull', 'hull city', 'tigers'],
  'SWANSEA': ['swansea', 'swansea city', 'swans', 'jacks'],
  'MILLWALL': ['millwall', 'lions'],
  'QPR': ['qpr', 'queens park rangers', 'rangers', 'hoops'],
  'CARDIFF': ['cardiff', 'cardiff city', 'bluebirds'],
  'PRESTON': ['preston', 'preston north end', 'pne', 'lilywhites'],
  'PLYMOUTH': ['plymouth', 'plymouth argyle', 'argyle', 'pilgrims'],
  'SHEFFIELD_UNITED': ['sheffield united', 'blades', 'sufc'],
  'BURNLEY': ['burnley', 'clarets'],
  'LUTON': ['luton', 'luton town', 'hatters'],

  // French Ligue 1 (extending)
  'PSG': ['psg', 'paris', 'paris saint-germain', 'paris sg'],
  'MARSEILLE': ['marseille', 'om', 'olympique marseille'],
  'MONACO': ['monaco', 'as monaco'],
  'LYON': ['lyon', 'ol', 'olympique lyonnais'],
  'LILLE': ['lille', 'losc', 'dogues'],
  'NICE': ['nice', 'ogc nice', 'aiglons'],
  'LENS': ['lens', 'rc lens', 'sang et or'],
  'RENNES': ['rennes', 'stade rennais'],
  'STRASBOURG': ['strasbourg', 'racing strasbourg', 'rcsa'],
  'NANTES': ['nantes', 'fc nantes', 'canaris'],
  'TOULOUSE': ['toulouse', 'tfc', 'violets'],
  'BREST': ['brest', 'stade brestois'],
  'MONTPELLIER': ['montpellier', 'mhsc', 'paillade'],
  'REIMS': ['reims', 'stade de reims'],
  'LE_HAVRE': ['le havre', 'hac'],
  'METZ': ['metz', 'fc metz', 'grenats'],
};

// ============================================================================
// MLB TEAMS (full roster)
// ============================================================================

export const MLB_TEAMS: Record<string, string[]> = {
  'NEW_YORK_YANKEES': ['yankees', 'ny yankees', 'bronx bombers', 'nyy'],
  'LOS_ANGELES_DODGERS': ['dodgers', 'la dodgers', 'lad'],
  'BOSTON_RED_SOX': ['red sox', 'boston', 'sox', 'bos'],
  'CHICAGO_CUBS': ['cubs', 'chicago cubs', 'cubbies', 'chc'],
  'NEW_YORK_METS': ['mets', 'ny mets', 'amazins', 'nym'],
  'ATLANTA_BRAVES': ['braves', 'atlanta braves', 'atl'],
  'HOUSTON_ASTROS': ['astros', 'houston', 'stros', 'hou'],
  'PHILADELPHIA_PHILLIES': ['phillies', 'philly', 'phi', 'fightin phils'],
  'SAN_DIEGO_PADRES': ['padres', 'san diego', 'friars', 'sd'],
  'SEATTLE_MARINERS': ['mariners', 'seattle', 'ms', 'sea'],
  'TAMPA_BAY_RAYS': ['rays', 'tampa bay', 'tb', 'tbr'],
  'CLEVELAND_GUARDIANS': ['guardians', 'cleveland', 'cle', 'tribe'],
  'MINNESOTA_TWINS': ['twins', 'minnesota', 'min', 'twinkies'],
  'TORONTO_BLUE_JAYS': ['blue jays', 'jays', 'toronto', 'tor'],
  'BALTIMORE_ORIOLES': ['orioles', 'baltimore', 'os', 'bal'],
  'DETROIT_TIGERS': ['tigers', 'detroit', 'det'],
  'KANSAS_CITY_ROYALS': ['royals', 'kansas city', 'kc', 'kcr'],
  'CHICAGO_WHITE_SOX': ['white sox', 'chi sox', 'south siders', 'cws'],
  'LOS_ANGELES_ANGELS': ['angels', 'la angels', 'anaheim', 'laa'],
  'TEXAS_RANGERS': ['rangers', 'texas', 'tex'],
  'OAKLAND_ATHLETICS': ['athletics', 'as', 'oakland', 'oak', "a's"],
  'CINCINNATI_REDS': ['reds', 'cincinnati', 'cin', 'redlegs'],
  'MILWAUKEE_BREWERS': ['brewers', 'milwaukee', 'brew crew', 'mil'],
  'PITTSBURGH_PIRATES': ['pirates', 'pittsburgh', 'buccos', 'pit'],
  'ST_LOUIS_CARDINALS': ['cardinals', 'st louis', 'cards', 'stl'],
  'WASHINGTON_NATIONALS': ['nationals', 'washington', 'nats', 'wsh'],
  'MIAMI_MARLINS': ['marlins', 'miami', 'fish', 'mia'],
  'COLORADO_ROCKIES': ['rockies', 'colorado', 'col'],
  'ARIZONA_DIAMONDBACKS': ['diamondbacks', 'dbacks', 'arizona', 'ari', 'snakes'],
  'SAN_FRANCISCO_GIANTS': ['giants', 'san francisco', 'sf', 'sfg'],
};

// ============================================================================
// GOLF PLAYERS - Top ranked
// ============================================================================

export const GOLF_PLAYERS: Record<string, string[]> = {
  'SCOTTIE_SCHEFFLER': ['scheffler', 'scottie scheffler', 'scottie'],
  'RORY_MCILROY': ['rory', 'mcilroy', 'rory mcilroy', 'rors'],
  'JON_RAHM': ['rahm', 'jon rahm', 'rahmbo'],
  'XANDER_SCHAUFFELE': ['xander', 'schauffele', 'xander schauffele'],
  'VIKTOR_HOVLAND': ['hovland', 'viktor hovland'],
  'COLLIN_MORIKAWA': ['morikawa', 'collin morikawa'],
  'PATRICK_CANTLAY': ['cantlay', 'patrick cantlay'],
  'BROOKS_KOEPKA': ['koepka', 'brooks koepka', 'brooks'],
  'BRYSON_DECHAMBEAU': ['bryson', 'dechambeau', 'bryson dechambeau'],
  'DUSTIN_JOHNSON': ['dj', 'dustin johnson', 'dustin'],
  'JORDAN_SPIETH': ['spieth', 'jordan spieth'],
  'JUSTIN_THOMAS': ['jt', 'justin thomas'],
  'TONY_FINAU': ['finau', 'tony finau'],
  'MAX_HOMA': ['homa', 'max homa'],
  'CAMERON_SMITH': ['cam smith', 'cameron smith'],
  'HIDEKI_MATSUYAMA': ['matsuyama', 'hideki', 'hideki matsuyama'],
  'TIGER_WOODS': ['tiger', 'tiger woods', 'tw'],
  'PHIL_MICKELSON': ['phil', 'mickelson', 'phil mickelson', 'lefty'],
  'WYNDHAM_CLARK': ['wyndham clark', 'clark'],
  'LUDVIG_ABERG': ['aberg', 'ludvig aberg'],
};

// ============================================================================
// F1 DRIVERS AND TEAMS
// ============================================================================

export const F1_DRIVERS: Record<string, string[]> = {
  'MAX_VERSTAPPEN': ['verstappen', 'max verstappen', 'max', 'mad max'],
  'LEWIS_HAMILTON': ['hamilton', 'lewis hamilton', 'lewis', 'sir lewis'],
  'CHARLES_LECLERC': ['leclerc', 'charles leclerc', 'charles'],
  'LANDO_NORRIS': ['norris', 'lando norris', 'lando'],
  'CARLOS_SAINZ': ['sainz', 'carlos sainz', 'carlos', 'smooth operator'],
  'GEORGE_RUSSELL': ['russell', 'george russell', 'george'],
  'SERGIO_PEREZ': ['perez', 'checo', 'sergio perez'],
  'OSCAR_PIASTRI': ['piastri', 'oscar piastri', 'oscar'],
  'FERNANDO_ALONSO': ['alonso', 'fernando alonso', 'fernando', 'el plan'],
  'LANCE_STROLL': ['stroll', 'lance stroll', 'lance'],
  'PIERRE_GASLY': ['gasly', 'pierre gasly', 'pierre'],
  'ESTEBAN_OCON': ['ocon', 'esteban ocon', 'esteban'],
  'ALEXANDER_ALBON': ['albon', 'alex albon', 'alex'],
  'YUKI_TSUNODA': ['tsunoda', 'yuki tsunoda', 'yuki'],
  'VALTTERI_BOTTAS': ['bottas', 'valtteri bottas', 'valtteri'],
  'ZHOU_GUANYU': ['zhou', 'guanyu zhou', 'zhou guanyu'],
  'KEVIN_MAGNUSSEN': ['magnussen', 'kevin magnussen', 'kmag'],
  'NICO_HULKENBERG': ['hulkenberg', 'nico hulkenberg', 'hulk'],
  'DANIEL_RICCIARDO': ['ricciardo', 'daniel ricciardo', 'danny ric'],
  'LOGAN_SARGEANT': ['sargeant', 'logan sargeant', 'logan'],
};

export const F1_TEAMS: Record<string, string[]> = {
  'RED_BULL': ['red bull', 'red bull racing', 'rbr', 'redbull'],
  'MERCEDES': ['mercedes', 'mercedes amg', 'merc', 'silver arrows'],
  'FERRARI': ['ferrari', 'scuderia ferrari', 'sf', 'prancing horse'],
  'MCLAREN': ['mclaren', 'mclaren f1', 'papaya'],
  'ASTON_MARTIN': ['aston martin', 'aston', 'amr'],
  'ALPINE': ['alpine', 'alpine f1'],
  'WILLIAMS': ['williams', 'williams racing'],
  'RB': ['rb', 'racing bulls', 'visa cashapp rb'],
  'KICK_SAUBER': ['sauber', 'kick sauber', 'stake f1'],
  'HAAS': ['haas', 'haas f1', 'haas team'],
};

// ============================================================================
// COMBINED EXPORT - ALL TEAMS
// ============================================================================

export const ALL_TEAM_ALIASES: Record<string, string[]> = {
  ...ESPORTS_TEAMS,
  ...UFC_FIGHTERS,
  ...TENNIS_PLAYERS,
  ...EUROPEAN_SOCCER_TEAMS,
  ...MLB_TEAMS,
  ...GOLF_PLAYERS,
  ...F1_DRIVERS,
  ...F1_TEAMS,
};

/**
 * Build a reverse lookup map: alias -> canonical name
 * Used for fast O(1) lookups during extraction
 */
export function buildAliasLookup(aliases: Record<string, string[]>): Map<string, string> {
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

// Pre-built lookup maps for fast access
export const ESPORTS_LOOKUP = buildAliasLookup(ESPORTS_TEAMS);
export const UFC_LOOKUP = buildAliasLookup(UFC_FIGHTERS);
export const TENNIS_LOOKUP = buildAliasLookup(TENNIS_PLAYERS);
export const SOCCER_LOOKUP = buildAliasLookup(EUROPEAN_SOCCER_TEAMS);
export const MLB_LOOKUP = buildAliasLookup(MLB_TEAMS);
export const GOLF_LOOKUP = buildAliasLookup(GOLF_PLAYERS);
export const F1_LOOKUP = buildAliasLookup({ ...F1_DRIVERS, ...F1_TEAMS });
export const ALL_LOOKUP = buildAliasLookup(ALL_TEAM_ALIASES);

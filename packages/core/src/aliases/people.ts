/**
 * People Aliases (v3.0.16)
 *
 * Politicians, celebrities, executives for universal matching.
 * Format: CANONICAL_NAME -> [aliases...]
 */

// ============================================================================
// US POLITICIANS
// ============================================================================

export const US_POLITICIANS: Record<string, string[]> = {
  // Presidents & Former Presidents
  'DONALD_TRUMP': ['trump', 'donald trump', 'donald j trump', 'djt', 'trump 47', 'potus'],
  'JOE_BIDEN': ['biden', 'joe biden', 'joseph biden', 'president biden'],
  'BARACK_OBAMA': ['obama', 'barack obama', 'president obama', '44'],
  'GEORGE_W_BUSH': ['george bush', 'george w bush', 'w', 'dubya', '43'],
  'BILL_CLINTON': ['clinton', 'bill clinton', 'president clinton', '42'],

  // Vice Presidents
  'KAMALA_HARRIS': ['kamala', 'harris', 'kamala harris', 'vp harris', 'vice president harris'],
  'JD_VANCE': ['jd vance', 'vance', 'j.d. vance'],
  'MIKE_PENCE': ['pence', 'mike pence', 'michael pence'],

  // Cabinet & Administration
  'ELON_MUSK': ['musk', 'elon musk', 'elon', 'doge czar'],
  'VIVEK_RAMASWAMY': ['vivek', 'ramaswamy', 'vivek ramaswamy'],
  'MARCO_RUBIO': ['rubio', 'marco rubio', 'secretary rubio'],
  'PETE_HEGSETH': ['hegseth', 'pete hegseth', 'secretary hegseth'],
  'TULSI_GABBARD': ['tulsi', 'gabbard', 'tulsi gabbard'],
  'RFK_JR': ['rfk', 'rfk jr', 'kennedy', 'robert kennedy jr', 'robert f kennedy'],
  'DOUG_BURGUM': ['burgum', 'doug burgum'],
  'KRISTI_NOEM': ['noem', 'kristi noem'],
  'KASH_PATEL': ['kash patel', 'patel', 'kash'],
  'MATT_GAETZ': ['gaetz', 'matt gaetz'],
  'LINDA_MCMAHON': ['mcmahon', 'linda mcmahon'],
  'HOWARD_LUTNICK': ['lutnick', 'howard lutnick'],

  // Senate Leaders
  'CHUCK_SCHUMER': ['schumer', 'chuck schumer', 'senate majority leader'],
  'MITCH_MCCONNELL': ['mcconnell', 'mitch mcconnell', 'senate minority leader'],
  'JOHN_THUNE': ['thune', 'john thune'],

  // House Leaders
  'MIKE_JOHNSON': ['mike johnson', 'speaker johnson', 'house speaker'],
  'HAKEEM_JEFFRIES': ['jeffries', 'hakeem jeffries', 'house minority leader'],
  'KEVIN_MCCARTHY': ['mccarthy', 'kevin mccarthy'],
  'NANCY_PELOSI': ['pelosi', 'nancy pelosi', 'speaker pelosi'],

  // Supreme Court Justices
  'JOHN_ROBERTS': ['roberts', 'john roberts', 'chief justice roberts'],
  'CLARENCE_THOMAS': ['clarence thomas', 'thomas', 'justice thomas'],
  'SAMUEL_ALITO': ['alito', 'samuel alito', 'justice alito'],
  'SONIA_SOTOMAYOR': ['sotomayor', 'sonia sotomayor', 'justice sotomayor'],
  'ELENA_KAGAN': ['kagan', 'elena kagan', 'justice kagan'],
  'NEIL_GORSUCH': ['gorsuch', 'neil gorsuch', 'justice gorsuch'],
  'BRETT_KAVANAUGH': ['kavanaugh', 'brett kavanaugh', 'justice kavanaugh'],
  'AMY_CONEY_BARRETT': ['barrett', 'amy coney barrett', 'acb', 'justice barrett'],
  'KETANJI_BROWN_JACKSON': ['kbj', 'ketanji', 'ketanji brown jackson', 'justice jackson'],

  // Governors (Key States)
  'RON_DESANTIS': ['desantis', 'ron desantis', 'governor desantis'],
  'GAVIN_NEWSOM': ['newsom', 'gavin newsom', 'governor newsom'],
  'GREG_ABBOTT': ['abbott', 'greg abbott', 'governor abbott'],
  'JOSH_SHAPIRO': ['shapiro', 'josh shapiro', 'governor shapiro'],
  'GRETCHEN_WHITMER': ['whitmer', 'gretchen whitmer', 'governor whitmer'],
  'ANDY_BESHEAR': ['beshear', 'andy beshear', 'governor beshear'],
  'WES_MOORE': ['wes moore', 'governor moore'],
  'JB_PRITZKER': ['pritzker', 'jb pritzker', 'governor pritzker'],

  // Senators (Notable)
  'BERNIE_SANDERS': ['bernie', 'sanders', 'bernie sanders', 'senator sanders'],
  'ELIZABETH_WARREN': ['warren', 'elizabeth warren', 'senator warren'],
  'TED_CRUZ': ['cruz', 'ted cruz', 'senator cruz'],
  'RAND_PAUL': ['rand paul', 'senator paul'],
  'JOSH_HAWLEY': ['hawley', 'josh hawley'],
  'JON_OSSOFF': ['ossoff', 'jon ossoff'],
  'RAPHAEL_WARNOCK': ['warnock', 'raphael warnock'],
  'JOHN_FETTERMAN': ['fetterman', 'john fetterman'],
  'KATIE_BRITT': ['katie britt', 'britt'],
  'TOMMY_TUBERVILLE': ['tuberville', 'tommy tuberville'],

  // Representatives (Notable)
  'AOC': ['aoc', 'ocasio-cortez', 'alexandria ocasio-cortez', 'congresswoman ocasio-cortez'],
  'MARJORIE_TAYLOR_GREENE': ['mtg', 'marjorie taylor greene', 'greene'],
  'LAUREN_BOEBERT': ['boebert', 'lauren boebert'],
  'MATT_GAETZ_REP': ['gaetz', 'matt gaetz', 'representative gaetz'],
  'ILHAN_OMAR': ['omar', 'ilhan omar'],
  'RASHIDA_TLAIB': ['tlaib', 'rashida tlaib'],
  'AYANNA_PRESSLEY': ['pressley', 'ayanna pressley'],

  // Trump Family
  'DONALD_TRUMP_JR': ['trump jr', 'don jr', 'donald trump jr', 'djtj'],
  'IVANKA_TRUMP': ['ivanka', 'ivanka trump'],
  'ERIC_TRUMP': ['eric trump', 'eric'],
  'JARED_KUSHNER': ['kushner', 'jared kushner'],
  'BARRON_TRUMP': ['barron', 'barron trump'],
  'MELANIA_TRUMP': ['melania', 'melania trump', 'first lady'],

  // Biden Family
  'HUNTER_BIDEN': ['hunter', 'hunter biden'],
  'JILL_BIDEN': ['jill biden', 'dr jill biden', 'dr biden'],

  // Other Notable
  'NIKKI_HALEY': ['haley', 'nikki haley', 'ambassador haley'],
  'CHRIS_CHRISTIE': ['christie', 'chris christie'],
  'MIKE_POMPEO': ['pompeo', 'mike pompeo'],
  'WILLIAM_BARR': ['barr', 'bill barr', 'william barr'],
  'STEVE_BANNON': ['bannon', 'steve bannon'],
  'RUDY_GIULIANI': ['giuliani', 'rudy', 'rudy giuliani'],
};

// ============================================================================
// INTERNATIONAL POLITICIANS
// ============================================================================

export const INTERNATIONAL_POLITICIANS: Record<string, string[]> = {
  // Russia
  'VLADIMIR_PUTIN': ['putin', 'vladimir putin', 'president putin'],

  // Ukraine
  'VOLODYMYR_ZELENSKY': ['zelensky', 'zelenskyy', 'volodymyr zelensky', 'president zelensky'],

  // China
  'XI_JINPING': ['xi', 'xi jinping', 'president xi', 'general secretary xi'],

  // Israel
  'BENJAMIN_NETANYAHU': ['netanyahu', 'bibi', 'benjamin netanyahu', 'pm netanyahu'],
  'BENNY_GANTZ': ['gantz', 'benny gantz'],
  'YOAV_GALLANT': ['gallant', 'yoav gallant'],

  // UK
  'KEIR_STARMER': ['starmer', 'keir starmer', 'pm starmer', 'prime minister starmer'],
  'RISHI_SUNAK': ['sunak', 'rishi sunak'],
  'BORIS_JOHNSON': ['boris', 'boris johnson', 'bojo'],
  'LIZ_TRUSS': ['truss', 'liz truss'],
  'KING_CHARLES': ['king charles', 'charles iii', 'king charles iii'],
  'PRINCE_WILLIAM': ['prince william', 'william', 'duke of cambridge'],
  'PRINCE_HARRY': ['prince harry', 'harry', 'duke of sussex'],

  // France
  'EMMANUEL_MACRON': ['macron', 'emmanuel macron', 'president macron'],
  'MARINE_LE_PEN': ['le pen', 'marine le pen'],

  // Germany
  'OLAF_SCHOLZ': ['scholz', 'olaf scholz', 'chancellor scholz'],
  'FRIEDRICH_MERZ': ['merz', 'friedrich merz'],
  'ANGELA_MERKEL': ['merkel', 'angela merkel'],

  // Canada
  'JUSTIN_TRUDEAU': ['trudeau', 'justin trudeau', 'pm trudeau'],
  'PIERRE_POILIEVRE': ['poilievre', 'pierre poilievre'],
  'MARK_CARNEY': ['carney', 'mark carney'],

  // Mexico
  'CLAUDIA_SHEINBAUM': ['sheinbaum', 'claudia sheinbaum', 'president sheinbaum'],
  'ANDRES_MANUEL_LOPEZ_OBRADOR': ['amlo', 'lopez obrador', 'obrador'],

  // Brazil
  'LULA_DA_SILVA': ['lula', 'lula da silva', 'president lula'],
  'JAIR_BOLSONARO': ['bolsonaro', 'jair bolsonaro'],

  // Argentina
  'JAVIER_MILEI': ['milei', 'javier milei', 'president milei'],

  // India
  'NARENDRA_MODI': ['modi', 'narendra modi', 'pm modi'],
  'RAHUL_GANDHI': ['rahul gandhi', 'gandhi'],

  // Pakistan
  'IMRAN_KHAN': ['imran khan', 'imran'],

  // North Korea
  'KIM_JONG_UN': ['kim jong un', 'kim', 'supreme leader kim'],

  // Iran
  'MASOUD_PEZESHKIAN': ['pezeshkian', 'masoud pezeshkian'],
  'ALI_KHAMENEI': ['khamenei', 'supreme leader khamenei'],

  // Saudi Arabia
  'MBS': ['mbs', 'mohammed bin salman', 'crown prince mbs'],

  // Turkey
  'RECEP_ERDOGAN': ['erdogan', 'recep erdogan', 'president erdogan'],

  // Japan
  'SHIGERU_ISHIBA': ['ishiba', 'shigeru ishiba', 'pm ishiba'],

  // South Korea
  'YOON_SUK_YEOL': ['yoon', 'yoon suk yeol', 'president yoon'],

  // Taiwan
  'LAI_CHING_TE': ['lai', 'lai ching-te', 'president lai'],

  // Italy
  'GIORGIA_MELONI': ['meloni', 'giorgia meloni', 'pm meloni'],

  // Poland
  'DONALD_TUSK': ['tusk', 'donald tusk', 'pm tusk'],
  'ANDRZEJ_DUDA': ['duda', 'andrzej duda', 'president duda'],

  // Philippines
  'BONGBONG_MARCOS': ['marcos', 'bongbong marcos', 'bbm', 'ferdinand marcos jr'],

  // Vatican
  'POPE_FRANCIS': ['pope francis', 'francis', 'pope', 'holy father'],

  // South Africa
  'CYRIL_RAMAPHOSA': ['ramaphosa', 'cyril ramaphosa', 'president ramaphosa'],

  // Egypt
  'ABDEL_FATTAH_EL_SISI': ['sisi', 'el-sisi', 'president sisi'],

  // Syria
  'BASHAR_AL_ASSAD': ['assad', 'bashar assad', 'bashar al-assad'],
};

// ============================================================================
// TECH EXECUTIVES & BILLIONAIRES
// ============================================================================

export const TECH_EXECUTIVES: Record<string, string[]> = {
  // ELON_MUSK is defined in CELEBRITIES with more aliases
  'JEFF_BEZOS': ['bezos', 'jeff bezos'],
  'MARK_ZUCKERBERG': ['zuckerberg', 'zuck', 'mark zuckerberg'],
  'TIM_COOK': ['tim cook', 'cook'],
  'SATYA_NADELLA': ['nadella', 'satya nadella'],
  'SUNDAR_PICHAI': ['pichai', 'sundar pichai'],
  'SAM_ALTMAN': ['sam altman', 'altman'],
  'JENSEN_HUANG': ['jensen', 'jensen huang', 'huang'],
  'LARRY_ELLISON': ['ellison', 'larry ellison'],
  'BILL_GATES': ['bill gates', 'gates'],
  'WARREN_BUFFETT': ['buffett', 'warren buffett', 'oracle of omaha'],
  'JAMIE_DIMON': ['dimon', 'jamie dimon'],
  'LARRY_FINK': ['larry fink', 'fink'],
  'MICHAEL_SAYLOR': ['saylor', 'michael saylor'],
  'CHANGPENG_ZHAO': ['cz', 'changpeng zhao', 'binance ceo'],
  'BRIAN_ARMSTRONG': ['brian armstrong', 'armstrong'],
  'VITALIK_BUTERIN': ['vitalik', 'vitalik buterin', 'buterin'],
};

// ============================================================================
// CENTRAL BANKERS
// ============================================================================

export const CENTRAL_BANKERS: Record<string, string[]> = {
  'JEROME_POWELL': ['powell', 'jerome powell', 'fed chair powell', 'chair powell'],
  'CHRISTINE_LAGARDE': ['lagarde', 'christine lagarde', 'ecb president lagarde'],
  'ANDREW_BAILEY': ['bailey', 'andrew bailey', 'boe governor bailey'],
  'KAZUO_UEDA': ['ueda', 'kazuo ueda', 'boj governor ueda'],
  'PHILIP_LOWE': ['lowe', 'philip lowe', 'rba governor'],
  'TIFF_MACKLEM': ['macklem', 'tiff macklem', 'boc governor'],
};

// ============================================================================
// ENTERTAINERS & CELEBRITIES
// ============================================================================

export const CELEBRITIES: Record<string, string[]> = {
  // Musicians
  'TAYLOR_SWIFT': ['taylor swift', 'taylor', 'tay tay', 'swiftie'],
  'BEYONCE': ['beyonce', 'bey', 'queen bey'],
  'DRAKE': ['drake', 'drizzy', 'champagne papi'],
  'KENDRICK_LAMAR': ['kendrick', 'kendrick lamar', 'k dot'],
  'KANYE_WEST': ['kanye', 'ye', 'kanye west'],
  'TRAVIS_SCOTT': ['travis scott', 'travis', 'la flame'],
  'POST_MALONE': ['post malone', 'posty', 'post'],
  'BAD_BUNNY': ['bad bunny', 'benito'],
  'THE_WEEKND': ['the weeknd', 'weeknd', 'abel'],
  'BILLIE_EILISH': ['billie eilish', 'billie'],
  'DOJA_CAT': ['doja cat', 'doja'],
  'SZA': ['sza'],
  'RIHANNA': ['rihanna', 'riri'],
  'ADELE': ['adele'],
  'ED_SHEERAN': ['ed sheeran', 'ed'],
  'BRUNO_MARS': ['bruno mars', 'bruno'],
  'ARIANA_GRANDE': ['ariana grande', 'ariana', 'ari'],
  'DUA_LIPA': ['dua lipa', 'dua'],
  'HARRY_STYLES': ['harry styles', 'harry'],
  'SHAKIRA': ['shakira'],
  'MADONNA': ['madonna'],
  'LADY_GAGA': ['lady gaga', 'gaga'],
  'JUSTIN_BIEBER': ['justin bieber', 'bieber', 'jb'],
  'EMINEM': ['eminem', 'slim shady', 'marshall mathers'],
  'JAY_Z': ['jay-z', 'jay z', 'hov', 'shawn carter'],
  'SNOOP_DOGG': ['snoop dogg', 'snoop'],
  'ICE_SPICE': ['ice spice'],
  'CARDI_B': ['cardi b', 'cardi'],
  'MEGAN_THEE_STALLION': ['megan thee stallion', 'megan'],
  'NICKI_MINAJ': ['nicki minaj', 'nicki'],
  'LIL_BABY': ['lil baby'],
  'FUTURE': ['future'],
  'LIL_UZI_VERT': ['lil uzi vert', 'uzi'],
  'PLAYBOI_CARTI': ['playboi carti', 'carti'],
  'TRAVIS_KELCE': ['travis kelce', 'kelce'],
  'CHAPPELL_ROAN': ['chappell roan', 'chappell'],
  'SABRINA_CARPENTER': ['sabrina carpenter', 'sabrina'],

  // Actors
  'LEONARDO_DICAPRIO': ['dicaprio', 'leonardo dicaprio', 'leo'],
  'TOM_CRUISE': ['tom cruise', 'cruise'],
  'BRAD_PITT': ['brad pitt', 'pitt'],
  'JOHNNY_DEPP': ['johnny depp', 'depp'],
  'ROBERT_DOWNEY_JR': ['rdj', 'robert downey jr', 'downey'],
  'DWAYNE_JOHNSON': ['the rock', 'dwayne johnson', 'rock'],
  'TIMOTHEE_CHALAMET': ['timothee chalamet', 'timothee'],
  'ZENDAYA': ['zendaya'],
  'SYDNEY_SWEENEY': ['sydney sweeney', 'sydney'],
  'MARGOT_ROBBIE': ['margot robbie', 'margot'],
  'SCARLETT_JOHANSSON': ['scarlett johansson', 'scarlett'],

  // Influencers / Streamers
  'MR_BEAST': ['mrbeast', 'mr beast', 'jimmy donaldson'],
  'KAI_CENAT': ['kai cenat', 'kai'],
  'ISHOWSPEED': ['ishowspeed', 'speed'],
  'NINJA': ['ninja', 'tyler blevins'],
  'ASMONGOLD': ['asmongold', 'asmon'],
  'XQCOW': ['xqc', 'xqcow'],
  'POKIMANE': ['pokimane', 'poki'],

  // Podcasters / Media
  'JOE_ROGAN': ['joe rogan', 'rogan', 'jre'],
  'TUCKER_CARLSON': ['tucker carlson', 'tucker'],
  'ALEX_JONES': ['alex jones', 'infowars'],
  'BEN_SHAPIRO': ['ben shapiro', 'shapiro'],
  'JORDAN_PETERSON': ['jordan peterson', 'jp', 'peterson'],

  // Reality TV / Social Media
  'KIM_KARDASHIAN': ['kim kardashian', 'kim k', 'kimye'],
  'KYLIE_JENNER': ['kylie jenner', 'kylie'],
  'KENDALL_JENNER': ['kendall jenner', 'kendall'],
  'KHLOE_KARDASHIAN': ['khloe kardashian', 'khloe'],
  'KOURTNEY_KARDASHIAN': ['kourtney kardashian', 'kourtney'],
  'KRIS_JENNER': ['kris jenner', 'kris'],
  'HAILEY_BIEBER': ['hailey bieber', 'hailey'],
  'SELENA_GOMEZ': ['selena gomez', 'selena'],

  // Sports Athletes (Major)
  'LEBRON_JAMES': ['lebron', 'lebron james', 'king james', 'lbj'],
  'MICHAEL_JORDAN': ['michael jordan', 'mj', 'jordan', 'air jordan'],
  'STEPH_CURRY': ['steph curry', 'curry', 'stephen curry', 'chef curry'],
  'KEVIN_DURANT': ['kevin durant', 'kd', 'durant'],
  'GIANNIS_ANTETOKOUNMPO': ['giannis', 'greek freak', 'antetokounmpo'],
  'LUKA_DONCIC': ['luka', 'luka doncic', 'doncic'],
  'PATRICK_MAHOMES': ['mahomes', 'patrick mahomes', 'pm15'],
  'TOM_BRADY': ['tom brady', 'brady', 'tb12'],
  'AARON_RODGERS': ['aaron rodgers', 'rodgers'],
  'LIONEL_MESSI': ['messi', 'lionel messi', 'leo messi', 'goat'],
  'CRISTIANO_RONALDO': ['ronaldo', 'cristiano', 'cr7', 'cristiano ronaldo'],
  'KYLIAN_MBAPPE': ['mbappe', 'kylian mbappe'],
  'ERLING_HAALAND': ['haaland', 'erling haaland'],
  'SHOHEI_OHTANI': ['ohtani', 'shohei ohtani', 'sho time'],
  'MIKE_TROUT': ['trout', 'mike trout'],
  'AARON_JUDGE': ['judge', 'aaron judge'],
  'CONNOR_MCDAVID': ['mcdavid', 'connor mcdavid'],
  'SIDNEY_CROSBY': ['crosby', 'sidney crosby', 'sid the kid'],
  'SERENA_WILLIAMS_CELEB': ['serena', 'serena williams'],
  'TIGER_WOODS_CELEB': ['tiger', 'tiger woods'],
  'USAIN_BOLT': ['usain bolt', 'bolt'],
  'SIMONE_BILES': ['simone biles', 'biles'],
};

// ============================================================================
// COMBINED EXPORT
// ============================================================================

export const ALL_PEOPLE_ALIASES: Record<string, string[]> = {
  ...US_POLITICIANS,
  ...INTERNATIONAL_POLITICIANS,
  ...TECH_EXECUTIVES,
  ...CENTRAL_BANKERS,
  ...CELEBRITIES,
};

/**
 * Build a reverse lookup map: alias -> canonical name
 */
export function buildPeopleLookup(aliases: Record<string, string[]>): Map<string, string> {
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
export const US_POLITICIANS_LOOKUP = buildPeopleLookup(US_POLITICIANS);
export const INTERNATIONAL_LOOKUP = buildPeopleLookup(INTERNATIONAL_POLITICIANS);
export const TECH_LOOKUP = buildPeopleLookup(TECH_EXECUTIVES);
export const CENTRAL_BANKERS_LOOKUP = buildPeopleLookup(CENTRAL_BANKERS);
export const CELEBRITIES_LOOKUP = buildPeopleLookup(CELEBRITIES);
export const ALL_PEOPLE_LOOKUP = buildPeopleLookup(ALL_PEOPLE_ALIASES);

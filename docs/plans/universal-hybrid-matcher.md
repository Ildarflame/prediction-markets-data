# Universal Hybrid Matcher - Implementation Plan

**Version**: 1.0
**Date**: 2026-01-24
**Goal**: 80-90% recall на cross-venue matching
**Status**: Planning

---

## Executive Summary

Текущая архитектура использует отдельные pipelines для каждой категории (CRYPTO, MACRO, SPORTS...). Это приводит к пропущенным матчам в категориях без pipeline (esports, soccer, tennis, UFC).

**Universal Hybrid Matcher** - единый матчер который:
1. Работает для ВСЕХ категорий автоматически
2. Использует двухэтапный подход (fast candidate → precise scoring)
3. Сохраняет точность через entity extraction
4. Даёт объяснение каждому матчу

---

## Текущее состояние

### Покрытие по категориям

| Категория | Kalshi | Polymarket | Confirmed | Pipeline |
|-----------|--------|------------|-----------|----------|
| CRYPTO_DAILY | 592K | 8.7K | 107 | ✅ Есть |
| MACRO | 8.3K | 2K | 171 | ✅ Есть |
| RATES | 8K | 76 | 76 | ✅ Есть |
| ELECTIONS | 15K | 3.4K | 3 | ⚠️ Strict threshold |
| SPORTS | 651K | 18.9K | 0 | ❌ Не работает для esports |
| ESPORTS | 194 | 1,204 | 1 | ❌ Нет |
| SOCCER | 326 | 429 | 0 | ❌ Нет |
| UFC/MMA | 101 | 211 | 0 | ❌ Нет |
| TENNIS | 798 | 317 | 0 | ❌ Нет |
| ENTERTAINMENT | 255 | 2K | 0 | ❌ Нет |
| NULL (no topic) | 313K | 5.3K | 50 | ❌ Нет taxonomy |

**Итого пропущено**: ~12,000+ потенциальных матчей

### Существующие компоненты (можно переиспользовать)

```
packages/core/src/
├── extractor.ts          # Entity extraction (crypto, macro, dates, numbers)
├── matching.ts           # Jaccard, normalization, time scoring
└── taxonomy/             # Topic classification rules

services/worker/src/matching/
├── engineV3.ts           # Orchestration (fetch → index → score → dedup)
├── engineV3.types.ts     # Shared types
├── dispatcher.ts         # Pipeline registry
├── signals/
│   ├── ratesSignals.ts       # Central bank, meeting date, bps extraction
│   ├── electionsSignals.ts   # Country, office, candidate extraction
│   └── sportsSignals.ts      # Teams, league, time extraction
└── pipelines/
    └── basePipeline.ts       # TopicPipeline interface
```

---

## Архитектура Universal Hybrid Matcher

### Высокоуровневая схема

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         UNIVERSAL HYBRID MATCHER                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐               │
│  │   Kalshi    │     │  Polymarket │     │   Market    │               │
│  │   Markets   │     │   Markets   │     │   Links DB  │               │
│  └──────┬──────┘     └──────┬──────┘     └──────▲──────┘               │
│         │                   │                   │                       │
│         ▼                   ▼                   │                       │
│  ┌──────────────────────────────────────────────┴──────┐               │
│  │              STAGE 1: CANDIDATE GENERATION           │               │
│  │                    (Fast, High Recall)               │               │
│  ├──────────────────────────────────────────────────────┤               │
│  │  For each Kalshi market:                             │               │
│  │  1. Time filter: closeTime ±48h                      │               │
│  │  2. Text filter: word overlap ≥ 20%                  │               │
│  │  3. Entity filter: any shared entity                 │               │
│  │                                                      │               │
│  │  Result: ~50-200 candidates per market               │               │
│  └──────────────────────────┬───────────────────────────┘               │
│                             │                                           │
│                             ▼                                           │
│  ┌──────────────────────────────────────────────────────┐               │
│  │              STAGE 2: ENTITY EXTRACTION              │               │
│  │                    (Per Candidate Pair)              │               │
│  ├──────────────────────────────────────────────────────┤               │
│  │                                                      │               │
│  │  Universal Entity Extractor:                         │               │
│  │  ┌─────────────────────────────────────────────────┐ │               │
│  │  │ • Teams/Players: ["Vitality", "Falcons"]        │ │               │
│  │  │ • People: ["Biden", "Trump"]                    │ │               │
│  │  │ • Numbers: [{value: 100000, unit: "USD"}]       │ │               │
│  │  │ • Dates: [2026-01-24]                           │ │               │
│  │  │ • Comparators: [ABOVE, BELOW, WIN, BETWEEN]     │ │               │
│  │  │ • GameType: ["CS2", "NBA", "election"]          │ │               │
│  │  │ • Metrics: ["CPI", "GDP", "unemployment"]       │ │               │
│  │  └─────────────────────────────────────────────────┘ │               │
│  └──────────────────────────┬───────────────────────────┘               │
│                             │                                           │
│                             ▼                                           │
│  ┌──────────────────────────────────────────────────────┐               │
│  │              STAGE 3: UNIVERSAL SCORING              │               │
│  │                    (Weighted Components)             │               │
│  ├──────────────────────────────────────────────────────┤               │
│  │                                                      │               │
│  │  Score Components:                                   │               │
│  │  ┌─────────────────────────────────────────────────┐ │               │
│  │  │ Entity Overlap      0.40  (teams, people, etc)  │ │               │
│  │  │ Number Match        0.20  (prices, lines, %)    │ │               │
│  │  │ Time Proximity      0.20  (closeTime distance)  │ │               │
│  │  │ Text Similarity     0.15  (Jaccard on tokens)   │ │               │
│  │  │ Category Boost      0.05  (same derivedTopic)   │ │               │
│  │  └─────────────────────────────────────────────────┘ │               │
│  │                                                      │               │
│  │  Final Score = Σ(component × weight)                 │               │
│  └──────────────────────────┬───────────────────────────┘               │
│                             │                                           │
│                             ▼                                           │
│  ┌──────────────────────────────────────────────────────┐               │
│  │              STAGE 4: DECISION & OUTPUT              │               │
│  ├──────────────────────────────────────────────────────┤               │
│  │                                                      │               │
│  │  Score ≥ 0.95  →  AUTO-CONFIRM (high confidence)     │               │
│  │  Score 0.50-0.95  →  SUGGESTED (needs review)        │               │
│  │  Score < 0.50  →  SKIP (not a match)                 │               │
│  │                                                      │               │
│  │  Output includes:                                    │               │
│  │  • score: 0.87                                       │               │
│  │  • breakdown: {entity: 0.35, number: 0.18, ...}      │               │
│  │  • reason: "Teams match: Vitality, Falcons; ..."     │               │
│  │  • matched_entities: ["Vitality", "Falcons"]         │               │
│  └──────────────────────────────────────────────────────┘               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Детальный дизайн компонентов

### 1. Universal Entity Extractor

**Файл**: `packages/core/src/universalExtractor.ts`

```typescript
interface UniversalEntities {
  // Участники
  teams: string[];           // ["Vitality", "Team Falcons", "Lakers"]
  people: string[];          // ["Biden", "Trump", "LeBron James"]
  organizations: string[];   // ["FED", "ECB", "UFC"]

  // Числа и значения
  numbers: NumberEntity[];   // [{value: 100000, unit: "USD", context: "price"}]
  percentages: number[];     // [2.5, 3.0]
  lines: LineValue[];        // [{type: "spread", value: -3.5}]

  // Время
  dates: ExtractedDate[];    // [{year: 2026, month: 1, day: 24}]
  periods: Period[];         // ["Q1 2026", "January 2026"]

  // Контекст
  gameType: string | null;   // "CS2", "NBA", "NFL", "soccer", "election"
  marketType: string | null; // "winner", "spread", "total", "price_above"
  comparator: Comparator;    // ABOVE, BELOW, BETWEEN, WIN, EXACT

  // Метаданные
  confidence: number;        // 0-1, based on extraction quality
  rawTitle: string;
  normalizedTitle: string;
  tokens: string[];
}

interface NumberEntity {
  value: number;
  unit: string | null;       // "USD", "bps", "points", "%"
  context: string | null;    // "price", "spread", "total", "rate"
  raw: string;               // Original text: "$100K", "3.5 points"
}
```

**Extraction pipeline**:

```typescript
function extractUniversalEntities(
  title: string,
  metadata?: MarketMetadata
): UniversalEntities {
  const normalized = normalizeTitle(title);
  const tokens = tokenize(normalized);

  return {
    // 1. Named entities (teams, people, orgs)
    teams: extractTeams(title, metadata),
    people: extractPeople(title),
    organizations: extractOrganizations(title),

    // 2. Numeric values
    numbers: extractNumbers(title),
    percentages: extractPercentages(title),
    lines: extractLines(title),

    // 3. Temporal
    dates: extractDates(title, metadata?.closeTime),
    periods: extractPeriods(title),

    // 4. Context
    gameType: detectGameType(title, metadata),
    marketType: detectMarketType(title),
    comparator: detectComparator(title),

    // 5. Meta
    confidence: calculateConfidence(...),
    rawTitle: title,
    normalizedTitle: normalized,
    tokens,
  };
}
```

### 2. Candidate Generator

**Файл**: `services/worker/src/matching/universalCandidateGenerator.ts`

```typescript
interface CandidateGeneratorOptions {
  timeWindowHours: number;      // Default: 48
  minWordOverlap: number;       // Default: 0.20 (20%)
  minEntityOverlap: number;     // Default: 1 entity
  maxCandidatesPerMarket: number; // Default: 100
}

async function generateCandidates(
  sourceMarket: Market,
  targetMarkets: Market[],
  options: CandidateGeneratorOptions
): Promise<CandidatePair[]> {
  const candidates: CandidatePair[] = [];
  const sourceEntities = extractUniversalEntities(sourceMarket.title);

  for (const target of targetMarkets) {
    // Fast filters (any one passes → candidate)
    const passesTimeFilter = isWithinTimeWindow(
      sourceMarket.closeTime,
      target.closeTime,
      options.timeWindowHours
    );

    const passesWordFilter = calculateWordOverlap(
      sourceEntities.tokens,
      tokenize(target.title)
    ) >= options.minWordOverlap;

    const targetEntities = extractUniversalEntities(target.title);
    const passesEntityFilter = countEntityOverlap(
      sourceEntities,
      targetEntities
    ) >= options.minEntityOverlap;

    if (passesTimeFilter || passesWordFilter || passesEntityFilter) {
      candidates.push({
        source: sourceMarket,
        target: target,
        sourceEntities,
        targetEntities,
        filtersPassed: { time: passesTimeFilter, word: passesWordFilter, entity: passesEntityFilter }
      });
    }
  }

  // Sort by potential (entity overlap) and cap
  return candidates
    .sort((a, b) => countEntityOverlap(b) - countEntityOverlap(a))
    .slice(0, options.maxCandidatesPerMarket);
}
```

### 3. Universal Scorer

**Файл**: `services/worker/src/matching/universalScorer.ts`

```typescript
const UNIVERSAL_WEIGHTS = {
  entityOverlap: 0.40,    // Teams, people, orgs match
  numberMatch: 0.20,      // Prices, lines, percentages
  timeProximity: 0.20,    // CloseTime distance
  textSimilarity: 0.15,   // Jaccard on tokens
  categoryBoost: 0.05,    // Same derivedTopic
};

interface UniversalScoreResult {
  score: number;
  breakdown: {
    entityOverlap: number;
    numberMatch: number;
    timeProximity: number;
    textSimilarity: number;
    categoryBoost: number;
  };
  reason: string;
  matchedEntities: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

function scoreUniversal(
  left: MarketWithEntities,
  right: MarketWithEntities
): UniversalScoreResult {
  const le = left.entities;
  const re = right.entities;

  // 1. Entity Overlap (0.40)
  const teamOverlap = jaccardSets(le.teams, re.teams);
  const peopleOverlap = jaccardSets(le.people, re.people);
  const orgOverlap = jaccardSets(le.organizations, re.organizations);
  const entityScore = Math.max(teamOverlap, peopleOverlap, orgOverlap);

  // 2. Number Match (0.20)
  const numberScore = scoreNumberMatch(le.numbers, re.numbers);

  // 3. Time Proximity (0.20)
  const timeScore = scoreTimeProximity(left.closeTime, right.closeTime);

  // 4. Text Similarity (0.15)
  const textScore = jaccard(le.tokens, re.tokens);

  // 5. Category Boost (0.05)
  const categoryScore = left.derivedTopic === right.derivedTopic ? 1.0 : 0.0;

  // Weighted sum
  const score =
    UNIVERSAL_WEIGHTS.entityOverlap * entityScore +
    UNIVERSAL_WEIGHTS.numberMatch * numberScore +
    UNIVERSAL_WEIGHTS.timeProximity * timeScore +
    UNIVERSAL_WEIGHTS.textSimilarity * textScore +
    UNIVERSAL_WEIGHTS.categoryBoost * categoryScore;

  // Build explanation
  const matchedEntities = findMatchedEntities(le, re);
  const reason = buildReason(matchedEntities, score, { entityScore, numberScore, timeScore });

  return {
    score: clamp(score, 0, 1),
    breakdown: {
      entityOverlap: entityScore,
      numberMatch: numberScore,
      timeProximity: timeScore,
      textSimilarity: textScore,
      categoryBoost: categoryScore,
    },
    reason,
    matchedEntities,
    confidence: score >= 0.85 ? 'HIGH' : score >= 0.65 ? 'MEDIUM' : 'LOW',
  };
}
```

### 4. Entity Matchers (детальные правила)

#### Team/Player Matching

```typescript
// Aliases для нормализации
const TEAM_ALIASES: Record<string, string[]> = {
  'VITALITY': ['vitality', 'team vitality', 'vit'],
  'TEAM_FALCONS': ['falcons', 'team falcons', 'fal'],
  'LAKERS': ['lakers', 'los angeles lakers', 'la lakers', 'lal'],
  'CELTICS': ['celtics', 'boston celtics', 'boston', 'bos'],
  // ... 500+ teams across all sports/esports
};

function normalizeTeam(team: string): string {
  const lower = team.toLowerCase().trim();
  for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
    if (aliases.includes(lower)) return canonical;
  }
  return lower; // Unknown team, keep as-is
}

function teamsMatch(teamsA: string[], teamsB: string[]): number {
  const normA = new Set(teamsA.map(normalizeTeam));
  const normB = new Set(teamsB.map(normalizeTeam));
  return jaccardSets(normA, normB);
}
```

#### Number Matching

```typescript
function scoreNumberMatch(
  numbersA: NumberEntity[],
  numbersB: NumberEntity[]
): number {
  if (numbersA.length === 0 && numbersB.length === 0) return 0.5; // Neutral
  if (numbersA.length === 0 || numbersB.length === 0) return 0.0;

  // Find best matching pair
  let bestScore = 0;
  for (const a of numbersA) {
    for (const b of numbersB) {
      if (a.context !== b.context && a.context && b.context) continue;

      const diff = Math.abs(a.value - b.value);
      const maxVal = Math.max(a.value, b.value);
      const relDiff = diff / maxVal;

      // Score based on relative difference
      let score = 0;
      if (relDiff === 0) score = 1.0;           // Exact match
      else if (relDiff <= 0.01) score = 0.95;   // Within 1%
      else if (relDiff <= 0.05) score = 0.80;   // Within 5%
      else if (relDiff <= 0.10) score = 0.60;   // Within 10%
      else score = 0.0;

      bestScore = Math.max(bestScore, score);
    }
  }

  return bestScore;
}
```

### 5. Auto-Confirm Rules

```typescript
interface AutoConfirmConfig {
  minScore: number;                    // 0.95
  requireEntityMatch: boolean;         // true
  requireTimeMatch: boolean;           // true (within 24h)
  minTextSanity: number;              // 0.10
}

function shouldAutoConfirm(
  scoreResult: UniversalScoreResult,
  config: AutoConfirmConfig = DEFAULT_CONFIG
): { confirm: boolean; rule: string; confidence: number } {

  // Rule 1: High score + entity match
  if (
    scoreResult.score >= config.minScore &&
    scoreResult.matchedEntities.length >= 1 &&
    scoreResult.breakdown.textSimilarity >= config.minTextSanity
  ) {
    return {
      confirm: true,
      rule: 'UNIVERSAL_HIGH_CONFIDENCE',
      confidence: scoreResult.score,
    };
  }

  // Rule 2: Very high entity overlap (teams exact match)
  if (
    scoreResult.breakdown.entityOverlap >= 0.95 &&
    scoreResult.breakdown.timeProximity >= 0.70
  ) {
    return {
      confirm: true,
      rule: 'UNIVERSAL_ENTITY_EXACT',
      confidence: scoreResult.score,
    };
  }

  return { confirm: false, rule: '', confidence: 0 };
}
```

---

## Implementation Plan

### Phase 1: Entity Extraction Layer (2-3 дня)

**Задачи**:
1. Создать `packages/core/src/universalExtractor.ts`
2. Реализовать extractors:
   - Teams (esports + traditional sports)
   - People (politicians, athletes)
   - Numbers (prices, spreads, totals)
   - Dates (multiple formats)
   - Game types detection
3. Написать тесты (50+ test cases)

**Файлы**:
```
packages/core/src/
├── universalExtractor.ts       # Main entry point
├── extractors/
│   ├── teamExtractor.ts        # Sports/esports teams
│   ├── personExtractor.ts      # Named people
│   ├── numberExtractor.ts      # Prices, lines, percentages
│   ├── dateExtractor.ts        # Dates and periods
│   └── contextExtractor.ts     # Game type, market type
├── aliases/
│   ├── teams.ts                # 500+ team aliases
│   ├── people.ts               # Politicians, athletes
│   └── organizations.ts        # FED, ECB, leagues
└── universalExtractor.test.ts  # Tests
```

### Phase 2: Candidate Generator (1-2 дня)

**Задачи**:
1. Создать `universalCandidateGenerator.ts`
2. Реализовать fast filters (time, word, entity)
3. Добавить индексы в БД для ускорения
4. Тесты производительности

**Файлы**:
```
services/worker/src/matching/
├── universalCandidateGenerator.ts
└── universalCandidateGenerator.test.ts
```

### Phase 3: Universal Scorer (2-3 дня)

**Задачи**:
1. Создать `universalScorer.ts`
2. Реализовать scoring components
3. Реализовать reason builder
4. Написать тесты scoring logic

**Файлы**:
```
services/worker/src/matching/
├── universalScorer.ts
├── scoringUtils.ts
└── universalScorer.test.ts
```

### Phase 4: Universal Pipeline Integration (1-2 дня)

**Задачи**:
1. Создать `universalPipeline.ts` implementing `TopicPipeline`
2. Интегрировать с `engineV3.ts`
3. Добавить CLI команду `v3:suggest-matches --universal`
4. Добавить auto-confirm/reject rules

**Файлы**:
```
services/worker/src/matching/pipelines/
├── universalPipeline.ts
└── universalPipeline.test.ts

services/worker/src/commands/
└── v3-suggest-matches.ts  # Add --universal flag
```

### Phase 5: Testing & Tuning (2 дня)

**Задачи**:
1. Запустить на production данных (dry-run)
2. Сравнить с существующими pipelines
3. Tune weights и thresholds
4. Документация

**Метрики успеха**:
- Recall: ≥ 80% (из ground truth set)
- Precision: ≥ 70% на auto-confirm
- Latency: < 5 min для full scan

---

## Migration Strategy

### Этап 1: Параллельный запуск
```
v3:suggest-matches --topic CRYPTO_DAILY  # Existing
v3:suggest-matches --universal           # New (dry-run)
```
Сравниваем результаты, не пишем в БД.

### Этап 2: Gap filling
```
v3:suggest-matches --universal --only-missing
```
Только для markets без existing links.

### Этап 3: Full replacement
После validation заменяем topic pipelines на universal.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| False positives | Low trust | Strict auto-confirm (≥0.95), review queue |
| Performance | Slow matching | Candidate pre-filtering, batch processing |
| Missing entities | Low recall | Extensive alias dictionaries |
| Number format edge cases | Wrong matches | Comprehensive number parser tests |

---

## Success Criteria

1. **Coverage**: Links exist for ≥80% of matching market pairs
2. **Categories**: Works for ALL categories (esports, soccer, tennis, etc.)
3. **Auto-confirm rate**: ≥60% of valid matches auto-confirmed
4. **False positive rate**: <5% of auto-confirmed are wrong
5. **Explainability**: Every match has human-readable reason

---

## Appendix: Entity Aliases (Sample)

### Esports Teams
```typescript
TEAM_ALIASES = {
  'VITALITY': ['vitality', 'team vitality', 'vit', 't.vitality'],
  'TEAM_FALCONS': ['falcons', 'team falcons', 'fal', 't.falcons'],
  'G2_ESPORTS': ['g2', 'g2 esports', 'g2.esports'],
  'FNATIC': ['fnatic', 'fnc'],
  'CLOUD9': ['cloud9', 'c9'],
  'NAVI': ['navi', 'natus vincere', 'na\'vi'],
  // ... 100+ esports teams
};
```

### Sports Teams
```typescript
TEAM_ALIASES = {
  'LAKERS': ['lakers', 'los angeles lakers', 'la lakers', 'lal'],
  'CELTICS': ['celtics', 'boston celtics', 'boston', 'bos'],
  'CHIEFS': ['chiefs', 'kansas city chiefs', 'kc chiefs', 'kc'],
  'EAGLES': ['eagles', 'philadelphia eagles', 'philly', 'phi'],
  // ... 400+ traditional sports teams
};
```

### Politicians
```typescript
PERSON_ALIASES = {
  'BIDEN': ['biden', 'joe biden', 'president biden', 'joseph biden'],
  'TRUMP': ['trump', 'donald trump', 'donald j trump', 'djt'],
  'HARRIS': ['harris', 'kamala harris', 'kamala', 'vp harris'],
  // ... 100+ politicians
};
```

import { getClient, type Venue, type MarketStatus, type OutcomeSide } from '@data-module/db';

export interface SeedOptions {
  markets?: number;
  outcomesPerMarket?: number;
  quoteDurationMinutes?: number;
  quoteIntervalSeconds?: number;
}

/**
 * Generate seed data for testing without external APIs
 */
export async function runSeed(options: SeedOptions = {}): Promise<void> {
  const {
    markets = 10,
    outcomesPerMarket = 2,
    quoteDurationMinutes = 5,
    quoteIntervalSeconds = 10,
  } = options;

  const prisma = getClient();

  console.log(`Seeding ${markets} markets with ${outcomesPerMarket} outcomes each...`);

  // Categories for variety
  const categories = ['Politics', 'Sports', 'Crypto', 'Entertainment', 'Science', 'Economics'];

  // Generate markets
  const now = new Date();
  const marketData: Array<{
    venue: Venue;
    externalId: string;
    title: string;
    category: string;
    status: MarketStatus;
    closeTime: Date;
    metadata: object;
  }> = [];

  for (let i = 0; i < markets; i++) {
    const category = categories[i % categories.length];
    const closeTime = new Date(now.getTime() + (i + 1) * 24 * 60 * 60 * 1000); // 1-N days from now

    marketData.push({
      venue: 'polymarket', // Seed as polymarket venue
      externalId: `seed-market-${i + 1}`,
      title: `Seed Market ${i + 1}: Will ${category} event ${i + 1} happen?`,
      category,
      status: 'active',
      closeTime,
      metadata: {
        seeded: true,
        createdAt: now.toISOString(),
      },
    });
  }

  // Create markets with outcomes
  const createdMarkets = await prisma.$transaction(async (tx) => {
    const results = [];

    for (const market of marketData) {
      // Check if already exists
      const existing = await tx.market.findUnique({
        where: {
          venue_externalId: {
            venue: market.venue,
            externalId: market.externalId,
          },
        },
      });

      if (existing) {
        console.log(`Market ${market.externalId} already exists, skipping...`);
        results.push(existing);
        continue;
      }

      const outcomes: Array<{
        name: string;
        side: OutcomeSide;
        externalId: string;
        metadata: object;
      }> = [];

      for (let j = 0; j < outcomesPerMarket; j++) {
        const side: OutcomeSide = j === 0 ? 'yes' : j === 1 ? 'no' : 'other';
        const name = j === 0 ? 'Yes' : j === 1 ? 'No' : `Option ${j + 1}`;

        outcomes.push({
          name,
          side,
          externalId: `${market.externalId}-outcome-${j + 1}`,
          metadata: {},
        });
      }

      const created = await tx.market.create({
        data: {
          ...market,
          outcomes: {
            create: outcomes,
          },
        },
        include: { outcomes: true },
      });

      results.push(created);
    }

    return results;
  });

  console.log(`Created/found ${createdMarkets.length} markets`);

  // Generate quotes with random walk
  console.log(`Generating quotes for ${quoteDurationMinutes} minutes...`);

  const quoteCount = Math.floor((quoteDurationMinutes * 60) / quoteIntervalSeconds);
  const startTime = new Date(now.getTime() - quoteDurationMinutes * 60 * 1000);

  let totalQuotes = 0;

  for (const market of createdMarkets) {
    const marketWithOutcomes = await prisma.market.findUnique({
      where: { id: market.id },
      include: { outcomes: true },
    });

    if (!marketWithOutcomes) continue;

    // Generate quotes for each outcome
    for (const outcome of marketWithOutcomes.outcomes) {
      // Start with random price between 0.2 and 0.8
      let price = 0.2 + Math.random() * 0.6;

      const quotes: Array<{
        outcomeId: number;
        ts: Date;
        price: number;
        impliedProb: number;
        liquidity: number;
        volume: number;
      }> = [];

      for (let q = 0; q < quoteCount; q++) {
        const ts = new Date(startTime.getTime() + q * quoteIntervalSeconds * 1000);

        // Random walk: price changes by -0.05 to +0.05
        const change = (Math.random() - 0.5) * 0.1;
        price = Math.max(0.01, Math.min(0.99, price + change));

        quotes.push({
          outcomeId: outcome.id,
          ts,
          price,
          impliedProb: price,
          liquidity: 1000 + Math.random() * 9000,
          volume: 100 + Math.random() * 900,
        });
      }

      // Batch insert quotes
      await prisma.quote.createMany({ data: quotes });
      totalQuotes += quotes.length;

      // Update latest quote
      const lastQuote = quotes[quotes.length - 1];
      await prisma.latestQuote.upsert({
        where: { outcomeId: outcome.id },
        create: {
          outcomeId: outcome.id,
          ts: lastQuote.ts,
          price: lastQuote.price,
          impliedProb: lastQuote.impliedProb,
          liquidity: lastQuote.liquidity,
          volume: lastQuote.volume,
        },
        update: {
          ts: lastQuote.ts,
          price: lastQuote.price,
          impliedProb: lastQuote.impliedProb,
          liquidity: lastQuote.liquidity,
          volume: lastQuote.volume,
        },
      });
    }
  }

  console.log(`Generated ${totalQuotes} quotes`);
  console.log('Seed completed!');
}

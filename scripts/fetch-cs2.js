const { PrismaClient } = require("/app/packages/db/dist");

async function fetchCS2Markets() {
  const prisma = new PrismaClient();

  try {
    console.log("Fetching CS2GAME markets from Kalshi API...");
    const url = "https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXCS2GAME&limit=200";
    const response = await fetch(url);
    const data = await response.json();

    console.log(`Fetched ${data.markets.length} CS2GAME markets from API`);

    let created = 0;
    let updated = 0;

    for (const m of data.markets) {
      try {
        const market = await prisma.market.upsert({
          where: { venue_externalId: { venue: "kalshi", externalId: m.ticker } },
          create: {
            externalId: m.ticker,
            venue: "kalshi",
            title: m.title,
            category: "esports",
            status: m.status === "open" ? "active" : m.status,
            closeTime: m.close_time ? new Date(m.close_time) : null,
            sourceUpdatedAt: new Date(),
            metadata: {
              eventTicker: m.event_ticker,
              seriesTicker: "KXCS2GAME",
              subtitle: m.subtitle,
              marketType: m.market_type,
              mveCollectionTicker: null,
              mveSelectedLegs: null,
            },
            outcomes: {
              create: [
                { externalId: m.ticker + "-YES", name: "Yes", side: "yes" },
                { externalId: m.ticker + "-NO", name: "No", side: "no" },
              ]
            }
          },
          update: {
            title: m.title,
            status: m.status === "open" ? "active" : m.status,
            closeTime: m.close_time ? new Date(m.close_time) : null,
            sourceUpdatedAt: new Date(),
            metadata: {
              eventTicker: m.event_ticker,
              seriesTicker: "KXCS2GAME",
              subtitle: m.subtitle,
              marketType: m.market_type,
              mveCollectionTicker: null,
              mveSelectedLegs: null,
            },
          },
        });

        // Check if created in last 5 seconds
        const isNew = market.createdAt.getTime() >= Date.now() - 5000;
        if (isNew) created++;
        else updated++;
      } catch (err) {
        if (err.code === "P2002") {
          updated++;
        } else {
          console.error("Error for " + m.ticker + ":", err.message);
        }
      }
    }

    console.log("Created: " + created + ", Updated: " + updated);

    // Verify Jan 24 markets
    const jan24 = await prisma.market.count({
      where: { venue: "kalshi", externalId: { startsWith: "KXCS2GAME-26JAN24" } }
    });
    console.log("KXCS2GAME-26JAN24 count: " + jan24);

    // Check FALVIT specifically
    const falvit = await prisma.market.findMany({
      where: { venue: "kalshi", externalId: { contains: "FALVIT" } },
      select: { externalId: true, title: true }
    });
    console.log("FALVIT markets: " + falvit.length);
    for (const m of falvit) {
      console.log("  " + m.externalId + ": " + m.title);
    }

  } finally {
    await prisma.$disconnect();
  }
}

fetchCS2Markets().catch(console.error);

/**
 * LLM Link Validator (v3.1.0)
 *
 * Uses local LLM (Ollama) to validate market link suggestions.
 * Confirms links where LLM says YES and score is high enough.
 */

import { getClient, type LinkStatus } from '@data-module/db';
import { ProxyAgent } from 'undici';

export interface LLMValidateOptions {
  minScore?: number;           // Minimum score to validate (default: 0.75)
  limit?: number;              // Max links to process (default: 100)
  batchSize?: number;          // Links to process in parallel (default: 5)
  batchDelayMs?: number;       // Delay between batches in ms (default: 500 for ollama, 3000 for openai)
  provider?: 'ollama' | 'openai';  // LLM provider (default: ollama)
  ollamaUrl?: string;          // Ollama API URL (default: http://localhost:11434)
  openaiApiKey?: string;       // OpenAI API key (default: from OPENAI_API_KEY env)
  proxyUrl?: string;           // HTTP/HTTPS proxy URL (e.g., http://199.217.98.13:8888)
  model?: string;              // Model name (default: llama3.2:3b for ollama, gpt-4o-mini for openai)
  dryRun?: boolean;            // Preview without confirming (default: true)
  apply?: boolean;             // Actually confirm links (default: false)
  topic?: string;              // Filter by topic (default: all except 'all')
}

interface LLMValidateResult {
  processed: number;
  confirmed: number;
  rejected: number;
  errors: number;
  avgConfidence: number;
}

interface ValidationDecision {
  linkId: number;
  decision: 'YES' | 'NO' | 'UNCERTAIN';
  confidence: number;
  reasoning?: string;
}

/**
 * Call OpenAI API to validate a market pair
 */
async function validateWithOpenAI(
  leftTitle: string,
  rightTitle: string,
  apiKey: string,
  model: string,
  proxyUrl?: string
): Promise<ValidationDecision | null> {
  const prompt = `You are a prediction market matching expert. Your task is to determine if two market titles from different platforms are asking about the EXACT SAME EVENT.

Rules:
- Markets must have the SAME outcome condition (e.g., both asking "will X happen by date Y?")
- Minor wording differences are OK if the underlying event is identical
- Different price targets, dates, or conditions mean DIFFERENT events

Examples:

Market A: "Bitcoin above $100,000 on January 31?"
Market B: "Will Bitcoin price be above $100k by end of January 2025?"
Answer: YES (same asset, same target, same timeframe)

Market A: "Will Trump win 2024 election?"
Market B: "Will Biden win 2024 election?"
Answer: NO (different candidates = different outcomes)

Market A: "S&P 500 above 5000 by March 1?"
Market B: "S&P 500 above 5500 by March 1?"
Answer: NO (different price targets = different events)

Market A: "Will Russia invade Ukraine by end of 2024?"
Market B: "Will there be peace in Ukraine by end of 2024?"
Answer: NO (opposite outcomes)

Now evaluate these markets:

Market A (Polymarket): "${leftTitle}"
Market B (Kalshi): "${rightTitle}"

Answer with ONLY ONE WORD: YES, NO, or UNCERTAIN`;

  try {
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a prediction market matching expert. Answer with only YES, NO, or UNCERTAIN.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 10,
      }),
      // @ts-ignore - dispatcher is not in standard fetch types but works in Node.js with undici
      dispatcher,
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`OpenAI API error: ${response.status} ${error}`);
      return null;
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    const answer = data.choices[0]?.message?.content?.trim().toUpperCase() || '';

    // Parse answer
    let decision: 'YES' | 'NO' | 'UNCERTAIN' = 'UNCERTAIN';
    if (answer.includes('YES')) {
      decision = 'YES';
    } else if (answer.includes('NO')) {
      decision = 'NO';
    }

    return {
      linkId: 0,
      decision,
      confidence: 0.95, // OpenAI is more reliable
      reasoning: answer,
    };
  } catch (error) {
    console.error(`OpenAI validation error: ${error}`);
    return null;
  }
}

/**
 * Call Ollama API to validate a market pair
 */
async function validateWithLLM(
  leftTitle: string,
  rightTitle: string,
  ollamaUrl: string,
  model: string
): Promise<ValidationDecision | null> {
  const prompt = `You are a prediction market matching expert. Your task is to determine if two market titles from different platforms are asking about the EXACT SAME EVENT.

Rules:
- Markets must have the SAME outcome condition (e.g., both asking "will X happen by date Y?")
- Minor wording differences are OK if the underlying event is identical
- Different price targets, dates, or conditions mean DIFFERENT events

Examples:

Market A: "Bitcoin above $100,000 on January 31?"
Market B: "Will Bitcoin price be above $100k by end of January 2025?"
Answer: YES (same asset, same target, same timeframe)

Market A: "Will Trump win 2024 election?"
Market B: "Will Biden win 2024 election?"
Answer: NO (different candidates = different outcomes)

Market A: "S&P 500 above 5000 by March 1?"
Market B: "S&P 500 above 5500 by March 1?"
Answer: NO (different price targets = different events)

Market A: "Will Russia invade Ukraine by end of 2024?"
Market B: "Will there be peace in Ukraine by end of 2024?"
Answer: NO (opposite outcomes)

Now evaluate these markets:

Market A (Polymarket): "${leftTitle}"
Market B (Kalshi): "${rightTitle}"

Think step by step, then answer with ONLY ONE WORD:
- YES if they are clearly the same event
- NO if they are different events
- UNCERTAIN if you cannot determine

Answer:`;

  try {
    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: 0.1,  // Low temperature for consistent answers
          num_predict: 100,  // Allow reasoning before answer
        },
      }),
    });

    if (!response.ok) {
      console.error(`Ollama API error: ${response.status}`);
      return null;
    }

    const data = await response.json() as { response: string };
    const answer = data.response.trim().toUpperCase();

    // Parse answer
    let decision: 'YES' | 'NO' | 'UNCERTAIN' = 'UNCERTAIN';
    if (answer.includes('YES')) {
      decision = 'YES';
    } else if (answer.includes('NO')) {
      decision = 'NO';
    }

    // Confidence based on answer clarity
    const confidence = answer.length < 20 ? 0.9 : 0.7;

    return {
      linkId: 0, // Will be set by caller
      decision,
      confidence,
      reasoning: data.response,
    };
  } catch (error) {
    console.error(`LLM validation error: ${error}`);
    return null;
  }
}

/**
 * Run LLM validation on suggested links
 */
export async function runLLMValidate(options: LLMValidateOptions): Promise<LLMValidateResult> {
  const {
    minScore = 0.75,
    limit = 100,
    batchSize = 5,
    batchDelayMs,
    provider = 'ollama',
    ollamaUrl = 'http://localhost:11434',
    openaiApiKey = process.env.OPENAI_API_KEY,
    proxyUrl,
    model,
    dryRun = true,
    apply = false,
    topic,
  } = options;

  // Default models based on provider
  const defaultModel = provider === 'openai' ? 'gpt-4o-mini' : 'llama3.2:3b';
  const finalModel = model || defaultModel;

  // Default batch delay based on provider (OpenAI needs more delay for rate limits)
  const finalBatchDelay = batchDelayMs ?? (provider === 'openai' ? 3000 : 500);

  const effectiveDryRun = !apply || dryRun;

  console.log('\\n============================================================');
  console.log('[llm-validate] LLM Link Validator (v3.1.0)');
  console.log('============================================================');
  console.log(`Provider: ${provider.toUpperCase()}`);
  console.log(`Model: ${finalModel}`);
  if (provider === 'openai') {
    console.log(`API Key: ${openaiApiKey ? '***' + openaiApiKey.slice(-4) : 'NOT SET'}`);
    if (proxyUrl) {
      console.log(`Proxy: ${proxyUrl}`);
    }
  } else {
    console.log(`Ollama URL: ${ollamaUrl}`);
  }
  console.log(`Min Score: ${minScore}`);
  console.log(`Limit: ${limit}`);
  console.log(`Batch Size: ${batchSize}`);
  console.log(`Batch Delay: ${finalBatchDelay}ms`);
  console.log(`Topic: ${topic || 'all (excluding topic=all)'}`);
  console.log(`Mode: ${effectiveDryRun ? 'DRY RUN' : '⚠️  APPLY (will confirm)'}`);
  console.log();

  // Test connection
  if (provider === 'openai') {
    if (!openaiApiKey) {
      console.error(`❌ OpenAI API key not found`);
      console.error('   Set OPENAI_API_KEY environment variable or use --openai-api-key');
      process.exit(1);
    }
    console.log(`✓ Using OpenAI API with model ${finalModel}\\n`);
  } else {
    try {
      const testResponse = await fetch(`${ollamaUrl}/api/tags`);
      if (!testResponse.ok) {
        console.error(`❌ Cannot connect to Ollama at ${ollamaUrl}`);
        console.error('   Make sure Ollama is running: ollama serve');
        process.exit(1);
      }
      const tags = await testResponse.json() as { models?: Array<{ name: string }> };
      const hasModel = tags.models?.some((m) => m.name.startsWith(finalModel));
      if (!hasModel) {
        console.error(`❌ Model ${finalModel} not found`);
        console.error(`   Available models: ${tags.models?.map((m) => m.name).join(', ')}`);
        console.error(`   Download it: ollama pull ${finalModel}`);
        process.exit(1);
      }
      console.log(`✓ Connected to Ollama, model ${finalModel} available\\n`);
    } catch (error) {
      console.error(`❌ Failed to connect to Ollama: ${error}`);
      process.exit(1);
    }
  }

  const prisma = getClient();

  // Fetch suggested links
  const whereClause: any = {
    status: 'suggested' as LinkStatus,
    score: { gte: minScore },
  };

  if (topic) {
    whereClause.topic = topic;
  } else {
    // Exclude old links with topic='all'
    whereClause.topic = { not: 'all' };
  }

  const links = await prisma.marketLink.findMany({
    where: whereClause,
    take: limit,
    orderBy: { score: 'desc' },
    include: {
      leftMarket: true,
      rightMarket: true,
    },
  });

  console.log(`Fetched ${links.length} suggested links (score >= ${minScore})\\n`);

  if (links.length === 0) {
    console.log('No links to validate.');
    return {
      processed: 0,
      confirmed: 0,
      rejected: 0,
      errors: 0,
      avgConfidence: 0,
    };
  }

  // Process in batches
  let processed = 0;
  let confirmed = 0;
  let rejected = 0;
  let errors = 0;
  let totalConfidence = 0;

  for (let i = 0; i < links.length; i += batchSize) {
    const batch = links.slice(i, Math.min(i + batchSize, links.length));

    // Process batch in parallel
    const decisions = await Promise.all(
      batch.map(async (link) => {
        const decision = provider === 'openai'
          ? await validateWithOpenAI(
              link.leftMarket.title,
              link.rightMarket.title,
              openaiApiKey!,
              finalModel,
              proxyUrl
            )
          : await validateWithLLM(
              link.leftMarket.title,
              link.rightMarket.title,
              ollamaUrl,
              finalModel
            );

        if (!decision) {
          errors++;
          return null;
        }

        return {
          ...decision,
          linkId: link.id,
          score: link.score,
          topic: link.topic,
        };
      })
    );

    // Log and confirm
    for (const decision of decisions) {
      if (!decision) continue;

      processed++;
      totalConfidence += decision.confidence;

      const status = decision.decision === 'YES' ? '✓' : decision.decision === 'NO' ? '✗' : '?';
      const scoreStr = decision.score.toFixed(3);

      console.log(
        `${status} Link ${decision.linkId} [${decision.topic}] score=${scoreStr} ` +
        `LLM=${decision.decision} conf=${decision.confidence.toFixed(2)}`
      );

      if (decision.decision === 'YES') {
        confirmed++;

        if (!effectiveDryRun) {
          await prisma.marketLink.update({
            where: { id: decision.linkId },
            data: {
              status: 'confirmed',
              reason: `llm_validate@3.1.0:${provider}:${finalModel}:${decision.confidence.toFixed(2)}`,
            },
          });
        }
      } else if (decision.decision === 'NO') {
        rejected++;
      }
    }

    // Progress
    console.log(`Progress: ${Math.min(i + batchSize, links.length)}/${links.length}\\n`);

    // Rate limiting (prevent hitting API rate limits)
    await new Promise((r) => setTimeout(r, finalBatchDelay));
  }

  // Summary
  console.log('============================================================');
  console.log('[Summary]');
  console.log('============================================================');
  console.log(`Processed:      ${processed}`);
  console.log(`Confirmed:      ${confirmed} (${((confirmed / processed) * 100).toFixed(1)}%)`);
  console.log(`Rejected:       ${rejected} (${((rejected / processed) * 100).toFixed(1)}%)`);
  console.log(`Uncertain:      ${processed - confirmed - rejected}`);
  console.log(`Errors:         ${errors}`);
  console.log(`Avg Confidence: ${(totalConfidence / processed).toFixed(2)}`);

  if (effectiveDryRun) {
    console.log('\\n[DRY RUN] No changes made. Use --apply to confirm links.');
  } else {
    console.log(`\\n[APPLIED] Confirmed ${confirmed} links.`);
  }

  return {
    processed,
    confirmed,
    rejected,
    errors,
    avgConfidence: totalConfidence / processed,
  };
}

/**
 * LLM Link Validator (v3.1.0)
 *
 * Uses local LLM (Ollama) to validate market link suggestions.
 * Confirms links where LLM says YES and score is high enough.
 */

import { getClient, type LinkStatus } from '@data-module/db';

export interface LLMValidateOptions {
  minScore?: number;           // Minimum score to validate (default: 0.75)
  limit?: number;              // Max links to process (default: 100)
  batchSize?: number;          // Links to process in parallel (default: 5)
  ollamaUrl?: string;          // Ollama API URL (default: http://localhost:11434)
  model?: string;              // Model name (default: llama3.2:3b)
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
 * Call Ollama API to validate a market pair
 */
async function validateWithLLM(
  leftTitle: string,
  rightTitle: string,
  ollamaUrl: string,
  model: string
): Promise<ValidationDecision | null> {
  const prompt = `You are a prediction market matching expert. Compare these two market titles and determine if they are asking about the EXACT SAME EVENT.

Market A (Polymarket): "${leftTitle}"
Market B (Kalshi): "${rightTitle}"

Answer with ONLY ONE WORD:
- YES if they are clearly the same event
- NO if they are different events
- UNCERTAIN if you cannot tell

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
          num_predict: 10,   // Short response
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
    ollamaUrl = 'http://localhost:11434',
    model = 'llama3.2:3b',
    dryRun = true,
    apply = false,
    topic,
  } = options;

  const effectiveDryRun = !apply || dryRun;

  console.log('\\n============================================================');
  console.log('[llm-validate] LLM Link Validator (v3.1.0)');
  console.log('============================================================');
  console.log(`Model: ${model}`);
  console.log(`Ollama URL: ${ollamaUrl}`);
  console.log(`Min Score: ${minScore}`);
  console.log(`Limit: ${limit}`);
  console.log(`Batch Size: ${batchSize}`);
  console.log(`Topic: ${topic || 'all (excluding topic=all)'}`);
  console.log(`Mode: ${effectiveDryRun ? 'DRY RUN' : '⚠️  APPLY (will confirm)'}`);
  console.log();

  // Test Ollama connection
  try {
    const testResponse = await fetch(`${ollamaUrl}/api/tags`);
    if (!testResponse.ok) {
      console.error(`❌ Cannot connect to Ollama at ${ollamaUrl}`);
      console.error('   Make sure Ollama is running: ollama serve');
      process.exit(1);
    }
    const tags = await testResponse.json() as { models?: Array<{ name: string }> };
    const hasModel = tags.models?.some((m) => m.name.startsWith(model));
    if (!hasModel) {
      console.error(`❌ Model ${model} not found`);
      console.error(`   Available models: ${tags.models?.map((m) => m.name).join(', ')}`);
      console.error(`   Download it: ollama pull ${model}`);
      process.exit(1);
    }
    console.log(`✓ Connected to Ollama, model ${model} available\\n`);
  } catch (error) {
    console.error(`❌ Failed to connect to Ollama: ${error}`);
    process.exit(1);
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
        const decision = await validateWithLLM(
          link.leftMarket.title,
          link.rightMarket.title,
          ollamaUrl,
          model
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
              reason: `llm_validate@3.1.0:${model}:${decision.confidence.toFixed(2)}`,
            },
          });
        }
      } else if (decision.decision === 'NO') {
        rejected++;
      }
    }

    // Progress
    console.log(`Progress: ${Math.min(i + batchSize, links.length)}/${links.length}\\n`);

    // Rate limiting (don't hammer the LLM)
    await new Promise((r) => setTimeout(r, 500));
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

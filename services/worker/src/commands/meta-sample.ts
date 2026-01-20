/**
 * Metadata sampling command
 * Inspects metadata structure of markets to understand available fields
 */

import type { Venue } from '@data-module/core';
import { getClient } from '@data-module/db';

export interface MetaSampleOptions {
  venue: Venue;
  limit: number;
}

/**
 * Recursively get keys from an object up to maxDepth
 */
function getKeysDeep(obj: unknown, maxDepth: number = 2, currentDepth: number = 0): Record<string, unknown> {
  if (currentDepth >= maxDepth || obj === null || obj === undefined) {
    return {};
  }

  if (typeof obj !== 'object') {
    return {};
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return { '[array]': 'empty' };
    // Sample first element
    const firstItem = obj[0];
    if (typeof firstItem === 'object' && firstItem !== null) {
      return { '[array]': getKeysDeep(firstItem, maxDepth, currentDepth + 1) };
    }
    return { '[array]': typeof firstItem };
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (value === null || value === undefined) {
      result[key] = 'null';
    } else if (typeof value === 'object') {
      if (Array.isArray(value)) {
        if (value.length === 0) {
          result[key] = '[]';
        } else if (typeof value[0] === 'object' && value[0] !== null) {
          result[key] = { '[array]': getKeysDeep(value[0], maxDepth, currentDepth + 1) };
        } else {
          result[key] = `[${typeof value[0]}]`;
        }
      } else {
        result[key] = getKeysDeep(value, maxDepth, currentDepth + 1);
      }
    } else {
      result[key] = typeof value;
    }
  }
  return result;
}

/**
 * Format nested keys for display
 */
function formatKeys(obj: Record<string, unknown>, indent: string = '    '): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      lines.push(`${indent}${key}: ${value}`);
    } else if (typeof value === 'object' && value !== null) {
      lines.push(`${indent}${key}:`);
      lines.push(...formatKeys(value as Record<string, unknown>, indent + '  '));
    }
  }
  return lines;
}

export async function runMetaSample(options: MetaSampleOptions): Promise<void> {
  const { venue, limit } = options;
  const prisma = getClient();

  console.log(`\n[meta-sample] Sampling ${limit} markets from ${venue}...\n`);

  // Get newest markets with diverse titles
  const markets = await prisma.market.findMany({
    where: { venue },
    orderBy: { id: 'desc' },
    take: limit,
    select: {
      id: true,
      externalId: true,
      title: true,
      category: true,
      status: true,
      metadata: true,
    },
  });

  if (markets.length === 0) {
    console.log(`No markets found for venue ${venue}`);
    return;
  }

  // Collect all unique metadata keys across markets
  const allMetadataKeys = new Map<string, Set<string>>();

  for (const market of markets) {
    console.log(`--- Market #${market.id} ---`);
    console.log(`  externalId: ${market.externalId}`);
    console.log(`  title: ${market.title.substring(0, 80)}${market.title.length > 80 ? '...' : ''}`);
    console.log(`  category: ${market.category || 'null'}`);
    console.log(`  status: ${market.status}`);

    if (market.metadata && typeof market.metadata === 'object') {
      const meta = market.metadata as Record<string, unknown>;
      const topKeys = Object.keys(meta);
      console.log(`  metadata keys: [${topKeys.join(', ')}]`);

      // Track keys for summary
      for (const key of topKeys) {
        if (!allMetadataKeys.has(key)) {
          allMetadataKeys.set(key, new Set());
        }
        const value = meta[key];
        if (value !== null && value !== undefined) {
          const valueType = Array.isArray(value) ? 'array' : typeof value;
          allMetadataKeys.get(key)!.add(valueType);
        }
      }

      // Show structure of metadata (2 levels deep)
      const structure = getKeysDeep(meta, 2);
      const lines = formatKeys(structure);
      if (lines.length > 0) {
        console.log(`  metadata structure:`);
        for (const line of lines.slice(0, 20)) {
          console.log(line);
        }
        if (lines.length > 20) {
          console.log(`    ... and ${lines.length - 20} more fields`);
        }
      }

      // Show sample values for key fields
      const interestingKeys = ['eventTicker', 'event_ticker', 'seriesTicker', 'series_ticker',
                               'category', 'tags', 'ticker', 'marketType', 'market_type'];
      for (const key of interestingKeys) {
        if (key in meta && meta[key] !== null && meta[key] !== undefined) {
          const val = meta[key];
          const displayVal = typeof val === 'string' ? val : JSON.stringify(val).substring(0, 100);
          console.log(`  >> ${key}: ${displayVal}`);
        }
      }
    } else {
      console.log(`  metadata: null or empty`);
    }
    console.log('');
  }

  // Summary of all metadata keys found
  console.log(`\n=== METADATA KEYS SUMMARY (${venue}) ===\n`);
  const sortedKeys = Array.from(allMetadataKeys.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [key, types] of sortedKeys) {
    console.log(`  ${key}: ${Array.from(types).join('|')}`);
  }
  console.log(`\nTotal unique keys: ${allMetadataKeys.size}`);
}

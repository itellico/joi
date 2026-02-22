// Maximal Marginal Relevance (MMR) re-ranking — ported from OpenClaw
// Balances relevance with diversity:
// MMR = λ * relevance - (1-λ) * max_similarity_to_selected

export interface MMRItem {
  id: string;
  score: number;
  content: string;
}

export interface MMRConfig {
  enabled: boolean;
  lambda: number; // 0 = max diversity, 1 = max relevance
}

export const DEFAULT_MMR_CONFIG: MMRConfig = {
  enabled: true,
  lambda: 0.7,
};

// Tokenize text for Jaccard similarity
function tokenize(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  return new Set(tokens);
}

// Jaccard similarity between two token sets [0, 1]
function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersectionSize = 0;
  const smaller = setA.size <= setB.size ? setA : setB;
  const larger = setA.size <= setB.size ? setB : setA;

  for (const token of smaller) {
    if (larger.has(token)) intersectionSize++;
  }

  const unionSize = setA.size + setB.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

function maxSimilarityToSelected(
  item: MMRItem,
  selectedItems: MMRItem[],
  tokenCache: Map<string, Set<string>>,
): number {
  if (selectedItems.length === 0) return 0;

  let maxSim = 0;
  const itemTokens = tokenCache.get(item.id) ?? tokenize(item.content);

  for (const selected of selectedItems) {
    const selectedTokens = tokenCache.get(selected.id) ?? tokenize(selected.content);
    const sim = jaccardSimilarity(itemTokens, selectedTokens);
    if (sim > maxSim) maxSim = sim;
  }

  return maxSim;
}

// Re-rank items using MMR
export function mmrRerank<T extends MMRItem>(items: T[], config: Partial<MMRConfig> = {}): T[] {
  const { enabled = DEFAULT_MMR_CONFIG.enabled, lambda = DEFAULT_MMR_CONFIG.lambda } = config;

  if (!enabled || items.length <= 1) return [...items];

  const clampedLambda = Math.max(0, Math.min(1, lambda));
  if (clampedLambda === 1) return [...items].sort((a, b) => b.score - a.score);

  // Pre-tokenize for efficiency
  const tokenCache = new Map<string, Set<string>>();
  for (const item of items) {
    tokenCache.set(item.id, tokenize(item.content));
  }

  // Normalize scores to [0, 1]
  const maxScore = Math.max(...items.map((i) => i.score));
  const minScore = Math.min(...items.map((i) => i.score));
  const scoreRange = maxScore - minScore;

  const normalizeScore = (score: number): number => {
    if (scoreRange === 0) return 1;
    return (score - minScore) / scoreRange;
  };

  const selected: T[] = [];
  const remaining = new Set(items);

  while (remaining.size > 0) {
    let bestItem: T | null = null;
    let bestMMRScore = -Infinity;

    for (const candidate of remaining) {
      const normalizedRelevance = normalizeScore(candidate.score);
      const maxSim = maxSimilarityToSelected(candidate, selected, tokenCache);
      const mmrScore = clampedLambda * normalizedRelevance - (1 - clampedLambda) * maxSim;

      if (
        mmrScore > bestMMRScore ||
        (mmrScore === bestMMRScore && candidate.score > (bestItem?.score ?? -Infinity))
      ) {
        bestMMRScore = mmrScore;
        bestItem = candidate;
      }
    }

    if (bestItem) {
      selected.push(bestItem);
      remaining.delete(bestItem);
    } else {
      break;
    }
  }

  return selected;
}

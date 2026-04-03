import { extractArxivIDFromURL } from "./arxiv";

const ARXIV_API_ENDPOINT = "https://export.arxiv.org/api/query";
const DEFAULT_MAX_RESULTS = 10;
const MAX_INTERVAL_MS = 60_000;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "towards",
  "with",
]);

export interface ArxivLookupCandidate {
  id: string;
  title: string;
  url: string;
  score: number;
  sequenceScore: number;
  tokenScore: number;
}

export interface ArxivLookupResult {
  query: string;
  normalizedQuery: string;
  threshold: number;
  best: ArxivLookupCandidate | null;
  matched: ArxivLookupCandidate | null;
  candidates: ArxivLookupCandidate[];
}

export interface ArxivLookupOptions {
  threshold?: number;
  maxResults?: number;
  requestText?: (url: string) => Promise<string>;
}

export const DEFAULT_LOOKUP_SIMILARITY_THRESHOLD = 0.88;
export const DEFAULT_LOOKUP_INTERVAL_MS = 3000;

export function normalizeLookupTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeLookupSimilarityThreshold(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_LOOKUP_SIMILARITY_THRESHOLD;
  }
  return clamp(parsed, 0, 1);
}

export function sanitizeLookupIntervalMs(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_LOOKUP_INTERVAL_MS;
  }
  return Math.round(clamp(parsed, 0, MAX_INTERVAL_MS));
}

export function buildArxivLookupURL(
  title: string,
  maxResults = DEFAULT_MAX_RESULTS,
): string {
  const normalizedTitle = normalizeLookupTitle(title);
  const keywords = getLookupKeywords(normalizedTitle);
  const queryParts: string[] = [];

  if (normalizedTitle) {
    queryParts.push(`ti:"${normalizedTitle}"`);
  }
  if (keywords.length > 0) {
    queryParts.push(
      `(${keywords.map((keyword) => `ti:${keyword}`).join(" AND ")})`,
    );
  }

  const searchQuery =
    queryParts.join(" OR ") || `all:"${normalizedTitle || title.trim()}"`;
  const params = new URLSearchParams({
    search_query: searchQuery,
    start: "0",
    max_results: String(Math.max(1, Math.round(maxResults))),
    sortBy: "relevance",
    sortOrder: "descending",
  });
  return `${ARXIV_API_ENDPOINT}?${params.toString()}`;
}

export function parseArxivLookupResponse(xml: string): Array<{
  id: string;
  title: string;
  url: string;
}> {
  const entries = [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)];
  return entries
    .map((entryMatch) => {
      const entry = entryMatch[1];
      const url = decodeXMLText(extractXMLText(entry, "id"));
      const title = decodeXMLText(extractXMLText(entry, "title"))
        .replace(/\s+/g, " ")
        .trim();
      const id = extractArxivIDFromURL(url);
      if (!id || !title) {
        return null;
      }
      return { id, title, url };
    })
    .filter((entry): entry is { id: string; title: string; url: string } =>
      Boolean(entry),
    );
}

export function scoreArxivTitleMatch(
  sourceTitle: string,
  candidateTitle: string,
): Pick<ArxivLookupCandidate, "score" | "sequenceScore" | "tokenScore"> {
  const normalizedSource = normalizeLookupTitle(sourceTitle);
  const normalizedCandidate = normalizeLookupTitle(candidateTitle);

  if (!normalizedSource || !normalizedCandidate) {
    return {
      score: 0,
      sequenceScore: 0,
      tokenScore: 0,
    };
  }

  if (normalizedSource === normalizedCandidate) {
    return {
      score: 1,
      sequenceScore: 1,
      tokenScore: 1,
    };
  }

  const sourceTokens = normalizedSource.split(" ");
  const candidateTokens = normalizedCandidate.split(" ");
  const sequenceScore = getSequenceSimilarity(
    normalizedSource,
    normalizedCandidate,
  );
  const tokenScore = getTokenSimilarity(sourceTokens, candidateTokens);
  const score = clamp(sequenceScore * 0.65 + tokenScore * 0.35, 0, 1);

  return {
    score,
    sequenceScore,
    tokenScore,
  };
}

export async function lookupArxivByTitle(
  title: string,
  options: ArxivLookupOptions = {},
): Promise<ArxivLookupResult> {
  const normalizedQuery = normalizeLookupTitle(title);
  const threshold = sanitizeLookupSimilarityThreshold(options.threshold);
  const requestText = options.requestText || requestArxivText;
  const xml = await requestText(
    buildArxivLookupURL(title, options.maxResults || DEFAULT_MAX_RESULTS),
  );
  const candidates = parseArxivLookupResponse(xml)
    .map((candidate) => {
      const scores = scoreArxivTitleMatch(title, candidate.title);
      return {
        ...candidate,
        ...scores,
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.tokenScore !== left.tokenScore) {
        return right.tokenScore - left.tokenScore;
      }
      return right.sequenceScore - left.sequenceScore;
    });

  const best = candidates[0] || null;
  return {
    query: title.trim(),
    normalizedQuery,
    threshold,
    best,
    matched: best && best.score >= threshold ? best : null,
    candidates,
  };
}

async function requestArxivText(url: string): Promise<string> {
  const zoteroHTTP = (globalThis as any).Zotero?.HTTP;
  if (typeof zoteroHTTP?.request === "function") {
    const response = await zoteroHTTP.request("GET", url, {
      responseType: "text",
      noCache: true,
      headers: {
        Accept: "application/atom+xml,text/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (typeof response?.responseText === "string") {
      return response.responseText;
    }
    if (typeof response?.response === "string") {
      return response.response;
    }
  }

  if (typeof fetch === "function") {
    const response = await fetch(url, {
      headers: {
        Accept: "application/atom+xml,text/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!response.ok) {
      throw new Error(`arXiv lookup failed with status ${response.status}`);
    }
    return response.text();
  }

  throw new Error("No HTTP client available for arXiv lookup");
}

function getLookupKeywords(normalizedTitle: string): string[] {
  const tokens = normalizedTitle
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
  const uniqueTokens = [...new Set(tokens)];
  uniqueTokens.sort((left, right) => {
    if (right.length !== left.length) {
      return right.length - left.length;
    }
    return left.localeCompare(right);
  });
  return uniqueTokens.slice(0, 6);
}

function extractXMLText(entry: string, tagName: string): string {
  const tagPattern = new RegExp(
    `<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
    "i",
  );
  return entry.match(tagPattern)?.[1]?.trim() || "";
}

function decodeXMLText(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, codePoint) =>
      String.fromCodePoint(Number.parseInt(codePoint, 10)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, codePoint) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function getSequenceSimilarity(left: string, right: string): number {
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) {
    return 1;
  }
  const distance = getLevenshteinDistance(left, right);
  return clamp(1 - distance / maxLength, 0, 1);
}

function getTokenSimilarity(
  leftTokens: string[],
  rightTokens: string[],
): number {
  const rightCounts = new Map<string, number>();
  for (const token of rightTokens) {
    rightCounts.set(token, (rightCounts.get(token) || 0) + 1);
  }

  let overlap = 0;
  for (const token of leftTokens) {
    const count = rightCounts.get(token) || 0;
    if (count <= 0) {
      continue;
    }
    overlap += 1;
    rightCounts.set(token, count - 1);
  }

  const total = leftTokens.length + rightTokens.length;
  return total === 0 ? 1 : (2 * overlap) / total;
}

function getLevenshteinDistance(left: string, right: string): number {
  const previous = new Array(right.length + 1).fill(0);
  const current = new Array(right.length + 1).fill(0);

  for (let column = 0; column <= right.length; column += 1) {
    previous[column] = column;
  }

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + substitutionCost,
      );
    }
    for (let column = 0; column <= right.length; column += 1) {
      previous[column] = current[column];
    }
  }

  return previous[right.length];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

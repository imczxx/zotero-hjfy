export interface ItemFieldReader {
  getField(field: string): unknown;
}

export interface ItemFieldWriter extends ItemFieldReader {
  setField(field: string, value: string): void;
}

export type ArxivSource = "manual" | "url" | "doi";

export interface ResolvedArxivID {
  id: string;
  source: ArxivSource;
}

export interface ArxivResolution {
  manualInput: string;
  manualID: string | null;
  urlID: string | null;
  doiID: string | null;
  resolved: ResolvedArxivID | null;
}

export const EXTRA_ARXIV_KEY = "HJFY-ArXiv-ID";

const ARXIV_ID_PATTERN =
  /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?\/\d{7})(?:v\d+)?$/i;
const ARXIV_URL_PATTERN =
  /https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf|html|format)\/([^?#\s]+)/i;
const ARXIV_DOI_PATTERN =
  /(?:https?:\/\/(?:dx\.)?doi\.org\/)?10\.48550\/arxiv\.([^?#\s]+)/i;
const ARXIV_TAGGED_PATTERN =
  /\barxiv:((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?\/\d{7})(?:v\d+)?)\b/i;
const ARXIV_INLINE_PATTERN =
  /\b((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?\/\d{7})(?:v\d+)?)\b/i;
const EXTRA_ARXIV_PATTERN = new RegExp(
  `^\\s*${EXTRA_ARXIV_KEY}\\s*:\\s*(.*?)\\s*$`,
  "i",
);

function normalizeCandidate(value: string): string | null {
  const candidate = value
    .trim()
    .replace(/^arxiv:/i, "")
    .replace(/\.pdf$/i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (!ARXIV_ID_PATTERN.test(candidate)) {
    return null;
  }
  return candidate.replace(/v\d+$/i, "");
}

function safeDecodeURI(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getFieldText(item: ItemFieldReader, field: string): string {
  const value = item.getField(field);
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

export function extractArxivIDFromDOI(doi: string): string | null {
  const normalized = safeDecodeURI(doi.trim());
  if (!normalized) {
    return null;
  }
  const match = normalized.match(ARXIV_DOI_PATTERN);
  return match ? normalizeCandidate(match[1]) : null;
}

export function extractArxivIDFromURL(url: string): string | null {
  const normalized = safeDecodeURI(url.trim());
  if (!normalized) {
    return null;
  }
  const doiID = extractArxivIDFromDOI(normalized);
  if (doiID) {
    return doiID;
  }
  const match = normalized.match(ARXIV_URL_PATTERN);
  return match ? normalizeCandidate(match[1]) : null;
}

export function extractArxivIDFromManualInput(input: string): string | null {
  const normalized = safeDecodeURI(input.trim());
  if (!normalized) {
    return null;
  }
  return (
    extractArxivIDFromURL(normalized) ||
    extractArxivIDFromDOI(normalized) ||
    normalizeCandidate(normalized) ||
    normalizeCandidate(normalized.match(ARXIV_TAGGED_PATTERN)?.[1] || "") ||
    normalizeCandidate(normalized.match(ARXIV_INLINE_PATTERN)?.[1] || "")
  );
}

export function getManualArxivInput(item: ItemFieldReader): string {
  const extra = getFieldText(item, "extra");
  if (!extra) {
    return "";
  }
  const lines = extra.split(/\r?\n/);
  const match = lines
    .map((line) => line.match(EXTRA_ARXIV_PATTERN))
    .find(Boolean);
  return match?.[1]?.trim() || "";
}

export function setManualArxivInput(
  item: ItemFieldWriter,
  value: string,
): void {
  const extra = getFieldText(item, "extra");
  const nextValue = value.trim();
  const nextLines: string[] = [];
  let replaced = false;

  for (const line of extra.split(/\r?\n/)) {
    if (EXTRA_ARXIV_PATTERN.test(line)) {
      if (nextValue && !replaced) {
        nextLines.push(`${EXTRA_ARXIV_KEY}: ${nextValue}`);
        replaced = true;
      }
      continue;
    }
    if (line || extra) {
      nextLines.push(line);
    }
  }

  if (!replaced && nextValue) {
    while (nextLines.length > 0 && nextLines[nextLines.length - 1] === "") {
      nextLines.pop();
    }
    if (nextLines.length > 0) {
      nextLines.push("");
    }
    nextLines.push(`${EXTRA_ARXIV_KEY}: ${nextValue}`);
  }

  while (nextLines.length > 0 && nextLines[nextLines.length - 1] === "") {
    nextLines.pop();
  }

  item.setField("extra", nextLines.join("\n"));
}

export function getArxivResolution(item: ItemFieldReader): ArxivResolution {
  const manualInput = getManualArxivInput(item);
  const manualID = extractArxivIDFromManualInput(manualInput);
  const urlID = extractArxivIDFromURL(getFieldText(item, "url"));
  const doiID = extractArxivIDFromDOI(getFieldText(item, "DOI"));

  if (manualID) {
    return {
      manualInput,
      manualID,
      urlID,
      doiID,
      resolved: { id: manualID, source: "manual" },
    };
  }
  if (urlID) {
    return {
      manualInput,
      manualID,
      urlID,
      doiID,
      resolved: { id: urlID, source: "url" },
    };
  }
  if (doiID) {
    return {
      manualInput,
      manualID,
      urlID,
      doiID,
      resolved: { id: doiID, source: "doi" },
    };
  }
  return {
    manualInput,
    manualID,
    urlID,
    doiID,
    resolved: null,
  };
}

export function buildHjfyURL(arxivID: string): string {
  return `https://hjfy.top/arxiv/${arxivID}`;
}

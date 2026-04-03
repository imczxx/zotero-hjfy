import { config } from "../../package.json";
import {
  sanitizeLookupIntervalMs,
  sanitizeLookupSimilarityThreshold,
} from "./arxivLookup";
import { getPref, setPref } from "../utils/prefs";

type LookupPrefKey = "lookupSimilarityThreshold" | "lookupIntervalMs";

export async function registerPrefsScripts(window: Window) {
  const doc = window.document;
  bindNumberPref(
    doc,
    `zotero-prefpane-${config.addonRef}-lookup-similarity-threshold`,
    "lookupSimilarityThreshold",
    sanitizeLookupSimilarityThreshold,
  );
  bindNumberPref(
    doc,
    `zotero-prefpane-${config.addonRef}-lookup-interval-ms`,
    "lookupIntervalMs",
    sanitizeLookupIntervalMs,
  );
}

function bindNumberPref(
  doc: Document,
  inputID: string,
  prefKey: LookupPrefKey,
  sanitize: (value: unknown) => number,
) {
  const input = doc.querySelector(`#${inputID}`) as HTMLInputElement | null;
  if (!input) {
    return;
  }

  input.value = String(sanitize(getPref(prefKey)));

  if (input.dataset.hjfyBound === "true") {
    return;
  }
  input.dataset.hjfyBound = "true";

  input.addEventListener("change", () => {
    const nextValue = sanitize(input.value);
    input.value = String(nextValue);
    setPref(prefKey, nextValue);
  });
}

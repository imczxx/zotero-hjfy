import { assert } from "chai";
import {
  buildArxivLookupURL,
  lookupArxivByTitle,
  normalizeLookupTitle,
  parseArxivLookupResponse,
  sanitizeLookupIntervalMs,
  sanitizeLookupSimilarityThreshold,
  scoreArxivTitleMatch,
} from "../src/modules/arxivLookup";

describe("arXiv title lookup helpers", function () {
  it("normalizes punctuation-heavy titles for matching", function () {
    assert.equal(
      normalizeLookupTitle("Self-RAG: Learning to Retrieve, Generate & Critique"),
      "self rag learning to retrieve generate and critique",
    );
  });

  it("sanitizes lookup preferences into safe numeric values", function () {
    assert.equal(sanitizeLookupSimilarityThreshold("1.2"), 1);
    assert.equal(sanitizeLookupSimilarityThreshold("bad"), 0.88);
    assert.equal(sanitizeLookupIntervalMs("-100"), 0);
    assert.equal(sanitizeLookupIntervalMs("70000"), 60000);
  });

  it("parses arXiv API XML entries into candidate titles and ids", function () {
    const xml = `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>https://arxiv.org/abs/2401.00001v2</id>
          <title>Retrieval-Augmented Generation for Large Language Models</title>
        </entry>
        <entry>
          <id>https://arxiv.org/abs/2402.00002</id>
          <title>Completely Different Paper</title>
        </entry>
      </feed>
    `;

    assert.deepEqual(parseArxivLookupResponse(xml), [
      {
        id: "2401.00001",
        title: "Retrieval-Augmented Generation for Large Language Models",
        url: "https://arxiv.org/abs/2401.00001v2",
      },
      {
        id: "2402.00002",
        title: "Completely Different Paper",
        url: "https://arxiv.org/abs/2402.00002",
      },
    ]);
  });

  it("scores close titles higher than unrelated ones", function () {
    const closeMatch = scoreArxivTitleMatch(
      "Retrieval Augmented Generation for Large Language Models",
      "Retrieval-Augmented Generation for Large Language Models",
    );
    const weakMatch = scoreArxivTitleMatch(
      "Retrieval Augmented Generation for Large Language Models",
      "A Survey of Database Systems",
    );

    assert.isAbove(closeMatch.score, 0.95);
    assert.isBelow(weakMatch.score, 0.5);
  });

  it("selects the best arXiv candidate above the similarity threshold", async function () {
    const xml = `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>https://arxiv.org/abs/2401.00001</id>
          <title>Graph Neural Networks for Recommendation</title>
        </entry>
        <entry>
          <id>https://arxiv.org/abs/2401.00002</id>
          <title>Unrelated Title</title>
        </entry>
      </feed>
    `;

    const result = await lookupArxivByTitle(
      "Graph Neural Networks for Recommendation",
      {
        threshold: 0.9,
        requestText: async (url) => {
          assert.include(buildArxivLookupURL("Graph Neural Networks"), "api/query");
          assert.include(url, "search_query=");
          return xml;
        },
      },
    );

    assert.equal(result.matched?.id, "2401.00001");
    assert.equal(result.best?.id, "2401.00001");
    assert.isAtLeast(result.best?.score || 0, 0.99);
  });

  it("returns no confident match when the threshold is not met", async function () {
    const xml = `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>https://arxiv.org/abs/2401.00003</id>
          <title>Graph Neural Networks in Recommender Systems</title>
        </entry>
      </feed>
    `;

    const result = await lookupArxivByTitle(
      "Graph Neural Networks for Recommendation",
      {
        threshold: 0.99,
        requestText: async () => xml,
      },
    );

    assert.isNull(result.matched);
    assert.equal(result.best?.id, "2401.00003");
  });
});

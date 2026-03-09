import { assert } from "chai";
import {
  EXTRA_ARXIV_KEY,
  buildHjfyURL,
  extractArxivIDFromDOI,
  extractArxivIDFromManualInput,
  extractArxivIDFromURL,
  getArxivResolution,
  getManualArxivInput,
  setManualArxivInput,
} from "../src/modules/arxiv";

class FakeItem {
  private fields = new Map<string, string>();

  constructor(fields: Record<string, string> = {}) {
    Object.entries(fields).forEach(([key, value]) =>
      this.fields.set(key, value),
    );
  }

  getField(field: string) {
    return this.fields.get(field) || "";
  }

  setField(field: string, value: string) {
    this.fields.set(field, value);
  }
}

describe("arXiv helpers", function () {
  it("extracts IDs from arXiv URLs and DOI URLs", function () {
    assert.equal(
      extractArxivIDFromURL("https://arxiv.org/pdf/2501.01234v2.pdf"),
      "2501.01234",
    );
    assert.equal(
      extractArxivIDFromURL("https://doi.org/10.48550/arXiv.cs.AI%2F9901001"),
      "cs.AI/9901001",
    );
  });

  it("extracts IDs from DOI and manual fallback inputs", function () {
    assert.equal(
      extractArxivIDFromDOI("10.48550/arXiv.2501.01234v3"),
      "2501.01234",
    );
    assert.equal(
      extractArxivIDFromManualInput("arXiv:hep-th/9901001v2"),
      "hep-th/9901001",
    );
  });

  it("stores the manual value in Extra and prefers it during resolution", function () {
    const item = new FakeItem({
      extra: "Citation Key: demo",
      url: "https://arxiv.org/abs/2401.00001",
      DOI: "10.48550/arXiv.2401.00002",
    });

    setManualArxivInput(item, "2501.01234");

    assert.include(item.getField("extra"), `${EXTRA_ARXIV_KEY}: 2501.01234`);
    assert.equal(getManualArxivInput(item), "2501.01234");
    const resolution = getArxivResolution(item);
    assert.equal(resolution.manualInput, "2501.01234");
    assert.equal(resolution.manualID, "2501.01234");
    assert.deepEqual(resolution.resolved, {
      id: "2501.01234",
      source: "manual",
    });
  });

  it("falls back to URL and builds the HJFY link", function () {
    const item = new FakeItem({
      url: "https://arxiv.org/abs/2401.00001v2",
      DOI: "10.1145/example-doi",
    });

    const resolution = getArxivResolution(item);
    assert.equal(resolution.urlID, "2401.00001");
    assert.deepEqual(resolution.resolved, {
      id: "2401.00001",
      source: "url",
    });
    assert.equal(
      buildHjfyURL("2401.00001"),
      "https://hjfy.top/arxiv/2401.00001",
    );
  });
});

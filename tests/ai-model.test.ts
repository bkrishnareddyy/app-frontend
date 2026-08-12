/**
 * Per-surface model selection.
 *
 * These tests pin the precedence chain, because getting it wrong is silent: a
 * surface that ignores its own variable keeps working, just on the wrong model,
 * and nothing in the product says so. The deprecated `GEMINI_MODEL` rung is
 * tested for the same reason — it exists so environments configured before
 * per-surface selection do not move onto the built-in default without anyone
 * changing a setting.
 */

import { describe, expect, it } from "vitest";
import { AI_SURFACES, type AiSurface } from "@/lib/ai/aiQuota";
import { DEFAULT_AI_MODEL, aiModel, aiModelEnvKey } from "@/lib/ai/aiModel";

/** Selection is a pure function of the env it is handed, so tests pass one in. */
function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

describe("precedence", () => {
  it("falls back to the built-in default when nothing is configured", () => {
    for (const surface of AI_SURFACES) {
      expect(aiModel(surface, env({}))).toBe(DEFAULT_AI_MODEL);
    }
  });

  it("prefers the surface's own variable over every broader setting", () => {
    const resolved = aiModel(
      "hts-classification",
      env({
        HTS_CLASSIFICATION_MODEL: "surface-model",
        AI_DEFAULT_MODEL: "platform-model",
        GEMINI_MODEL: "legacy-model",
      })
    );

    expect(resolved).toBe("surface-model");
  });

  it("uses AI_DEFAULT_MODEL for surfaces without an override of their own", () => {
    const configured = env({ HTS_CLASSIFICATION_MODEL: "surface-model", AI_DEFAULT_MODEL: "platform-model" });

    expect(aiModel("hts-classification", configured)).toBe("surface-model");
    expect(aiModel("normalization", configured)).toBe("platform-model");
    expect(aiModel("copilot", configured)).toBe("platform-model");
  });

  it("still honours the deprecated GEMINI_MODEL when nothing newer is set", () => {
    expect(aiModel("document-intake", env({ GEMINI_MODEL: "legacy-model" }))).toBe("legacy-model");
  });

  it("prefers AI_DEFAULT_MODEL over the deprecated variable", () => {
    const resolved = aiModel(
      "document-intake",
      env({ AI_DEFAULT_MODEL: "platform-model", GEMINI_MODEL: "legacy-model" })
    );

    expect(resolved).toBe("platform-model");
  });
});

describe("blank and whitespace values", () => {
  it("treats an empty variable as unset rather than asking for a model named nothing", () => {
    // `FOO_MODEL=` in a .env file is how a variable gets unset in practice.
    const resolved = aiModel("copilot", env({ COPILOT_MODEL: "", AI_DEFAULT_MODEL: "platform-model" }));

    expect(resolved).toBe("platform-model");
  });

  it("treats a whitespace-only variable as unset", () => {
    expect(aiModel("copilot", env({ COPILOT_MODEL: "   " }))).toBe(DEFAULT_AI_MODEL);
  });

  it("trims a padded value rather than sending the padding to the provider", () => {
    expect(aiModel("copilot", env({ COPILOT_MODEL: "  padded-model \n" }))).toBe("padded-model");
  });

  it("never returns an empty model name", () => {
    for (const surface of AI_SURFACES) {
      const blank = env({ [aiModelEnvKey(surface)]: "", AI_DEFAULT_MODEL: "", GEMINI_MODEL: "" });
      expect(aiModel(surface, blank)).not.toBe("");
    }
  });
});

describe("surface coverage", () => {
  it("gives every metered surface its own variable, and no two the same one", () => {
    // A surface sharing another's variable would be configured by accident.
    const keys = AI_SURFACES.map((surface) => aiModelEnvKey(surface));

    expect(keys).toHaveLength(AI_SURFACES.length);
    expect(new Set(keys).size).toBe(AI_SURFACES.length);
    for (const key of keys) expect(key).toMatch(/^[A-Z0-9_]+_MODEL$/);
  });

  it("selects independently per surface, so one override moves one surface", () => {
    const configured = env({ PRODUCT_INTELLIGENCE_MODEL: "only-this-one" });
    const moved: AiSurface[] = AI_SURFACES.filter(
      (surface) => aiModel(surface, configured) !== DEFAULT_AI_MODEL
    );

    expect(moved).toEqual(["product-intelligence"]);
  });
});

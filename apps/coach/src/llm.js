'use strict';

/**
 * llm.js — Claude Haiku call: structured findings → coaching prose.
 *
 * Model: `claude-haiku-4-5-20251001` (per phase contract).
 *
 * Why prompt caching: the system prompt is identical on every call —
 * holding it cacheable cuts ~95% of input cost on the steady state.
 * Findings are tiny structured JSON, kept *after* the cache breakpoint
 * so each request has a tiny tail and a large cache hit.
 *
 * Cost model (per coach call, with 1k-token system prompt cached):
 *   - cache write (first time): ~1.25× × 1000 ≈ 1250 cached tokens   one-off
 *   - cache read (every call):  ~0.10× × 1000 ≈ 100 effective tokens
 *   - findings input:           ~200 tokens at full $1/1M = $0.0002
 *   - output:                   ~150 tokens at full $5/1M = $0.00075
 *   Total per uncached call: ~$0.0011 (~ $11 / 10k)
 *   Total per cached call:   ~$0.001 + cache write amortized → < $1 / 10k
 *     (with the situation cache from cache.js doing ~50% additional dedup)
 *
 * Security:
 *   - Hole cards never sent raw — only the 169-class label.
 *   - Findings come from the analyzer; no user-controlled text reaches
 *     the LLM in the system prompt or messages payload.
 */

const MODEL = 'claude-haiku-4-5-20251001';
const SYSTEM_PROMPT = `You are a poker coach for a no-limit hold'em sim. The user just finished a hand and a deterministic EV-analysis engine produced a list of structured findings, each describing one of their decisions and how it compared to the best alternative in big blinds.

Rules:
1. Use ONLY the structured findings. Do not invent cards, ranges, or amounts.
2. Refer to hole cards by their class label (e.g. "AKs"). Never spell out a real two-card combo unless it appears in the finding.
3. Be concise — 2 short sentences per decision, max ~60 words each.
4. Lead with what the player did right when on_chart; otherwise explain the EV gap and the better play.
5. Use poker terminology (open, 3-bet, c-bet, fold equity) but stay readable.
6. Do not editorialize about the player; coach the decision.
7. Output JSON: { "summary": string, "decisions": [ { "street": string, "tag": string, "comment": string } ] }
8. The "tag" field must be copied verbatim from the input finding.

If the findings list is empty, return { "summary": "No coachable decisions this hand.", "decisions": [] }.`;

/**
 * Wrap the Anthropic SDK so tests can inject a stub. The runtime path
 * lazy-imports the real SDK only when no client is provided.
 */
function defaultClientFactory() {
  // eslint-disable-next-line global-require
  const Anthropic = require('@anthropic-ai/sdk');
  return new Anthropic.default ? new Anthropic.default() : new Anthropic();
}

class CoachLLM {
  /**
   * @param {object} opts
   * @param {object} [opts.client]   Anthropic client (or stub for tests).
   * @param {string} [opts.model]    override model id.
   * @param {(...args: any[]) => void} [opts.log]
   */
  constructor(opts = {}) {
    this.client = opts.client || null;
    this.model = opts.model || MODEL;
    this.log = opts.log || (() => {});
    // Cumulative usage, surfaced for cost dashboards / tests.
    this.usage = {
      requests: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
    };
  }

  _client() {
    if (!this.client) this.client = defaultClientFactory();
    return this.client;
  }

  /**
   * Generate coaching prose for a structured analysis.
   *
   * @param {{ findings: object[] }} analysis  output from analyze.js
   * @returns {Promise<{ summary: string, decisions: object[], raw?: any }>}
   */
  async generate(analysis) {
    const findings = analysis?.findings || [];

    if (findings.length === 0) {
      return { summary: 'No coachable decisions this hand.', decisions: [] };
    }

    const userPayload = {
      hand_id: analysis.handId,
      findings: findings.map((f) => ({
        street: f.street,
        position: f.position,
        hole_class: f.hole_class,
        action_taken: f.action_taken,
        action_taken_ev: f.action_taken_ev,
        best_action: f.best_action,
        best_action_ev: f.best_action_ev,
        mistake_bb: f.mistake_bb,
        tag: f.tag,
        equity: f.equity,
      })),
    };

    const client = this._client();
    const response = await client.messages.create({
      model: this.model,
      max_tokens: 600,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          // Prompt caching: system prompt is byte-identical on every
          // call, so it caches across hands. Anything user-specific
          // goes in `messages` *after* this breakpoint.
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: JSON.stringify(userPayload),
            },
          ],
        },
      ],
    });

    this._tallyUsage(response);

    const text = extractText(response);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      this.log('coach_llm_parse_failed', { err: err.message, text: text.slice(0, 200) });
      parsed = { summary: text || 'Coach output unparsable.', decisions: [] };
    }

    return { ...parsed, raw: { id: response.id, usage: response.usage } };
  }

  _tallyUsage(response) {
    this.usage.requests += 1;
    const u = response?.usage || {};
    this.usage.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
    this.usage.cache_read_input_tokens += u.cache_read_input_tokens || 0;
    this.usage.input_tokens += u.input_tokens || 0;
    this.usage.output_tokens += u.output_tokens || 0;
  }

  /**
   * Estimate $ per 10k hands assuming the current usage is representative.
   * Pricing as of 2026-04 for claude-haiku-4-5: $1/$5 per 1M input/output;
   * cache read 0.1×, cache write 1.25×.
   */
  costEstimatePer10k() {
    const r = this.usage.requests || 1;
    const perCall = (
      (this.usage.cache_creation_input_tokens / r) * 1.25 / 1_000_000 * 1.0 +
      (this.usage.cache_read_input_tokens / r) * 0.1 / 1_000_000 * 1.0 +
      (this.usage.input_tokens / r) / 1_000_000 * 1.0 +
      (this.usage.output_tokens / r) / 1_000_000 * 5.0
    );
    return Math.round(perCall * 10_000 * 10000) / 10000;
  }
}

function extractText(response) {
  if (!response?.content) return '';
  for (const block of response.content) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      return block.text;
    }
  }
  return '';
}

module.exports = {
  CoachLLM,
  SYSTEM_PROMPT,
  MODEL,
};

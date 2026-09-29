/**
 * Retry the opaque opencode-go 400 for DeepSeek Flash.
 *
 * The Go gateway intermittently rejects a request with an HTTP 400 whose whole
 * body is `{"model":"<model>"}` — no error, no message. That is not a verdict on
 * the payload: replaying the identical bytes usually returns 200. OpenCode
 * classifies every 4xx as provider.invalid-request and does not retry it, so the
 * turn dies and has to be continued by hand.
 *
 * This forces a bounded retry for that one opaque signature. Structured 400s
 * (which carry the upstream reason) and every other status keep the built-in
 * policy. Delete this file to disable.
 *
 * Plain object export (no `@opencode/plugin` import) so it resolves from the
 * global plugins directory, which has no node_modules for the V2 plugin package.
 */

// Extra attempts, one delay each. Attempt 1 is the original request.
const DELAYS = [3000, 9000]

// No upstream reason: the client fallback text, or the bare AI SDK phrasing,
// or the raw stub body itself. A structured 400 always carries a real message.
const opaque = (message) =>
  /^(provider request failed with http 400|bad request)$/i.test(message.trim()) ||
  /^\{"model":\s*"[^"]*"\}$/.test(message.trim())

export default {
  id: "opencode-go.stub-400-retry",
  async setup(ctx) {
    await ctx.session.hook(
      "retry",
      (event) => {
        if (event.error.type !== "provider.invalid-request") return
        if (event.error.status !== 400) return
        if (!/^deepseek-v4(\.1)?-flash/.test(event.model.id)) return
        if (!opaque(event.error.message)) return
        if (event.attempt > DELAYS.length) return
        event.decision = { retry: true, delay: DELAYS[event.attempt - 1] }
      },
      { providerID: "opencode-go" },
    )
  },
}

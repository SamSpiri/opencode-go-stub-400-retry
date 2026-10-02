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

// How the client decorates a bodyless rejection. The client appends the parsed
// body (or an upstream code) after the status in some versions, and nothing in
// others, so the prefix is stripped and whatever remains decides.
const PREFIX = /^(?:provider request failed with http \d+|bad request)\b[:\s]*/i

// The stub is a JSON object whose only key is the echoed model id.
const bareModelEcho = (value) =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === 1 &&
  typeof value.model === "string"

const opaque = (message) => {
  const text = message.trim()
  const detail = PREFIX.test(text) ? text.replace(PREFIX, "").trim() : text
  if (detail === "") return true
  try {
    return bareModelEcho(JSON.parse(detail))
  } catch {
    return false
  }
}

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

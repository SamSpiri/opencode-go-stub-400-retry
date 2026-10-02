# opencode-go-stub-400-retry

A single-file OpenCode V2 plugin that retries the opaque HTTP 400 that
`opencode-go` intermittently returns for DeepSeek Flash, so the turn no longer
dies and needs a manual "continue".

Not affiliated with OpenCode. Client-side workaround, not a gateway fix.

## The problem

`POST https://opencode.ai/zen/go/v1/chat/completions` intermittently answers with
an HTTP 400 whose entire body is a 31-byte stub:

```
{"model":"deepseek-v4.1-flash"}
```

No `error`, no `message`, no `code`. The failure is not a verdict on the request:
replaying the identical bytes usually returns 200 (observed 200/400/200 across
three byte-faithful attempts in [#51201]). It happens mid-session after ordinary
tool-call turns, at a few percent of requests, and "continue" normally recovers it.

OpenCode's error extractor finds no `error.message`/`message` in the body and
falls back to the literal `Provider request failed with HTTP 400`, classifying it
`provider.invalid-request`. Every 4xx is deliberately non-retryable (OpenCode PR
[#49195]), so the turn ends there and the raw body is not persisted. Hence: no
retry, no diagnosis, manual continue.

## What it does

Registers OpenCode's `session.hook("retry")` for provider `opencode-go` and turns
that one opaque signature into a bounded retry: two extra attempts, 3 s then 9 s.
Everything else keeps the built-in policy.

Matched only when **all** hold:

| Condition | Value |
| --- | --- |
| provider | `opencode-go` |
| model | `deepseek-v4-flash` / `deepseek-v4.1-flash` (any variant) |
| error type | `provider.invalid-request` |
| status | `400` |
| message | opaque — no upstream reason |

A structured 400 carries the real reason and is left alone, so deterministic
failures (content filter, `reasoning_content` contract, input over the route
limit) are not retried pointlessly.

## Install from source

Requires OpenCode V2 (the `retry` session hook). Verified on 2.0.19.

```sh
git clone https://github.com/SamSpiri/opencode-go-stub-400-retry.git
mkdir -p ~/.config/opencode/plugins
cp opencode-go-stub-400-retry/opencode-go-stub-retry.ts ~/.config/opencode/plugins/
```

Nothing to install, no dependencies. OpenCode discovers `.ts` files in the global
plugins directory automatically and reloads on change, so there is no config to
edit. `~/.config/opencode` is `$XDG_CONFIG_HOME/opencode` when that is set.

To keep it out of the config directory, point at the file from `opencode.json(c)`
instead:

```jsonc
{
  "plugins": ["/absolute/path/to/opencode-go-stub-retry.ts"]
}
```

The file deliberately exports a plain object rather than calling `Plugin.define`,
so it loads without `@opencode/plugin` being resolvable — the global plugins
directory has no `node_modules` for that package.

## Verify

```sh
opencode api get /api/plugin | jq '.data[] | select(.id=="opencode-go.stub-400-retry")'
# { "state": { "status": "active" }, ... }
```

A forced retry shows up in the session UI as a retry countdown.

### End-to-end test

The stub cannot be induced on the real gateway, so point a throwaway project at a
local server that answers 400 with `{"model":"deepseek-v4.1-flash"}` for the
first N requests and a normal completion afterwards, then run one prompt. The
result on OpenCode 2.0.19, failing the first three requests:

| Plugin | Requests seen | Turn |
| --- | --- | --- |
| disabled | 3, all 400, within the same second | fails: `Provider request failed with HTTP 400` |
| enabled | 4 — the three, then one 9.1 s later returning 200 | completes: `ok` |

Without the plugin the turn dies exactly as reported. With it, the retry carries
the turn through.

## The delivered message shape

Worth knowing if you write a similar matcher: the message is not stable across
versions. On 2.0.19 a bodyless 400 persisted as the bare
`Provider request failed with HTTP 400`; a 2.0.21 node produced

```
Provider request failed with HTTP 400: {"model":"deepseek-v4.1-flash"}
```

with the raw body appended, plus an `error.response.body` holding the stub. A
matcher anchored with `$` on the first form silently never fires on the second.
This plugin strips the prefix and inspects whatever follows.

## Tune or disable

`DELAYS` at the top of the file is the whole policy; one entry per extra attempt,
in milliseconds.

```ts
const DELAYS = [3000, 9000]
```

Delete the file (or remove the `plugins` entry) to disable.

## What it does not fix

- **`reasoning_content` contract failures.** Echoed `reasoning_content` on
  historical assistant tool-call turns combined with any `reasoning_effort` value
  is a deterministic rejection ([#48180], bisected: removing either side returns
  200). Retrying will not help. Drop the `#max` variant, or the model.
- **Genuinely oversized sessions.** The gateway is session-pinned to upstreams
  with different ceilings; one rejects around 582k tokens while the catalog
  advertises 1,000,000, so auto-compaction (ceiling 968k) never fires ([#50761],
  [#50574]). Retrying wastes two attempts. Lower the model's
  `limit.context` (e.g. `800000`) to make compaction fire earlier, or `/compact`.
- **The 403 `error code: 1010`** is unrelated: Cloudflare denying a request by its
  browser/UA signature, typically on a hand-made replay.

## Evidence

- The opaque stub, mid-session, after tool turns: [#51434], [#51477], [#51990]
- Byte-faithful replay flipping 200/400/200; retry usually recovers: [#51201]
- Route-dependent ceilings behind the same stub: [#50761], [#50574], [#50446]
- 4xx deliberately non-retryable: OpenCode PR [#49195]
- The message is the client fallback, not the gateway's: OpenCode 2.0.19 bundle,
  `hm()` in the provider error path

Verified end-to-end against a mock gateway (see above), and against real
persisted records: `provider.invalid-request`, status 400, with the message in
both the bare and body-appending forms.

[#51201]: https://github.com/anomalyco/opencode/issues/51201
[#51434]: https://github.com/anomalyco/opencode/issues/51434
[#51477]: https://github.com/anomalyco/opencode/issues/51477
[#51990]: https://github.com/anomalyco/opencode/issues/51990
[#50761]: https://github.com/anomalyco/opencode/issues/50761
[#50574]: https://github.com/anomalyco/opencode/issues/50574
[#50446]: https://github.com/anomalyco/opencode/issues/50446
[#48180]: https://github.com/anomalyco/opencode/issues/48180
[#49195]: https://github.com/anomalyco/opencode/pull/49195

# Wuxianwow database integration

The desktop uses its existing Streamable HTTP MCP manager with the server name `wuxianwow` and URL `https://wuxianwow.com/mcp`.
The local user profile stores this entry in `mcp.json`. It requires no credentials.
The manager reads configuration at startup. Restart the companion after an external configuration edit.

For Forever questions, the shared Warcraft context prioritizes this database over local references and other game versions.
The policy applies even when no local record matches. Explicit Retail or Classic requests keep their own scope.
Responses must name `无限图鉴 wuxianwow.com` and link the returned pages. Unavailable tools and missing evidence must be disclosed.
Auction prices require collection timestamps and available realm scope. Issue submission requires an explicit user request.

On 2026-10-30, the existing MCP SDK connected successfully and discovered 49 tools.
Calling `search` with `{"query":"瑟银锭","limit":5}` returned `item:12359` and `https://wuxianwow.com/item/12359` as the first match.
This verifies the real server connection through the same SDK and persisted endpoint. It does not verify a model-generated conversation.

References: [integration instructions](https://wuxianwow.com/ai), [tool documentation](https://wuxianwow.com/about).

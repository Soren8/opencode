# OpenAI Responses WebSocket

Enabled by default on `local`, `dev`, and `beta`. On `latest` and `prod`, set `OPENCODE_EXPERIMENTAL_WEBSOCKETS=true`.

## Flow

1. A streamed `POST /responses` request arrives.
2. If it has no `session-id` or `x-session-affinity` header, use HTTP.
3. Title requests use HTTP.
4. If that session's socket is busy or already in fallback mode, use HTTP.
5. Otherwise, reuse its open socket or open a new one.
6. Send `response.create` and return WebSocket events as SSE.

## Lifetime

- Connect timeout: 15 seconds.
- Pool idle timeout: 5 minutes.
- Stream idle timeout: 2 minutes without an event fails the stream as retryable.
- After a completed response, keep the socket for reuse.
- Before reusing a socket that sat unused for 5 seconds or more, ping it; if no pong arrives within 5 seconds, replace it. A link that died silently, such as after a wifi hop, still reads `OPEN`.
- Reuse a socket for up to 55 minutes, then replace it on the next request.

## Retries

- Retry WebSocket stream/setup failures up to 5 times, then use HTTP for that session until the pool entry is idle-pruned.
- `websocket_connection_limit_reached` consumes the same retry budget and HTTP fallback.
- If a WebSocket fails after its first event, fail it as retryable rather than replaying partial output in transport.
- Abort or cancel closes the socket.

## Next Steps

- `previous_response_id` continuation.
- Optional second WebSocket for concurrent requests in one session. Currently these use HTTP.

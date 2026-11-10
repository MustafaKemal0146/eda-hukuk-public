#!/bin/sh
# infra/docker/tei-entrypoint.sh (070 §10.3)
set -eu
[ -r "${API_KEY_FILE:-}" ] && { API_KEY="$(cat "$API_KEY_FILE")"; export API_KEY; }
exec text-embeddings-router --model-id "$MODEL_ID" --revision "$REVISION" --port "$PORT" --hostname 0.0.0.0 \
     --auto-truncate false ${MAX_BATCH_TOKENS:+--max-batch-tokens "$MAX_BATCH_TOKENS"} --json-output

#!/bin/sh
set -eu

for service in bookservice libraryservice; do
  echo "Waiting for ${service}..."
  while ! curl -sf -X POST "http://${service}/graphql" \
    -H 'Content-Type: application/json' \
    -d '{"query":"{ _service { sdl } }"}' \
    -o "/tmp/${service}.json"; do
    sleep 1
  done
  node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/tmp/${service}.json','utf8')).data._service.sdl)" > "/tmp/${service}.graphql"
  echo "Got SDL for ${service}"
done

echo "Composing supergraph..."
wgc router compose --input /app/subgraphs.yaml --out /tmp/execution-config.json

echo "Starting cosmo router..."
exec /usr/local/bin/router --config /app/router.yaml

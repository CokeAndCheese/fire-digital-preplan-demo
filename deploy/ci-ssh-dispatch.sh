#!/usr/bin/env bash
set -Eeuo pipefail

readonly PROJECT_SLUG='fire-digital-preplan-demo'
readonly DEPLOY_SCRIPT="/srv/apps/${PROJECT_SLUG}/deploy/deploy-from-bundle.sh"

deny() {
  echo 'This SSH key is restricted to this project deployment.' >&2
  exit 126
}

original=${SSH_ORIGINAL_COMMAND:-}

# GitHub Actions invokes legacy SCP explicitly (`scp -O`) so the forced
# command can admit only a single, validated upload destination.
if [[ $original =~ ^scp[[:space:]]+-t[[:space:]]+(/tmp/fire-digital-preplan-demo-[0-9a-fA-F]{40}\.bundle)$ ]]; then
  exec /usr/bin/scp -t "${BASH_REMATCH[1]}"
fi

read -r verb bundle sha extra <<<"$original"
if [[ $verb == deploy && -z ${extra:-} \
      && $bundle =~ ^/tmp/fire-digital-preplan-demo-[0-9a-fA-F]{40}\.bundle$ \
      && $sha =~ ^[0-9a-fA-F]{40}$ ]]; then
  exec "$DEPLOY_SCRIPT" "$bundle" "$sha"
fi

deny

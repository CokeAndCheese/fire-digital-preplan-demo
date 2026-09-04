#!/usr/bin/env bash
set -Eeuo pipefail

readonly ENV_PATH=${1:-.env}

die() {
  echo "deployment configuration: $*" >&2
  exit 1
}

trim() {
  local value=$1
  value=${value#"${value%%[![:space:]]*}"}
  value=${value%"${value##*[![:space:]]}"}
  printf '%s' "$value"
}

[[ -f $ENV_PATH && ! -L $ENV_PATH ]] || die 'environment file is missing or is a symlink'

read_env_value() {
  local requested_key=$1
  local raw_line line key value first last

  while IFS= read -r raw_line || [[ -n $raw_line ]]; do
    line=${raw_line%$'\r'}
    line=$(trim "$line")
    [[ -z $line || ${line:0:1} == '#' ]] && continue
    [[ $line == *=* ]] || continue

    key=$(trim "${line%%=*}")
    [[ $key == "$requested_key" ]] || continue
    value=$(trim "${line#*=}")

    if (( ${#value} >= 2 )); then
      first=${value:0:1}
      last=${value: -1}
      if [[ $first == '"' && $last == '"' ]] || [[ $first == "'" && $last == "'" ]]; then
        value=${value:1:${#value}-2}
      fi
    fi

    printf '%s' "$value"
    return 0
  done <"$ENV_PATH"

  return 1
}

readonly required=(
  AGENT_APP_KEY
  AGENT_COMPETITION_APP_ID
  X_APP_KEY
  AGENT_GATEWAY
  USTUDIO_GATEWAY
)

missing=()
for key in "${required[@]}"; do
  value=$(read_env_value "$key" || true)
  [[ -n $value ]] || missing+=("$key")
done

if (( ${#missing[@]} > 0 )); then
  die "missing required names: ${missing[*]}"
fi

invalid=()
check_exact() {
  local key=$1
  local expected=$2
  local actual
  actual=$(read_env_value "$key" || true)
  [[ $actual == "$expected" ]] || invalid+=("$key")
}

check_exact FIRE_BASE_PATH /fire-digital-preplan-demo
check_exact SCENE_BASE_PATH /fire-digital-preplan-demo/scene
check_exact FIRE_PUBLIC_SCENE_URL /fire-digital-preplan-demo/scene
check_exact BROWSER_X_APP_KEY_CONFIRMED true
check_exact OLD_EMBEDDED_CREDENTIALS_REVOKED true
check_exact PUBLIC_UNAUTHENTICATED_DEMO_CONFIRMED true

legacy_public_key=$(read_env_value NEXT_PUBLIC_X_APP_KEY || true)
[[ -z $legacy_public_key ]] || invalid+=(NEXT_PUBLIC_X_APP_KEY)

if (( ${#invalid[@]} > 0 )); then
  die "failed policy checks: ${invalid[*]}"
fi

echo 'deployment environment names and policy flags are valid'

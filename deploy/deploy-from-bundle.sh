#!/usr/bin/env bash
set -Eeuo pipefail

readonly PROJECT_SLUG='fire-digital-preplan-demo'
readonly PROJECT_DIR="/srv/apps/${PROJECT_SLUG}"
readonly MAIN_CONTAINER='fire-digital-preplan-demo'
readonly SCENE_CONTAINER='fire-digital-preplan-demo-scene'
readonly SCENE_BASE_PATH='/fire-digital-preplan-demo/scene'
readonly MAIN_HEALTH_URL="http://127.0.0.1:3100/fire-digital-preplan-demo/health"
readonly SCENE_HEALTH_URL="http://127.0.0.1:3000${SCENE_BASE_PATH}/health"
readonly LOCK_FILE="/tmp/${PROJECT_SLUG}.deploy.lock"
readonly GATEWAY_BASE_URL_DEFAULT='http://127.0.0.1'
readonly ROLLBACK_ROOT="/srv/backups/${PROJECT_SLUG}"

die() { echo "deploy: $*" >&2; exit 1; }

[[ $EUID -ne 0 ]] || die 'run as the dedicated deployment user, not root'
[[ $# -eq 2 ]] || die 'usage: deploy-from-bundle.sh <bundle-path> <40-char-target-sha>'
BUNDLE_PATH=$1
TARGET_SHA=${2,,}

[[ $BUNDLE_PATH == /tmp/${PROJECT_SLUG}-*.bundle ]] || die 'bundle path must be a unique project bundle under /tmp'
[[ -f $BUNDLE_PATH && ! -L $BUNDLE_PATH ]] || die 'bundle must be a regular, non-symlink file'
[[ $TARGET_SHA =~ ^[0-9a-f]{40}$ ]] || die 'target SHA must be a 40-character hexadecimal commit'
trap 'rm -f -- "$BUNDLE_PATH"' EXIT
[[ -d $PROJECT_DIR/.git ]] || die "missing git checkout: ${PROJECT_DIR}"
[[ -f $PROJECT_DIR/.env && ! -L $PROJECT_DIR/.env ]] || die 'server .env is missing or is a symlink'
ENV_MODE=$(stat -c '%a' "$PROJECT_DIR/.env")
(( (8#$ENV_MODE & 8#077) == 0 )) || die 'server .env must not be readable or writable by group/other'

cd "$PROJECT_DIR"
[[ -z $(git status --porcelain --untracked-files=all) ]] || die 'server checkout is dirty; refusing deployment'
node deploy/preflight-env.mjs .env

exec 9>"$LOCK_FILE"
flock -x 9

[[ -z $(git status --porcelain --untracked-files=all) ]] || die 'server checkout became dirty while waiting for deployment lock'

OLD_SHA=$(git rev-parse HEAD^{commit})
OLD_MAIN_IMAGE=$(sudo docker image inspect "$MAIN_CONTAINER:latest" --format '{{.Id}}' 2>/dev/null || true)
OLD_SCENE_IMAGE=$(sudo docker image inspect "$SCENE_CONTAINER:latest" --format '{{.Id}}' 2>/dev/null || true)
ROLLBACK_DIR="${ROLLBACK_ROOT}/$(date -u +%Y%m%dT%H%M%SZ)-${OLD_SHA:0:12}"
mkdir -p "$ROLLBACK_DIR"
chmod 750 "$ROLLBACK_DIR"
printf 'old_sha=%s\nmain_image=%s\nscene_image=%s\ntarget_sha=%s\n' \
  "$OLD_SHA" "$OLD_MAIN_IMAGE" "$OLD_SCENE_IMAGE" "$TARGET_SHA" >"$ROLLBACK_DIR/release-state.txt"
git bundle verify "$BUNDLE_PATH" >/dev/null || die 'bundle verification failed'

BUNDLE_REF=$(git bundle list-heads "$BUNDLE_PATH" | awk -v target="$TARGET_SHA" '$1 == target { print $2; exit }')
case "$BUNDLE_REF" in
  refs/heads/main|refs/remotes/origin/main) ;;
  *) die 'bundle does not advertise the triggering commit as main' ;;
esac

git fetch --no-tags "$BUNDLE_PATH" "${BUNDLE_REF}:refs/remotes/deploy-bundle/main"
FETCHED_SHA=$(git rev-parse refs/remotes/deploy-bundle/main^{commit})
[[ $FETCHED_SHA == "$TARGET_SHA" ]] || die 'fetched bundle tip does not equal the triggering SHA'
git cat-file -e "${TARGET_SHA}^{commit}" || die 'target commit is not present in the bundle'
git merge-base --is-ancestor "$OLD_SHA" "$TARGET_SHA" || die 'target is not a fast-forward descendant of the deployed commit'

compose() {
  sudo docker compose --project-directory "$PROJECT_DIR" --env-file "$PROJECT_DIR/.env" -f "$PROJECT_DIR/compose.yml" "$@"
}

build_images() {
  # The host has 4 GB RAM. Build sequentially so two Next compilers do not
  # compete for the same memory/swap budget.
  compose build scene
  compose build fire
}

wait_for_health() {
  local container=$1
  local deadline=$((SECONDS + 180))
  local state
  while (( SECONDS < deadline )); do
    state=$(sudo docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || true)
    case "$state" in
      healthy) return 0 ;;
      unhealthy) return 1 ;;
    esac
    sleep 3
  done
  return 1
}

check_gateway() {
  local gateway_base=${GATEWAY_BASE_URL:-$GATEWAY_BASE_URL_DEFAULT}
  if [[ ! $gateway_base =~ ^https?://[A-Za-z0-9._:-]+$ ]]; then
    echo 'deploy: GATEWAY_BASE_URL must be a host-only http(s) URL' >&2
    return 1
  fi
  local main_body scene_body
  main_body=$(curl --fail --silent --show-error --max-time 15 "${gateway_base}/${PROJECT_SLUG}/health")
  scene_body=$(curl --fail --silent --show-error --max-time 15 "${gateway_base}${SCENE_BASE_PATH}/health")
  grep -Fq '"service":"fire-command-agent"' <<<"$main_body" || {
    echo 'deploy: gateway main content marker is missing' >&2
    return 1
  }
  grep -Fq '"service":"fire-scene-command-bridge"' <<<"$scene_body" || {
    echo 'deploy: gateway scene content marker is missing' >&2
    return 1
  }
}

rollback() {
  echo "deploy: verification failed; rolling back to ${OLD_SHA}" >&2
  git switch --detach "$OLD_SHA"
  compose config >/dev/null
  if [[ -n $OLD_SCENE_IMAGE && -n $OLD_MAIN_IMAGE ]]; then
    sudo docker image tag "$OLD_SCENE_IMAGE" "$SCENE_CONTAINER:latest"
    sudo docker image tag "$OLD_MAIN_IMAGE" "$MAIN_CONTAINER:latest"
  else
    build_images
  fi
  compose up -d --no-build
  wait_for_health "$SCENE_CONTAINER" || true
  wait_for_health "$MAIN_CONTAINER" || true
}

release() {
  git switch --detach "$TARGET_SHA"
  compose config >/dev/null
  build_images
  compose up -d --no-build
  wait_for_health "$SCENE_CONTAINER"
  wait_for_health "$MAIN_CONTAINER"
  sudo docker exec "$SCENE_CONTAINER" node /usr/local/bin/healthcheck.mjs "$SCENE_HEALTH_URL" fire-scene-command-bridge
  sudo docker exec "$MAIN_CONTAINER" node /usr/local/bin/healthcheck.mjs "$MAIN_HEALTH_URL" fire-command-agent
  sudo docker exec "$MAIN_CONTAINER" node /usr/local/bin/healthcheck.mjs "http://${SCENE_CONTAINER}:3000${SCENE_BASE_PATH}/health" fire-scene-command-bridge
  check_gateway
}

if ! release; then
  rollback
  die "release ${TARGET_SHA} failed and rollback was attempted"
fi

printf '%s\n' "$TARGET_SHA" >"$ROLLBACK_ROOT/deployed-sha"
echo "deploy: ${PROJECT_SLUG} is running ${TARGET_SHA}"

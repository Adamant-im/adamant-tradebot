#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

COMPOSE_FILE="$SCRIPT_DIR/docker/docker-compose.yml"

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose -f "$COMPOSE_FILE")
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose -f "$COMPOSE_FILE")
else
  echo "Docker Compose is not installed." >&2
  exit 1
fi

# npm ci does not put package bins on PATH; compose run passes `mm` as argv[1].
MM_CLI=(node bin/mm.js)

# When developing from a git checkout, bind-mount the CLI so `./mm` uses host sources.
MM_DEV_MOUNTS=()
if [ -f "$SCRIPT_DIR/bin/mm.js" ] && [ -d "$SCRIPT_DIR/modules/mm" ]; then
  MM_DEV_MOUNTS+=(-v "$SCRIPT_DIR/bin/mm.js:/app/bin/mm.js:ro")
  MM_DEV_MOUNTS+=(-v "$SCRIPT_DIR/modules/mm:/app/modules/mm:ro")
fi

MM_RUN=(run --rm -e MM_HOST_CLI=1)

# Status/config/restart need Docker Compose on the host; the app image has no compose CLI.
run_host_mm() {
  run_with_padding env MM_HOST_CLI=1 MM_WORKDIR="$SCRIPT_DIR" node "$SCRIPT_DIR/bin/mm.js" "$@"
}

can_run_host_mm() {
  command -v node >/dev/null 2>&1 && [ -f "$SCRIPT_DIR/bin/mm.js" ] && [ -d "$SCRIPT_DIR/node_modules" ]
}

is_mm_app_running() {
  local ps_out line
  ps_out=$("${COMPOSE[@]}" ps --status running --format '{{.Name}}' mm-app 2>/dev/null) || return 1
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case "$line" in
      *-run-*) continue ;;
      *) return 0 ;;
    esac
  done <<< "$ps_out"
  return 1
}

stop_ephemeral_mm_app_containers() {
  local ps_out line id
  ps_out=$("${COMPOSE[@]}" ps --status running --format '{{.Name}}\t{{.ID}}' mm-app 2>/dev/null) || return 0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case "$line" in
      *-run-*)
        id="${line##*$'\t'}"
        [ -n "$id" ] && docker stop "$id" >/dev/null 2>&1 || true
        ;;
    esac
  done <<< "$ps_out"
}

run_with_padding() {
  echo ""
  set +e
  "$@"
  local code=$?
  set -e
  echo ""
  return $code
}

if [ "$#" -eq 0 ]; then
  if can_run_host_mm; then
    run_host_mm
  else
    run_with_padding "${COMPOSE[@]}" "${MM_RUN[@]}" "${MM_DEV_MOUNTS[@]}" mm-app "${MM_CLI[@]}"
  fi
  exit $?
fi

CMD="$1"
shift

case "$CMD" in
  init|update)
    run_with_padding "${COMPOSE[@]}" "${MM_RUN[@]}" "${MM_DEV_MOUNTS[@]}" mm-app "${MM_CLI[@]}" "$CMD" "$@"
    ;;
  doctor)
    if can_run_host_mm; then
      run_host_mm doctor "$@"
    else
      run_with_padding "${COMPOSE[@]}" "${MM_RUN[@]}" "${MM_DEV_MOUNTS[@]}" mm-app "${MM_CLI[@]}" doctor "$@"
    fi
    ;;
  on)
    if can_run_host_mm; then
      run_with_padding run_host_mm on "$@"
    else
      "${COMPOSE[@]}" up -d mongo
      echo ""
      set +e
      "${COMPOSE[@]}" run --rm -e MM_HOST_CLI=1 -e MM_PREFLIGHT=1 "${MM_DEV_MOUNTS[@]}" mm-app "${MM_CLI[@]}" doctor
      code=$?
      if [ "$code" -eq 1 ] || [ "$code" -eq 3 ]; then
        set -e
        echo ""
        exit "$code"
      fi
      "${COMPOSE[@]}" up -d "$@"
      code=$?
      set -e
      echo ""
      exit $code
    fi
    ;;
  off)
    if [ "${1:-}" = "--all" ]; then
      run_with_padding "${COMPOSE[@]}" stop
    else
      run_with_padding "${COMPOSE[@]}" stop mm-app
      stop_ephemeral_mm_app_containers
    fi
    ;;
  logs)
    if can_run_host_mm; then
      run_host_mm logs "$@"
    else
      run_with_padding "${COMPOSE[@]}" "${MM_RUN[@]}" "${MM_DEV_MOUNTS[@]}" mm-app "${MM_CLI[@]}" logs "$@"
    fi
    ;;
  status|config|restart)
    if can_run_host_mm; then
      run_host_mm "$CMD" "$@"
    elif is_mm_app_running; then
      run_with_padding "${COMPOSE[@]}" exec -e MM_HOST_CLI=1 mm-app "${MM_CLI[@]}" "$CMD" "$@"
    else
      run_with_padding "${COMPOSE[@]}" "${MM_RUN[@]}" "${MM_DEV_MOUNTS[@]}" mm-app "${MM_CLI[@]}" "$CMD" "$@"
    fi
    ;;
  *)
    if is_mm_app_running; then
      run_with_padding "${COMPOSE[@]}" exec -e MM_HOST_CLI=1 mm-app "${MM_CLI[@]}" "$CMD" "$@"
    else
      run_with_padding "${COMPOSE[@]}" "${MM_RUN[@]}" "${MM_DEV_MOUNTS[@]}" mm-app "${MM_CLI[@]}" "$CMD" "$@"
    fi
    ;;
esac

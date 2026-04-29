#!/bin/sh
set -eu

if [ -z "${WEBKIT_DISABLE_COMPOSITING_MODE+x}" ]; then
  if [ -n "${WAYLAND_DISPLAY:-}" ] || [ "${XDG_SESSION_TYPE:-}" = "wayland" ]; then
    export WEBKIT_DISABLE_COMPOSITING_MODE=1
  fi
fi

if [ -z "${WEBKIT_DISABLE_DMABUF_RENDERER+x}" ]; then
  if [ -n "${WAYLAND_DISPLAY:-}" ] || [ "${XDG_SESSION_TYPE:-}" = "wayland" ]; then
    export WEBKIT_DISABLE_DMABUF_RENDERER=1
  fi
fi

exec /usr/lib/paperquay/paperquay-bin "$@"

FROM node:22-bookworm-slim

ENV COREPACK_HOME=/tmp/corepack LANG=C.UTF-8 LC_ALL=C.UTF-8

# git supports clean-install fixtures; procps supports PTY signal tests; screen
# and tmux cover multiplexers; bubblewrap is DSH's Linux sandbox backend.
RUN apt-get update \
  && apt-get install -y --no-install-recommends bubblewrap git procps screen tmux \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && mkdir -p /workspace/.pnpm-store /workspace/node_modules \
    /workspace/packages/dashi/node_modules /workspace/packages/dashi-app/node_modules \
    /workspace/packages/dashi-launcher/node_modules \
  && chmod 0777 /workspace/.pnpm-store /workspace/node_modules \
    /workspace/packages/dashi/node_modules /workspace/packages/dashi-app/node_modules \
    /workspace/packages/dashi-launcher/node_modules

WORKDIR /workspace

CMD ["sh", "-c", "getent group \"$HOST_GID\" >/dev/null || groupadd --gid \"$HOST_GID\" dashi-gate; getent passwd \"$HOST_UID\" >/dev/null || useradd --uid \"$HOST_UID\" --gid \"$HOST_GID\" --home-dir /tmp/dashi-home --create-home dashi-gate; gate_name=$(getent passwd \"$HOST_UID\" | cut -d: -f1); gate_home=$(getent passwd \"$HOST_UID\" | cut -d: -f6); exec setpriv --reuid=\"$HOST_UID\" --regid=\"$HOST_GID\" --init-groups env HOME=\"$gate_home\" USER=\"$gate_name\" sh -c 'pnpm install --frozen-lockfile && pnpm gate'"]

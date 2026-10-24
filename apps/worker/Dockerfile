# The WhatsApp worker, for any always-on Docker host (Railway, Fly.io, Render, a VPS).
# Build from the repository root so the shared package is included:
#   docker build -f apps/worker/Dockerfile -t group-assistant-worker .
# Run exactly ONE container per Supabase project, and give it ~15 s to stop on redeploys
# (README "Run the worker on any host"). All settings come from environment variables.

FROM node:24-slim

WORKDIR /app

# pnpm, at the version pinned in the root package.json ("packageManager").
RUN corepack enable

# Install first (cached between builds while dependencies don't change): only the worker and the
# shared package it uses, not the dashboard or the root tooling (the dashboard's package.json is
# copied only so the workspace matches the lockfile). tsx runs the TypeScript directly;
# ffmpeg-static downloads its Linux binary here (voice notes).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json apps/worker/
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "worker..."

COPY packages/shared packages/shared
COPY apps/worker apps/worker

ENV NODE_ENV=production
WORKDIR /app/apps/worker

# Node runs as the main process, so the host's stop signal reaches the worker directly: it closes
# the WhatsApp socket, saves the session and releases the leader lock before exiting.
CMD ["node", "--import", "tsx", "src/index.ts"]

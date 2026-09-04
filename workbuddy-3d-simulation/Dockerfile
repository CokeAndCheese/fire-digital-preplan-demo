# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /workspace/workbuddy-3d-simulation
COPY workbuddy-3d-simulation/package.json workbuddy-3d-simulation/package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /workspace/workbuddy-3d-simulation
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_BASE_PATH=
ARG NEXT_PUBLIC_DEFAULT_SCENE_ID=477747327523254272
ARG NEXT_PUBLIC_JARVIS_WORKSPACE_ID=
ARG NEXT_PUBLIC_LOCALE=zh
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
ENV NEXT_PUBLIC_DEFAULT_SCENE_ID=${NEXT_PUBLIC_DEFAULT_SCENE_ID}
ENV NEXT_PUBLIC_JARVIS_WORKSPACE_ID=${NEXT_PUBLIC_JARVIS_WORKSPACE_ID}
ENV NEXT_PUBLIC_LOCALE=${NEXT_PUBLIC_LOCALE}
COPY --from=deps /workspace/workbuddy-3d-simulation/node_modules ./node_modules
COPY workbuddy-3d-simulation ./
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ARG NEXT_PUBLIC_BASE_PATH=
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /workspace/workbuddy-3d-simulation/public ./public
COPY --from=builder --chown=nextjs:nodejs /workspace/workbuddy-3d-simulation/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /workspace/workbuddy-3d-simulation/.next/static ./.next/static
COPY --chown=nextjs:nodejs deploy/healthcheck.mjs /usr/local/bin/healthcheck.mjs

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=6s --start-period=45s --retries=5 CMD ["node", "/usr/local/bin/healthcheck.mjs", "3000", "fire-scene-command-bridge"]
CMD ["node", "server.js"]

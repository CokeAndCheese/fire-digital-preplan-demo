# syntax=docker/dockerfile:1

# Build from the repository's 源码 directory so ../shared is available:
# docker build -f fire-command-agent/Dockerfile .
FROM node:22-alpine AS deps
WORKDIR /workspace/fire-command-agent
COPY fire-command-agent/package.json fire-command-agent/package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /workspace/fire-command-agent
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_BASE_PATH=
ARG NEXT_PUBLIC_SCENE_URL=http://localhost:3000
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
ENV NEXT_PUBLIC_SCENE_URL=${NEXT_PUBLIC_SCENE_URL}
COPY --from=deps /workspace/fire-command-agent/node_modules ./node_modules
COPY fire-command-agent/package.json fire-command-agent/package-lock.json fire-command-agent/next.config.mjs fire-command-agent/next-env.d.ts fire-command-agent/tsconfig.json ./
COPY fire-command-agent/app ./app
COPY fire-command-agent/components ./components
COPY fire-command-agent/lib ./lib
COPY fire-command-agent/skills ./skills
COPY fire-command-agent/runtime-evidence ./runtime-evidence
COPY shared /workspace/shared
COPY baseline /workspace/baseline
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3100

RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001 -G nodejs

# Next 16 traces from the configured parent root, so the server is nested at
# .next/standalone/fire-command-agent/server.js.
COPY --from=builder --chown=nextjs:nodejs /workspace/fire-command-agent/.next/standalone/fire-command-agent ./fire-command-agent
COPY --from=builder --chown=nextjs:nodejs /workspace/fire-command-agent/.next/static ./fire-command-agent/.next/static
COPY --chown=nextjs:nodejs deploy/healthcheck.mjs /usr/local/bin/healthcheck.mjs

USER nextjs
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=6s --start-period=30s --retries=5 CMD ["node", "/usr/local/bin/healthcheck.mjs", "3100", "fire-command-agent"]
CMD ["node", "fire-command-agent/server.js"]

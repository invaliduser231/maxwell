FROM node:24.22.1-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install -g pnpm@12.14.0 && npm cache clean --force
WORKDIR /app

FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/bot/package.json apps/bot/
COPY apps/dashboard/package.json apps/dashboard/

FROM manifests AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/bot apps/bot
RUN pnpm --filter @maxwell/core build && pnpm --filter @maxwell/bot build

FROM manifests AS deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod --filter @maxwell/bot...

FROM node:24.22.1-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HEALTH_PORT=8080
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/packages/core/node_modules packages/core/node_modules
COPY --from=deps /app/apps/bot/node_modules apps/bot/node_modules
COPY packages/core/package.json packages/core/
COPY --from=build /app/packages/core/dist packages/core/dist
COPY apps/bot/package.json apps/bot/
COPY --from=build /app/apps/bot/dist apps/bot/dist
COPY assets/png assets/png
COPY assets/fonts assets/fonts
USER node
WORKDIR /app/apps/bot
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.HEALTH_PORT+'/livez').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
STOPSIGNAL SIGTERM
CMD ["node", "--enable-source-maps", "dist/main.js"]

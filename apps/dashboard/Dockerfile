FROM node:24.22.1-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@12.14.0 && npm cache clean --force
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/bot/package.json apps/bot/
COPY apps/dashboard/package.json apps/dashboard/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/dashboard apps/dashboard
RUN pnpm --filter @maxwell/core build && pnpm --filter @maxwell/dashboard build

FROM node:24.22.1-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/dashboard/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/dashboard/.next/static apps/dashboard/.next/static
COPY --from=build --chown=node:node /app/apps/dashboard/public apps/dashboard/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/livez').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/dashboard/server.js"]

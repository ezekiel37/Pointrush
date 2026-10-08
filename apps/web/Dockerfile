# Website image for hosts that run Docker (for example Brimble). Build from the
# repository root:
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_ORIGIN=https://api.acticlaim.com .
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --workspace @pointrush/web --workspace @pointrush/contracts --include-workspace-root --ignore-scripts
COPY packages/contracts packages/contracts
COPY apps/web apps/web
# Public settings are fixed into the website when it is built.
ARG NEXT_PUBLIC_API_ORIGIN
ARG NEXT_PUBLIC_FEATURE_JOBS=off
ENV NEXT_PUBLIC_API_ORIGIN=$NEXT_PUBLIC_API_ORIGIN \
    NEXT_PUBLIC_FEATURE_JOBS=$NEXT_PUBLIC_FEATURE_JOBS \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
RUN test -n "$NEXT_PUBLIC_API_ORIGIN" || { echo "NEXT_PUBLIC_API_ORIGIN must be set when building, for example https://api.acticlaim.com" >&2; exit 1; }
RUN npm run build --workspace @pointrush/contracts && npm run build --workspace @pointrush/web

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

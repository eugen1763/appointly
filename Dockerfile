FROM node:24.13.0-slim AS dependencies

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ make python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM node:24.13.0-slim AS builder

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public drizzle \
    && APP_URL=http://localhost:3000 \
    BETTER_AUTH_SECRET=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8 \
    GUEST_TOKEN_SECRET=ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8 \
    GOOGLE_CLIENT_ID=build-google-client \
    GOOGLE_CLIENT_SECRET=build-google-secret \
    DATABASE_PATH=/tmp/appointly-build.sqlite \
    TRUST_PROXY=false \
    npm run build

FROM node:24.13.0-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/app/data/appointly.sqlite

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/drizzle ./drizzle

RUN mkdir -p /app/data && chown node:node /app/data

EXPOSE 3000

USER node

CMD ["node", "server.js"]

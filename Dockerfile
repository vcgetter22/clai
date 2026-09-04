# clai team server
# Build: docker build -t clai-server .
# Run:   docker run -p 8787:8787 -v clai-data:/var/lib/clai -e CLAI_HOME=/var/lib/clai clai-server
FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json* .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/store/package.json packages/store/
COPY packages/connectors/package.json packages/connectors/
COPY apps/server/package.json apps/server/
COPY apps/cli/package.json apps/cli/
COPY apps/dashboard/package.json apps/dashboard/
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production \
    CLAI_HOME=/var/lib/clai \
    PORT=8787 \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=build /src /app
RUN mkdir -p /var/lib/clai && chown -R node:node /var/lib/clai /app
USER node
EXPOSE 8787
VOLUME ["/var/lib/clai"]
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/api/health >/dev/null 2>&1 || exit 1
CMD ["node", "apps/server/bin/clai-server.js"]

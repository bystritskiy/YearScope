FROM node:26-alpine

# Зависимостей нет: SQLite и разбор TypeScript встроены в Node 26,
# поэтому ни npm install, ни шага сборки в образе не требуется.

WORKDIR /app

ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    PORT=3010

COPY package.json ./
COPY src ./src
COPY public ./public

RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3010

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3010/api/health || exit 1

CMD ["node", "src/server.ts"]

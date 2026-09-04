FROM node:24-alpine AS dependencies

WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev


FROM node:24-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=dependencies --chown=node:node /app/server/node_modules ./server/node_modules
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared

USER node
WORKDIR /app/server

CMD ["node", "index.js"]

# Build the web app and the bundled server, then ship only dist/ on a
# plain Node image. The server bundle includes its dependencies, so the
# runtime image has no node_modules.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    JUKE_PORT=4600 \
    JUKE_HOST=0.0.0.0 \
    JUKE_DATA_DIR=/data
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4600
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4600/api/health || exit 1
CMD ["node", "dist/server/main.js"]

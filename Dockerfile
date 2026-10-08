FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci && npm cache clean --force
COPY . .
RUN npm run build && npm prune --omit=dev && mkdir -p /data && chown node:node /data
# Inside the container we listen on all interfaces; docker-compose only publishes to 127.0.0.1.
# The reverse proxy reaches us from Docker's private network, so trust X-Forwarded-* from there.
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 TRUST_PROXY=uniquelocal DATA_DIR=/data
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "server.js"]

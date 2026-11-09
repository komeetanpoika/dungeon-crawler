# Web-release container: the static game plus the PvP WebSocket server.
# Built for running behind a proxy that appends the caller to X-Forwarded-For
# (Cloud Run, nginx, Caddy). Exposing the container directly? Drop TRUST_PROXY.
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY tools/web-server.mjs tools/
COPY server/ server/
COPY renderer/ renderer/
ENV PORT=8080
ENV TRUST_PROXY=1
EXPOSE 8080
CMD ["node", "tools/web-server.mjs"]

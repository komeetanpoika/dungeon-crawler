# Web-release container: the zero-dependency static server + game files.
FROM node:20-slim
WORKDIR /app
COPY tools/web-server.mjs tools/
COPY renderer/ renderer/
ENV PORT=8080
EXPOSE 8080
CMD ["node", "tools/web-server.mjs"]

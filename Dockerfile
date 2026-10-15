# CINTEXA NEXUS API server (Express 5 + Postgres). Works on Render, Fly.io, Railway, Cloud Run or any Docker host.
# The Website Intelligence engine runs inside this process, so the container must stay running (do not scale to zero).
FROM node:22-slim
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund && npm run build --workspace=@workspace/api-server
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]

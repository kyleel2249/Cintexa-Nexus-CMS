# Isolated browser worker. Run it in its own container/VM with no access to internal networks.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY *.mjs ./
ENV NODE_ENV=production PORT=8787
USER pwuser
EXPOSE 8787
CMD ["node", "server.mjs"]

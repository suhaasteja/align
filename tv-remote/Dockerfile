FROM node:22-alpine

WORKDIR /app

# Dependencies first so edits to source don't re-run npm ci on every build.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

# Pairing tokens live here; mount a volume so they survive `docker compose up`
# recreating the container, otherwise every restart re-prompts the TV.
ENV TV_REMOTE_HOME=/data
VOLUME /data

ENV PORT=8477
EXPOSE 8477

# NOTE: this image needs host networking to be useful — see docker-compose.yml.
# In Docker's default bridge network it cannot send SSDP multicast or reach
# your TV's LAN address.
CMD ["node", "server/index.js"]

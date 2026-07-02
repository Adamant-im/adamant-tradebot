FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

COPY . .

RUN chmod +x docker-entrypoint.sh mm bin/mm.js \
  && ln -sf /app/bin/mm.js /usr/local/bin/mm

ENV NODE_ENV=production
ENV MM_DOCKER=1

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "app.js"]

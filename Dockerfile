FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dev deps include @playwright/test (for local tests only); never download
# Playwright browsers during the image build — they are pruned out anyway.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package*.json ./

RUN npm ci

COPY server.js ./
COPY build.js ./
COPY generate-hash.js ./
COPY tailwind.config.js ./
COPY src ./src

RUN node build.js

RUN npm prune --production

RUN mkdir -p rooms

EXPOSE 3000

CMD ["node", "server.js"]

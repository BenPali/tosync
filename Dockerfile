FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY server.js ./
COPY build.js ./
COPY generate-hash.js ./
COPY src ./src

RUN node build.js

RUN mkdir -p rooms

EXPOSE 3000

CMD ["node", "server.js"]

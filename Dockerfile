FROM node:20-alpine

RUN apk add --no-cache python3 make g++

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

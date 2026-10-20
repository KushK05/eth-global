FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY services/aqua-gateway/package.json ./services/aqua-gateway/package.json
COPY services/hedera-gateway/package.json ./services/hedera-gateway/package.json
RUN npm ci

COPY services/hedera-gateway ./services/hedera-gateway

WORKDIR /app/services/hedera-gateway

CMD ["node", "--import", "tsx", "src/research-service.ts"]

# GCP Auth Service — Steam OpenID only
FROM node:20-bookworm-slim AS builder
WORKDIR /build
COPY auth-service/package*.json ./
RUN npm ci
COPY auth-service/ ./
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app
COPY auth-service/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /build/dist ./dist
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/index.js"]

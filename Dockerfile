# Full stack for Google Cloud Run: Node API + Vite admin UI + ffmpeg + yt-dlp（视频流水线）
#
# gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT/REPO/SERVICE:latest .
# gcloud run deploy SERVICE --image ... --region REGION --platform managed --allow-unauthenticated

FROM node:20-bookworm-slim AS admin-builder
WORKDIR /build/admin
COPY admin/package*.json ./
RUN npm ci
COPY admin/ ./
RUN npm run build

FROM node:20-bookworm-slim AS server-builder
WORKDIR /build/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
  && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev

COPY --from=server-builder /build/server/dist ./dist
COPY --from=admin-builder /build/admin/dist ./admin/dist

ENV NODE_ENV=production
ENV PORT=8080
ENV SERVE_ADMIN_STATIC=true
ENV ADMIN_DIST_PATH=/app/admin/dist

EXPOSE 8080

CMD ["node", "dist/index.js"]

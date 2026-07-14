# 预构建产物 + 生产 node_modules（本地 npm ci --omit=dev 后上传，避免 1GB VPS 上编译）
FROM node:20-bookworm-slim
WORKDIR /app
COPY node_modules ./node_modules
COPY dist ./dist
COPY admin-dist ./admin/dist
ENV NODE_ENV=production
ENV PORT=8080
ENV SERVE_ADMIN_STATIC=true
ENV ADMIN_DIST_PATH=/app/admin/dist
EXPOSE 8080
CMD ["node", "dist/index.js"]

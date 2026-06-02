FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev 2>/dev/null || npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm install typescript @types/better-sqlite3 @types/express @types/node --save-dev && npm run build
RUN cp src/schema.sql dist/schema.sql
ENV NODE_ENV=production
EXPOSE 8090
CMD ["node", "dist/index.js"]

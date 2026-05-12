FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# Install deps first (better Docker layer caching)
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy source
COPY runner.js server.js templates.js slack.js targets.json ./

# Create logs dir
RUN mkdir -p /app/logs

ENV NODE_ENV=production
ENV PORT=8090

EXPOSE 8090

CMD ["node", "server.js"]

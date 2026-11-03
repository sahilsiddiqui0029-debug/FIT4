# Build Stage
FROM node:20-bookworm-slim

# Install OpenSSL required by Prisma on Debian
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Set Working Directory
WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy Source
COPY . .

# Environment Variables
ENV NODE_ENV=production
ENV PORT=5000

# Prisma Client Generation
RUN npx prisma generate

EXPOSE 5000

# Start Server
CMD ["node", "server.js"]

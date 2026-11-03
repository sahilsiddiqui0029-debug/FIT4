# Build Stage
FROM node:18-bullseye-slim

# Install OpenSSL required by Prisma on Debian/Ubuntu
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Set Working Directory
WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy Source (Massive frontend folders are now ignored via .dockerignore)
COPY --chown=node:node . .

# Environment Variables
ENV NODE_ENV=production
ENV PORT=5000

# Prisma Client Generation
RUN npx prisma generate && chown -R node:node /app

USER node

EXPOSE 5000

# Start Server
CMD ["node", "server.js"]

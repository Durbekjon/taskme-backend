# ---- Build stage ----
FROM node:24-alpine AS builder
WORKDIR /app

# Prisma schema engine needs OpenSSL
RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# ---- Runtime stage ----
FROM node:24-alpine
WORKDIR /app

# dumb-init for signal handling; openssl for Prisma migration engine
RUN apk add --no-cache dumb-init openssl

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY package.json ./

# Copy startup script
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Create uploads directory
RUN mkdir -p uploads/avatars uploads/logos

EXPOSE 4000

ENTRYPOINT ["dumb-init", "--"]
CMD ["./docker-entrypoint.sh"]

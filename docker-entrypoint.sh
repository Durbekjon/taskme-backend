#!/bin/sh
set -e

echo "[taskme-backend] Running database migrations..."
npx prisma migrate deploy

echo "[taskme-backend] Starting server..."
exec node dist/src/main

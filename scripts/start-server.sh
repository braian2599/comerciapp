#!/bin/bash
# Production server startup script for standalone Next.js build
set -e

cd /home/z/my-project

# NEXTAUTH_SECRET: required for NextAuth v4 to sign cookies/JWTs
export NEXTAUTH_SECRET="${NEXTAUTH_SECRET:-5cf63dc38e54e7645c197b9219e56beb5307800ad99afef9f416364c5002fb55}"
export DATABASE_URL="file:/home/z/my-project/db/custom.db"
export NEXTAUTH_URL="https://preview-chat-6770b3e1-51d2-4c8b-aad0-90a11a14fd89.space-z.ai"
export HOSTNAME="0.0.0.0"
export PORT="3000"

echo "NEXTAUTH_SECRET is set (length: ${#NEXTAUTH_SECRET})"
echo "DATABASE_URL: $DATABASE_URL"

# Copy static assets to standalone (Next.js doesn't include them in standalone)
# IMPORTANT: clean first to avoid stale chunks from previous builds
if [ -d ".next/standalone/.next/static" ]; then
  rm -rf .next/standalone/.next/static
fi
if [ -d ".next/standalone/public" ]; then
  rm -rf .next/standalone/public
fi
if [ -d ".next/static" ]; then
  cp -r .next/static .next/standalone/.next/static
  echo "Copied .next/static to standalone"
fi
if [ -d "public" ]; then
  cp -r public .next/standalone/public
  echo "Copied public to standalone"
fi

cd .next/standalone

# Start server in new session (setsid) so it survives shell exit
setsid bun server.js > /tmp/next-server.log 2>&1 &
SERVER_PID=$!
echo "Server started with PID $SERVER_PID"

# Wait for server to be ready
for i in {1..20}; do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ | grep -q "200\|307\|302"; then
    echo "Server ready on http://localhost:3000"
    break
  fi
  sleep 1
done

# Final health check
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/)
if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "307" ] && [ "$HTTP_CODE" != "302" ]; then
  echo "WARNING: Server returned HTTP $HTTP_CODE"
  echo "--- Server log: ---"
  tail -30 /tmp/next-server.log
  exit 1
fi
echo "Static chunk check: HTTP $HTTP_CODE"

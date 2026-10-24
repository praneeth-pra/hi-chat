# Stage 1: Build stage with Node.js and Yarn v4
FROM node:22-alpine AS builder

# Install build dependencies
RUN apk add --no-cache \
    make \
    g++ \
    python3 \
    py3-pip \
    git

# Enable corepack and install Yarn 4
RUN corepack enable && corepack prepare yarn@4.5.3 --activate

# Verify Yarn version
RUN yarn --version

# Set working directory
WORKDIR /app

# Copy source code
COPY ./extensions-web ./extensions-web
COPY ./web-app ./web-app
COPY ./Makefile ./Makefile
COPY ./.yarnrc.yml ./.yarnrc.yml
COPY ./package.json ./package.json
COPY ./yarn.lock ./yarn.lock
COPY ./core ./core

# Build web application
RUN yarn install --immutable && yarn build:core && make build-web-app

# Stage 2: Production stage with Nginx
FROM nginx:alpine

# Node runs the transcription relay (relay/server.mjs) next to nginx
RUN apk add --no-cache nodejs ca-certificates

# Copy static files from build stage
COPY --from=builder /app/web-app/dist-web /usr/share/nginx/html

# Copy custom nginx config. The official nginx image renders templates with
# envsubst, so the server listens on $PORT (Railway sets it; defaults to 80).
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
ENV PORT=80
# Dictation transcription keys; set them as Railway variables. ElevenLabs is the
# main engine; Grok (xAI) is an optional second engine.
ENV ELEVENLABS_API_KEY=""
ENV XAI_API_KEY=""
# Optional Muse (Meta) live engine for Auto dictation.
ENV META_API_KEY=""
# Optional Sarvam engine for Auto dictation (Indian English), off until chosen
# in Settings.
ENV SARVAM_API_KEY=""
# Optional web sources for Accuracy mode; set securely in Railway.
ENV EXA_API_KEY=""
# Site login (relay/auth.mjs): a code emailed to LOGIN_EMAIL through Resend.
# Without LOGIN_EMAIL nobody can sign in.
ENV LOGIN_EMAIL=""
ENV RESEND_API_KEY=""

# The relay starts before nginx (the image runs /docker-entrypoint.d/*.sh)
COPY relay/server.mjs relay/wsProxy.mjs relay/auth.mjs relay/requestSafety.mjs relay/search.mjs relay/mirror.mjs relay/camera.mjs relay/logo.png relay/dictionary.txt /relay/
COPY relay/start-relay.sh /docker-entrypoint.d/40-start-relay.sh

EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]

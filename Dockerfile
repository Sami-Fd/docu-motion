# Renders a docu-motion project inside a container.
#   docker build -t docu-motion .
#   docker run --rm -v "$PWD/examples:/app/examples" docu-motion examples/how-it-works --style nuit
FROM node:22-bookworm-slim

# Shared libraries Chrome Headless Shell needs (from Remotion's Docker guide).
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libasound2 \
      libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 \
      libpango-1.0-0 libcairo2 libcups2 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/scenes/package.json packages/scenes/
RUN npm ci

COPY . .
# Download Chrome Headless Shell at build time, not on first render.
RUN npx remotion browser ensure

ENTRYPOINT ["npm", "run", "render", "--"]
CMD ["examples/how-it-works"]

FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
COPY packages ./packages
RUN pnpm install --filter @vork/worker... --frozen-lockfile --ignore-scripts
CMD ["pnpm", "--filter", "@vork/worker", "dev"]

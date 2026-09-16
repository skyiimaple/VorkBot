FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
COPY packages ./packages
RUN pnpm install --filter @vork/api... --frozen-lockfile --ignore-scripts
EXPOSE 3000
CMD ["pnpm", "--filter", "@vork/api", "dev"]

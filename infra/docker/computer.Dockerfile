FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/computer ./apps/computer
COPY packages ./packages
RUN pnpm install --filter @vork/computer... --frozen-lockfile --ignore-scripts
RUN chown -R node:node /app
USER node
EXPOSE 8080
CMD ["pnpm", "--filter", "@vork/computer", "start"]

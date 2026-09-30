FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/computer ./apps/computer
COPY packages ./packages
RUN pnpm install --filter @vork/computer... --frozen-lockfile --ignore-scripts
COPY apps/computer/public ./public
RUN mkdir -p /workspace /browser-profiles \
    && chown -R pwuser:pwuser /app /workspace /browser-profiles
USER pwuser
EXPOSE 8080
CMD ["pnpm", "--filter", "@vork/computer", "start"]

# ---- 构建阶段：只负责生成 client/dist ----
FROM node:24-alpine AS builder

WORKDIR /app

# 先只复制依赖清单，充分利用层缓存
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 前端源码（图标不 COPY 进镜像，运行时挂载宿主目录，供后台上传）
COPY client ./client
RUN npm run build

# ---- 运行阶段：Node 托管静态文件 + API，零运行时 npm 依赖 ----
FROM node:24-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/app/data \
    ICONS_DIR=/app/assets/icons

WORKDIR /app

# 后端是 ESM（type: module），只需要 package.json + server/ + 构建产物
COPY package.json ./
COPY server ./server
COPY --from=builder /app/client/dist ./client/dist

# 运行时数据目录与图标目录（宿主卷需 uid 1000 可写）；非 root 运行
RUN mkdir -p /app/data /app/assets/icons && chown -R node:node /app

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]

# recording —— 语音样本采集服务
#
# 注意：本文件尚未在真实环境构建验证过（开发机上没有 Docker）。
# 首次使用前请自行 `docker build` 确认，详见 README.md 的「Docker」一节。

FROM node:22-bookworm-slim

# ffmpeg 是本服务唯一的重外部依赖：浏览器录出的音频要靠它统一转成 WAV。
#
# 为什么带 Acquire::Retries：ffmpeg 在 Debian 上有近 200 个依赖、要下 120MB，
# 而 deb.debian.org 走 Fastly CDN，偶发 502 会让整层重来一次（实测踩到过：
# 198 个包里挂了 1 个，前功尽弃）。让 apt 自己重试，比人工重跑整个 build 划算。
#
# 装完顺手清掉 apt 缓存，别让镜像白胖几十 MB。
RUN apt-get update -o Acquire::Retries=5 \
    && apt-get install -y --no-install-recommends \
         -o Acquire::Retries=5 \
         ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先装依赖，利用镜像层缓存：只改业务代码时不必重装 node_modules
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 业务代码与静态资源
COPY server/ ./server/
COPY public/ ./public/
COPY content/ ./content/

# 全部配置走环境变量，镜像里不写死任何口令
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

# 数据目录：录音与索引都落在这里，必须挂 volume，否则容器重建数据就没了
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000

# 以非 root 用户运行（node 官方镜像自带 uid 1000 的 node 用户）
RUN chown -R node:node /app/data
USER node

CMD ["node", "server/index.js"]
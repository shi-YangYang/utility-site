# recording —— 语音样本采集服务
#
# 已在 Docker Desktop（macOS arm64）与腾讯云 Ubuntu 服务器实际构建验证；
# 使用说明见 README.md 的「Docker」一节。

FROM node:22-bookworm-slim

# Debian 软件源默认走上游；国内服务器通过构建参数覆盖，避免从 deb.debian.org 慢速下载。
# 覆盖方式：在 recording/.env 里设 APT_MIRROR=mirrors.cloud.tencent.com（见 .env.example）。
ARG APT_MIRROR=deb.debian.org

RUN set -eu; \
    for f in /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; do \
      [ -f "$f" ] || continue; \
      sed -i "s|deb.debian.org|${APT_MIRROR}|g; s|security.debian.org|${APT_MIRROR}|g" "$f"; \
    done

# ffmpeg 是本服务唯一的重外部依赖：浏览器录出的音频要靠它统一转成 WAV。
#
# 为什么带 Acquire::Retries：ffmpeg 在 Debian 上有近 200 个依赖、要下 120MB，
# 偶发 502 会让整层重来一次（实测踩到过：198 个包里挂了 1 个，前功尽弃）。
# 让 apt 自己重试，比人工重跑整个 build 划算。
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
#!/bin/sh
# 全站部署脚本：在仓库根目录执行。
#
# 用法：
#   ./deploy/scripts/deploy.sh <子项目名|proxy|all>
#
# 说明：
#   - 子项目名对应仓库根目录下的文件夹，且该文件夹需有 docker-compose.yml / compose.yml；
#   - proxy 对应 deploy/proxy；
#   - all 会依次部署所有带 compose 的子项目，最后部署代理。
#
# 本脚本不使用、也不读取任何凭据；服务器上的 .env 由使用者自行保管。

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)

compose_file() {
  dir=$1
  if [ -f "$dir/docker-compose.yml" ]; then
    printf '%s\n' "$dir/docker-compose.yml"
  elif [ -f "$dir/compose.yml" ]; then
    printf '%s\n' "$dir/compose.yml"
  else
    return 1
  fi
}

deploy_one() {
  name=$1
  if [ "$name" = "proxy" ]; then
    dir="$ROOT/deploy/proxy"
  else
    dir="$ROOT/$name"
  fi

  if [ ! -d "$dir" ]; then
    echo "目录不存在：$dir" >&2
    exit 1
  fi

  file=$(compose_file "$dir") || {
    echo "找不到 $name 的 compose 文件（$dir）" >&2
    echo "子项目需要自带 docker-compose.yml / compose.yml，见根 AGENTS.md 5.3。" >&2
    exit 1
  }

  echo "==> 部署 $name（$file）"
  docker compose -f "$file" up -d --build
}

case "${1:-}" in
  ""|-h|--help)
    echo "用法: $0 <子项目名|proxy|all>"
    echo "例如: $0 recording"
    ;;
  all)
    for d in "$ROOT"/*/; do
      name=$(basename "$d")
      [ "$name" = "deploy" ] && continue
      if [ -f "$d/docker-compose.yml" ] || [ -f "$d/compose.yml" ]; then
        deploy_one "$name"
      fi
    done
    deploy_one proxy
    ;;
  *)
    deploy_one "$1"
    ;;
esac
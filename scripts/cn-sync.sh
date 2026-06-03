#!/bin/bash
# OpenClaw CN 上游同步脚本
# 使用方法: bash scripts/cn-sync.sh
# 前提: git remote 已配置 (origin=你的fork, upstream=openclaw/openclaw)
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}=== OpenClaw CN 上游同步 ===${NC}"
echo ""

# 1. 检查当前分支
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "cn-main" ]; then
  echo -e "${RED}❌ 当前在 '$BRANCH' 分支，请切换到 cn-main 后再运行${NC}"
  echo "   git checkout cn-main"
  exit 1
fi

# 2. 检查工作区
if [ -n "$(git status --porcelain)" ]; then
  echo -e "${RED}❌ 工作区不干净，请先提交或暂存改动${NC}"
  git status --short
  exit 1
fi

# 3. 抓取上游
echo -e "${GREEN}📡 抓取上游更新...${NC}"
git fetch upstream

# 4. 显示上游新提交
NEW_COUNT=$(git rev-list --count cn-main..upstream/main)
if [ "$NEW_COUNT" -eq 0 ]; then
  echo -e "${GREEN}✅ cn-main 已是最新，无需同步${NC}"
  exit 0
fi

echo ""
echo -e "${YELLOW}📊 上游有 ${NEW_COUNT} 个新提交待合并：${NC}"
git log --oneline cn-main..upstream/main | head -20
echo ""

# 5. 合并
echo -e "${GREEN}🔀 正在合并上游变更...${NC}"
if git merge upstream/main --no-edit -m "merge: 同步上游 $(date +%Y-%m-%d)"; then
  echo -e "${GREEN}✅ 合并成功${NC}"
else
  echo ""
  echo -e "${YELLOW}⚠️  存在冲突，需要手动解决：${NC}"
  git diff --name-only --diff-filter=U
  echo ""
  echo "👉 解决冲突后运行: git add . && git merge --continue"
  echo "👉 然后重新运行本脚本检查翻译完整性"
  exit 1
fi

# 6. 检查翻译完整性
echo ""
echo -e "${GREEN}🔍 检查翻译完整性...${NC}"
node scripts/check-i18n-zh.cjs

# 7. 提示下一步
echo ""
echo -e "${GREEN}✅ 同步完成！${NC}"
echo ""
echo "后续步骤:"
echo "  1. 检查上方翻译完整性报告，如有新增 key 请补充到 zh-CN.ts"
echo "  2. git add ui/src/i18n/locales/zh-CN.ts"
echo "  3. git commit -m 'i18n(zh-CN): 补充上游新增翻译'"
echo "  4. git push origin cn-main"

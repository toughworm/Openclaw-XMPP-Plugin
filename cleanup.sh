#!/bin/bash

echo "=== 开始清理 XMPP 插件相关垃圾文件 ==="

# 1. 清理 npm 全局缓存 (这是最占空间的)
echo "[1/4] 清理 npm 全局缓存..."
npm cache clean --force

# 2. 清理 OpenClaw 日志 (包含之前的明文调试日志)
LOG_DIR="$HOME/.openclaw/logs"
if [ -d "$LOG_DIR" ]; then
    echo "[2/4] 清理 OpenClaw 日志文件..."
    # 仅删除日志文件，保留目录
    rm -f "$LOG_DIR"/*.log
    rm -f "$LOG_DIR"/*.log.*
    echo "  - 已删除: $LOG_DIR 下的所有日志"
else
    echo "[2/4] 未找到日志目录，跳过。"
fi

# 3. 清理系统临时目录下的 npm 相关文件
echo "[3/4] 清理系统临时文件..."
rm -rf /tmp/npm-* 2>/dev/null
rm -rf /tmp/v8-compile-cache-* 2>/dev/null

# 4. (可选) 清理插件目录下的 node_modules
XMPP_DIR="$HOME/.openclaw/extensions/xmpp"
echo "[4/4] 检查插件目录: $XMPP_DIR"
if [ -d "$XMPP_DIR/node_modules" ]; then
    # 自动判断：如果用户只是想清理垃圾，保留 node_modules 是可以的。
    # 但如果用户觉得 node_modules 也有问题，可以清理。
    # 这里为了安全起见，只提示位置，或者提供参数。
    # 考虑到是自动化脚本，不进行交互。
    echo "  - 提示: node_modules 目录占用空间较大 ($XMPP_DIR/node_modules)。"
    echo "  - 如果你想彻底重置，请手动运行: rm -rf \"$XMPP_DIR/node_modules\" 然后重新运行安装脚本。"
fi

echo "=== 清理完成 ==="

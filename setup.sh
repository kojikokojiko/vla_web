#!/usr/bin/env bash
set -e

echo "=== VLA Pick&Place Simulator セットアップ ==="

# Frontend
echo ""
echo "--- Frontend (Node.js) ---"
cd frontend
npm install
echo "✅ frontend 依存関係インストール完了"
cd ..

echo ""
echo "=== 起動方法 ==="
echo "Backend:  docker compose up --build"
echo "Frontend: cd frontend && npm run dev"
echo ""
echo "ブラウザ: http://localhost:5173"
echo "API:     http://localhost:8000/docs"

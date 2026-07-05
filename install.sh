#!/usr/bin/env bash
set -e

echo "Installing htmlng..."

npm install
npm run build
npm link

echo ""
echo "htmlng installed. Run 'htmlng --help' to get started."

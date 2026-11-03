#!/bin/sh
set -e

echo "[fake-s3-init] Waiting for MinIO service at http://fake-s3:9000..."
until curl -sf http://fake-s3:9000/minio/health/live; do
  echo "[fake-s3-init] MinIO is starting - waiting 1s..."
  sleep 1
done

echo "[fake-s3-init] MinIO is ready. Setting up mc client alias..."
mc alias set myminio http://fake-s3:9000 minioadmin minioadmin

echo "[fake-s3-init] Creating public bucket 'megacorp-backup'..."
mc mb --ignore-existing myminio/megacorp-backup

echo "[fake-s3-init] Setting anonymous download policy for 'megacorp-backup'..."
mc anonymous set download myminio/megacorp-backup

echo "[fake-s3-init] Seeding sample confidential files..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$SCRIPT_DIR/config.env" ]; then
  mc cp "$SCRIPT_DIR/config.env" myminio/megacorp-backup/config.env
fi

if [ -f "$SCRIPT_DIR/db_passwords.txt" ]; then
  mc cp "$SCRIPT_DIR/db_passwords.txt" myminio/megacorp-backup/db_passwords.txt
fi

echo "[fake-s3-init] Bucket initialization completed successfully."
mc ls myminio/megacorp-backup

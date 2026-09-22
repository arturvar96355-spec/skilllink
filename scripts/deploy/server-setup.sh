#!/usr/bin/env bash
# Подготовка чистой Ubuntu к запуску стенда. Выполняется на сервере:
#   ssh <логин@адрес> 'bash -s' < scripts/deploy/server-setup.sh
#
# Запускается при каждом развёртывании и ничего не делает повторно, если всё уже есть.
set -euo pipefail

echo "── Проверяю Docker"
if ! command -v docker > /dev/null; then
  echo "   ставлю docker.io и docker-compose-v2 (пакеты Ubuntu, зеркало внутри Yandex Cloud)"
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io docker-compose-v2 > /dev/null
else
  echo "   уже стоит: $(docker --version)"
fi

if ! docker compose version > /dev/null 2>&1; then
  echo "   ставлю docker-compose-v2"
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-compose-v2 > /dev/null
fi

sudo systemctl enable --now docker > /dev/null 2>&1 || true

if ! groups | grep -qw docker; then
  echo "── Добавляю $USER в группу docker"
  sudo usermod -aG docker "$USER"
  echo "   группа применится к следующему входу — развёртывание это учитывает"
fi

# Сборка Next.js на машине с 2 ГБ памяти падает без подкачки, причём не сразу,
# а в середине, с невнятной ошибкой. Два гигабайта подкачки это снимают.
if [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
  echo "── Включаю подкачку 2 ГБ"
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap -q /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
else
  echo "── Подкачка уже есть: $(swapon --show=NAME,SIZE --noheadings | tr '\n' ' ')"
fi

echo "── Сервер готов"

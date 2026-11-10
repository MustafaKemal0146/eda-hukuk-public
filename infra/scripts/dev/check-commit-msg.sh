#!/usr/bin/env bash
# Commit mesajı biçimi (004 §6.2). Kullanım: check-commit-msg.sh <mesaj-dosyası>
set -euo pipefail
export LC_ALL=C.UTF-8

file="${1:?kullanım: check-commit-msg.sh <mesaj-dosyası>}"
readonly TYPES='feat|fix|refactor|perf|test|docs|build|ci|chore'
readonly SCOPES='web admin api worker jobs yargi-mcp doc-engine contracts db ai kvkk legal editor ui email observability config crypto billing api-client evals e2e infra compose caddy ci deps repo canon adr runbook agent'

fail() { echo "commit-msg: $1" >&2; exit 1; }

# Git'in yorum satırlarını ve sondaki boşlukları at.
msg="$(grep -v '^#' "$file" | sed -e 's/[[:space:]]*$//')"
subject="$(printf '%s\n' "$msg" | head -n1)"

# Birleştirme ve geri alma commit'leri git'in kendi biçimini kullanır.
[[ "$subject" =~ ^(Merge|Revert)\  ]] && exit 0

[[ "$subject" =~ ^($TYPES)\(([a-z0-9-]+)\)(!)?:\ (.+)$ ]] || fail "biçim <tip>(<kapsam>)[!]: <özet> olmalı: \"$subject\""
scope="${BASH_REMATCH[2]}"
summary="${BASH_REMATCH[4]}"
[[ " $SCOPES " == *" $scope "* ]] || fail "bilinmeyen kapsam: $scope"
(( ${#subject} <= 72 )) || fail "ilk satır en çok 72 karakter (şu an ${#subject})"
[[ "$summary" != *. ]] || fail "özet nokta ile bitmez"
if printf '%s' "$msg" | grep -qP '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{FE0F}]'; then fail "emoji yasak"; fi
if printf '%s' "$summary" | grep -qiE '^(add|adds|added|fix|fixes|fixed|update|updated|remove|removed|bump|initial)\b'; then
  fail "özet Türkçe olmalı (geçmiş zaman edilgen: \"eklendi\", \"düzeltildi\")"
fi

# Trailer biçimleri
while IFS= read -r line; do
  case "$line" in
    Prompt:*) [[ "$line" =~ ^Prompt:\ P[0-9]{2}[a-d]?(\.[a-d])?$ ]] || fail "biçimsiz trailer: $line" ;;
    Task:*) [[ "$line" =~ ^Task:\ P[0-9]{2}[a-d]?\.[0-9]{1,2}[a-z]?$ ]] || fail "biçimsiz trailer: $line" ;;
    Open-Question:*) [[ "$line" =~ ^Open-Question:\ AS-[0-9]{4}$ ]] || fail "biçimsiz trailer: $line" ;;
  esac
done <<< "$msg"
exit 0

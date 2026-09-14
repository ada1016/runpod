.DEFAULT_GOAL := help

GIT_ROOT := $(CURDIR)
REPO_NAME := $(notdir $(GIT_ROOT))

.PHONY: help git-status git-pull git-push

help: ## Show available Git commands
	@awk 'BEGIN {FS = ":.*## "; printf "\nAvailable commands:\n\n"} \
		/^[A-Za-z0-9_-]+:.*## / {printf "  %-15s %s\n", $$1, $$2}' \
		"$(firstword $(MAKEFILE_LIST))"
	@echo

git-status: ## Show status for the entire repository
	git -C "$(GIT_ROOT)" status --short

git-pull: ## Pull repository updates using fast-forward only
	@test -d "$(GIT_ROOT)/.git" || { \
		echo "[-] Not a Git repository root: $(GIT_ROOT)"; \
		exit 1; \
	}
	@test -z "$$(git -C "$(GIT_ROOT)" status --porcelain)" || { \
		echo "[-] Working tree contains uncommitted changes."; \
		echo "[*] Commit or stash them before pulling."; \
		exit 1; \
	}
	git -C "$(GIT_ROOT)" pull --ff-only

git-push: ## Commit all repository changes with an automatic message and push
	@set -e; \
	test -d "$(GIT_ROOT)/.git" || { \
		echo "[-] Not a Git repository root: $(GIT_ROOT)"; \
		exit 1; \
	}; \
	MESSAGE="$(REPO_NAME) update $$(date '+%Y-%m-%d %H:%M:%S')"; \
	echo "[+] Commit message: $$MESSAGE"; \
	git -C "$(GIT_ROOT)" add -A -- .; \
	if git -C "$(GIT_ROOT)" diff --cached --quiet; then \
		echo "[*] No repository changes to commit."; \
		exit 0; \
	fi; \
	git -C "$(GIT_ROOT)" commit -m "$$MESSAGE"; \
	git -C "$(GIT_ROOT)" push

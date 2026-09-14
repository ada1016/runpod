PROJECT := ls
AGENT := legendsummoner

.DEFAULT_GOAL := help

RUNPOD_ROOT := $(abspath $(CURDIR)/..)
FRIDA_DIR := $(RUNPOD_ROOT)/frida
TOOLS_ROOT ?= $(HOME)/Documents/frida-js-tools

TS_FILE := $(CURDIR)/$(AGENT).ts
JS_FILE := $(CURDIR)/$(AGENT).js
HOOK_CONFIG := $(CURDIR)/hook_pid.json

INSTALLER := $(FRIDA_DIR)/install-frida-environment.sh
BUILD_SCRIPT := $(FRIDA_DIR)/build.sh
HOOK_SCRIPT := $(FRIDA_DIR)/hook.sh

FRIDA := $(TOOLS_ROOT)/python-env/bin/frida
FRIDA_PS := $(TOOLS_ROOT)/python-env/bin/frida-ps
COMPILER := $(TOOLS_ROOT)/node_modules/.bin/frida-compile
IL2CPP_BRIDGE := $(TOOLS_ROOT)/node_modules/frida-il2cpp-bridge

.PHONY: help all setup ensure-env check build hook run rebuild clean \
	git-status git-pull git-push

help: ## Show all available Make commands
	@awk 'BEGIN {FS = ":.*## "; printf "\nAvailable commands:\n\n"} \
		/^[A-Za-z0-9_-]+:.*## / {printf "  %-15s %s\n", $$1, $$2}' \
		"$(firstword $(MAKEFILE_LIST))"
	@echo

all: build ## Build the agent when required

setup: ## Install or update the shared Frida environment
	"$(INSTALLER)"

# Automatically install only when a required shared component is missing.
ensure-env: ## Check and repair the shared Frida environment
	@if [ ! -x "$(FRIDA)" ] || \
	    [ ! -x "$(FRIDA_PS)" ] || \
	    [ ! -x "$(COMPILER)" ] || \
	    [ ! -d "$(IL2CPP_BRIDGE)" ]; then \
		echo "[*] Shared Frida environment is incomplete; installing..."; \
		"$(INSTALLER)"; \
	else \
		echo "[+] Shared Frida environment is ready"; \
	fi

check: ## Validate project files and central scripts
	@test -f "$(TS_FILE)" || { \
		echo "[-] TypeScript source not found: $(TS_FILE)"; \
		exit 1; \
	}
	@test -f "$(HOOK_CONFIG)" || { \
		echo "[-] Hook configuration not found: $(HOOK_CONFIG)"; \
		exit 1; \
	}
	@test -x "$(BUILD_SCRIPT)" || { \
		echo "[-] Build helper is not executable: $(BUILD_SCRIPT)"; \
		exit 1; \
	}
	@test -x "$(HOOK_SCRIPT)" || { \
		echo "[-] Hook helper is not executable: $(HOOK_SCRIPT)"; \
		exit 1; \
	}

# Make rebuilds this target only when the TS source is newer or JS is missing.
$(JS_FILE): $(TS_FILE)
	"$(BUILD_SCRIPT)" "$(PROJECT)" "$(TS_FILE)"

build: ensure-env check $(JS_FILE) ## Build the JavaScript agent when required
	@echo "[+] Agent ready: $(JS_FILE)"

# Attach using the existing compiled JavaScript.
hook: ensure-env check ## Hook using the existing JavaScript agent
	@test -f "$(JS_FILE)" || { \
		echo "[-] Compiled agent not found: $(JS_FILE)"; \
		echo "[*] Run: make build"; \
		exit 1; \
	}
	"$(HOOK_SCRIPT)" "$(JS_FILE)"

# Build when needed, then attach and execute hook_pid.json default_hook.
run: build ## Build when required, then hook the game
	"$(HOOK_SCRIPT)" "$(JS_FILE)"

# Force regeneration of the compiled JavaScript.
rebuild: clean build ## Force a clean rebuild

# Remove only the generated JavaScript agent.
clean: ## Remove the generated JavaScript agent
	@rm -f "$(JS_FILE)"
	@echo "[+] Removed generated agent: $(JS_FILE)"

GIT_ROOT := $(RUNPOD_ROOT)

git-status: ## Show Git changes under this project
	git -C "$(GIT_ROOT)" status --short -- "$(CURDIR)"

git-pull: ## Pull repository updates using fast-forward only
	@test -z "$$(git -C "$(GIT_ROOT)" status --porcelain)" || { \
		echo "[-] Working tree contains uncommitted changes."; \
		echo "[*] Commit or stash them before pulling."; \
		exit 1; \
	}
	git -C "$(GIT_ROOT)" pull --ff-only

git-push: ## Commit this project with an automatic message and push
	@set -e; \
	FOLDER_NAME="$(notdir $(CURDIR))"; \
	MESSAGE="$$FOLDER_NAME update $$(date '+%Y-%m-%d %H:%M:%S')"; \
	echo "[+] Commit message: $$MESSAGE"; \
	git -C "$(GIT_ROOT)" add -- "$(CURDIR)"; \
	if git -C "$(GIT_ROOT)" diff --cached --quiet -- "$(CURDIR)"; then \
		echo "[*] No changes under $$FOLDER_NAME to commit."; \
		exit 0; \
	fi; \
	git -C "$(GIT_ROOT)" commit -m "$$MESSAGE" -- "$(CURDIR)"; \
	git -C "$(GIT_ROOT)" push

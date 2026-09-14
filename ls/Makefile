PROJECT := ls
AGENT := legendsummoner

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

.PHONY: all setup ensure-env check build hook run rebuild clean

# Plain "make" verifies the environment and builds only when required.
all: build

# Force installation/update of the shared environment.
setup:
	"$(INSTALLER)"

# Automatically install only when a required shared component is missing.
ensure-env:
	@if [ ! -x "$(FRIDA)" ] || \
	    [ ! -x "$(FRIDA_PS)" ] || \
	    [ ! -x "$(COMPILER)" ] || \
	    [ ! -d "$(IL2CPP_BRIDGE)" ]; then \
		echo "[*] Shared Frida environment is incomplete; installing..."; \
		"$(INSTALLER)"; \
	else \
		echo "[+] Shared Frida environment is ready"; \
	fi

check:
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

build: ensure-env check $(JS_FILE)
	@echo "[+] Agent ready: $(JS_FILE)"

# Attach using the existing compiled JavaScript.
hook: ensure-env check
	@test -f "$(JS_FILE)" || { \
		echo "[-] Compiled agent not found: $(JS_FILE)"; \
		echo "[*] Run: make build"; \
		exit 1; \
	}
	"$(HOOK_SCRIPT)" "$(JS_FILE)"

# Build when needed, then attach and execute hook_pid.json default_hook.
run: build
	"$(HOOK_SCRIPT)" "$(JS_FILE)"

# Force regeneration of the compiled JavaScript.
rebuild: clean build

# Remove only the generated JavaScript agent.
clean:
	@rm -f "$(JS_FILE)"
	@echo "[+] Removed generated agent: $(JS_FILE)"

.PHONY: git-status git-pull git-push

GIT_ROOT := $(RUNPOD_ROOT)

git-status:
	git -C "$(GIT_ROOT)" status --short -- "$(CURDIR)"

git-pull:
	@test -z "$$(git -C "$(GIT_ROOT)" status --porcelain)" || { \
		echo "[-] Working tree contains uncommitted changes."; \
		echo "[*] Commit or stash them before pulling."; \
		exit 1; \
	}
	git -C "$(GIT_ROOT)" pull --ff-only

git-push:
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
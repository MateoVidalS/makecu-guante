ifeq ($(OS),Windows_NT)
PYTHON ?= python
else
PYTHON ?= python3
endif

.PHONY: setup dev dev-sim dev-camera dev-mock test lint typecheck e2e fw-build fw-flash build demo demo-seed

setup:
	cd backend && uv sync --locked
	cd frontend && pnpm install --frozen-lockfile
	@if command -v pio >/dev/null 2>&1; then \
	  if [ -f firmware/platformio.ini ]; then pio pkg install -d firmware; else echo "PlatformIO config pending WP1; skipping firmware setup."; fi; \
	else echo "PlatformIO not installed; skipping firmware setup."; fi

dev:
	$(PYTHON) scripts/dev.py

dev-sim:
	VITE_SIM=1 $(PYTHON) scripts/dev.py

dev-camera:
	VITE_SIM=1 VITE_VISION=camera $(PYTHON) scripts/dev.py

dev-mock:
	cd frontend && VITE_MOCK_API=1 VITE_SIM=1 pnpm dev

test:
	cd backend && uv run pytest -q
	cd frontend && pnpm test --run
	$(MAKE) typecheck lint
	@if command -v pio >/dev/null 2>&1; then \
	  if [ -f firmware/platformio.ini ]; then pio test -d firmware -e native; else echo "PlatformIO config pending WP1; skipping firmware tests."; fi; \
	else echo "PlatformIO not installed; skipping firmware tests."; fi

lint:
	cd backend && uv run ruff check . && uv run ruff format --check .
	cd frontend && pnpm lint

typecheck:
	cd frontend && pnpm typecheck

e2e:
	cd frontend && pnpm e2e

fw-build:
	@if command -v pio >/dev/null 2>&1; then \
	  if [ -f firmware/platformio.ini ]; then pio run -d firmware -e esp32dev; else echo "PlatformIO config pending WP1; skipping firmware build."; fi; \
	else echo "PlatformIO not installed; skipping firmware build."; fi

fw-flash:
	@if command -v pio >/dev/null 2>&1; then \
	  if [ -f firmware/platformio.ini ]; then pio run -d firmware -e esp32dev -t upload; else echo "PlatformIO config pending WP1; skipping firmware flash."; fi; \
	else echo "PlatformIO not installed; skipping firmware flash."; fi

build:
	cd frontend && pnpm build

demo: build
	cd backend && uv run python -m app

# Opt-in only; DEMO_SEED_ARGS=--reset replaces flagged demo history.
demo-seed:
	cd backend && uv run python -m tools.seed_demo $(DEMO_SEED_ARGS)

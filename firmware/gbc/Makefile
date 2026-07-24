GBDK_HOME          ?= $(GBDK)
LCC                := $(GBDK_HOME)/bin/lcc
AUTOTEST           ?= 0
AUTOTEST_LOGIC_ONLY ?= 0
PERF_BENCH         ?= 0
PERF_WIDE          ?= 0
PERF_PHASES        ?= 0
PERF_SCHEDULES     ?= 0
TARGET             := $(if $(filter 1 yes true on,$(AUTOTEST)),puzzlescript_gbc_autotest,puzzlescript_gbc)
PERF_SUFFIX        := $(if $(filter 1 yes true on,$(PERF_BENCH)),-perf$(if $(filter 1 yes true on,$(PERF_WIDE)),-wide,-compact)$(if $(filter 1 yes true on,$(PERF_PHASES)),-phases,$(if $(filter 1 yes true on,$(PERF_SCHEDULES)),-schedules,)),)
TARGET             := $(TARGET)$(PERF_SUFFIX)
BUILD              := $(if $(filter 1 yes true on,$(AUTOTEST)),build-autotest,build)$(PERF_SUFFIX)
GENERATED          := generated
GAME               ?= ../../src/demo/sokoban_basic.txt
PUZZLESCRIPT_CPP   ?= ../../build/native/Release/puzzlescript_cpp.exe
PYTHON             ?= python3
EXPORT_GBC_FLAGS   ?=

SPECIALIZED_SRC    := $(GENERATED)/generated_specialized_turn.c
SPECIALIZED_SRCS   := $(wildcard $(GENERATED)/generated_specialized_turn*.c)
HAS_SPECIALIZED    := $(shell test -f $(SPECIALIZED_SRC) && echo 1)
SPECIALIZED_CFLAGS := $(if $(HAS_SPECIALIZED),-DPS_GBC_HAS_SPECIALIZED_TURN=1,)

CFLAGS := -msm83:gb -I$(GENERATED) -I../../native/include -I../../native/src/gbc -DPS_GBC_FREESTANDING=1
CFLAGS += -DPS_GBC_GENERATED_BUILD=1
CFLAGS += -Wf--max-allocs-per-node50000
ifneq ($(filter 1 yes true on,$(AUTOTEST)),)
CFLAGS += -DPS_GBC_AUTOTEST=1
endif
ifneq ($(filter 1 yes true on,$(AUTOTEST_LOGIC_ONLY)),)
CFLAGS += -DPS_GBC_AUTOTEST_LOGIC_ONLY=1
endif
ifneq ($(filter 1 yes true on,$(PERF_BENCH)),)
CFLAGS += -DPS_GBC_PERF_BENCH=1
endif
ifneq ($(filter 1 yes true on,$(PERF_WIDE)),)
CFLAGS += -DPS_GBC_BENCH_WIDE_MOVEMENTS=1
endif
ifneq ($(filter 1 yes true on,$(PERF_PHASES)),)
CFLAGS += -DPS_GBC_PERF_PHASES=1
endif
ifneq ($(filter 1 yes true on,$(PERF_SCHEDULES)),)
CFLAGS += -DPS_GBC_PERF_SCHEDULES=1
endif
LDFLAGS := -msm83:gb -Wm-yC -Wm-yt0x1B -Wm-yo32 -Wm-ya4 -Wm-ynPUZZLESCRIPT -Wl-m
PERF_OBJECTS := $(if $(filter 1 yes true on,$(PERF_BENCH)),$(BUILD)/benchmark.o,)
AUTOTEST_OBJECTS := $(if $(filter 1 yes true on,$(AUTOTEST)),$(BUILD)/autotest.o,)
OBJECTS := $(BUILD)/main.o $(BUILD)/core.o $(BUILD)/generated_game.o \
	$(BUILD)/audio.o $(BUILD)/text.o $(BUILD)/tile_cache.o \
	$(BUILD)/frontend_flow.o \
	$(PERF_OBJECTS) $(AUTOTEST_OBJECTS)
SPECIALIZED_OBJECTS := $(if $(HAS_SPECIALIZED),$(patsubst $(GENERATED)/%.c,$(BUILD)/%.o,$(SPECIALIZED_SRCS)),)
FACADE_OBJECTS := $(if $(HAS_SPECIALIZED),$(BUILD)/compact_facade.o $(BUILD)/facade_rules.o,)
LINK_OBJECTS := $(OBJECTS) $(FACADE_OBJECTS) $(SPECIALIZED_OBJECTS)

.PHONY: all export clean check-size build-rom

all:
	$(MAKE) export
	$(MAKE) build-rom

# Size gate: if the specialized-turn bank (16 KiB) or total ROM (512 KiB) fails,
# drop generated_specialized_turn.c and relink the interpreter-only cartridge.
build-rom: $(TARGET).gb
	@set -e; \
	if "$(PYTHON)" ../../scripts/check_gbc_rom.py \
		$(TARGET).gb $(GENERATED)/gbc_manifest.json $(TARGET).map; then \
		exit 0; \
	fi; \
	if [ ! -f $(SPECIALIZED_SRC) ]; then \
		exit 1; \
	fi; \
	echo "gbc: size check failed with specialized turn; falling back to interpreter"; \
	rm -f $(GENERATED)/generated_specialized_turn*.c; \
	rm -f $(GENERATED)/generated_specialized_shared.h; \
	rm -f $(GENERATED)/specialized_sources.list; \
	rm -f $(BUILD)/generated_specialized_turn*.o \
		$(BUILD)/compact_facade.o \
		$(BUILD)/facade_rules.o \
		$(BUILD)/core.o \
		$(TARGET).gb \
		$(TARGET).map \
		$(TARGET).ihx \
		$(TARGET).noi \
		$(TARGET).sym; \
	"$(PYTHON)" ../../scripts/gbc_manifest_disable_specialized.py \
		$(GENERATED)/gbc_manifest.json \
		--reason linked_rom_bank_or_total_over_budget; \
	$(MAKE) $(TARGET).gb SKIP_EXPORT=1; \
	"$(PYTHON)" ../../scripts/check_gbc_rom.py \
		$(TARGET).gb $(GENERATED)/gbc_manifest.json $(TARGET).map

check-size: $(TARGET).gb
	"$(PYTHON)" ../../scripts/check_gbc_rom.py \
		$(TARGET).gb $(GENERATED)/gbc_manifest.json $(TARGET).map

export:
ifeq ($(filter 1 yes true on,$(SKIP_EXPORT)),)
	@mkdir -p $(GENERATED)
	"$(PUZZLESCRIPT_CPP)" export-gbc "$(GAME)" --out $(GENERATED) $(EXPORT_GBC_FLAGS)
else
	@test -f $(GENERATED)/generated_game.c
	@test -f $(GENERATED)/generated_game.h
	@test -f $(GENERATED)/gbc_manifest.json
endif

$(BUILD):
	@mkdir -p $(BUILD)

$(BUILD)/main.o: source/main.c source/audio.h source/text.h $(GENERATED)/generated_game.h | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/core.o: ../../native/src/gbc/core.c \
	../../native/src/gbc/session_internal.h \
	../../native/include/puzzlescript/gbc.h \
	$(GENERATED)/generated_game.h \
	$(if $(HAS_SPECIALIZED),$(SPECIALIZED_SRC),) | $(BUILD)
	"$(LCC)" $(CFLAGS) $(SPECIALIZED_CFLAGS) -c -o $@ $<

$(BUILD)/generated_specialized_turn.o: $(GENERATED)/generated_specialized_turn.c \
	../../native/src/gbc/specialized_turn.h \
	../../native/include/puzzlescript/gbc_compact_facade.h \
	../../native/include/puzzlescript/gbc_facade_rules.h \
	$(wildcard $(GENERATED)/generated_specialized_shared.h) \
	$(GENERATED)/generated_game.h | $(BUILD)
	"$(LCC)" $(CFLAGS) -DPS_GBC_HAS_SPECIALIZED_TURN=1 -c -o $@ $<

$(BUILD)/generated_specialized_turn_rules_%.o: $(GENERATED)/generated_specialized_turn_rules_%.c \
	../../native/src/gbc/specialized_turn.h \
	../../native/include/puzzlescript/gbc_compact_facade.h \
	../../native/include/puzzlescript/gbc_facade_rules.h \
	$(wildcard $(GENERATED)/generated_specialized_shared.h) \
	$(GENERATED)/generated_game.h | $(BUILD)
	"$(LCC)" $(CFLAGS) -DPS_GBC_HAS_SPECIALIZED_TURN=1 -c -o $@ $<

$(BUILD)/compact_facade.o: ../../native/src/gbc/compact_facade.c \
	../../native/include/puzzlescript/gbc_compact_facade.h \
	../../native/src/gbc/session_internal.h \
	$(GENERATED)/generated_game.h | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/facade_rules.o: ../../native/src/gbc/facade_rules.c \
	../../native/include/puzzlescript/gbc_facade_rules.h \
	../../native/include/puzzlescript/gbc_compact_facade.h \
	../../native/src/gbc/session_internal.h \
	$(GENERATED)/generated_game.h | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/generated_game.o: $(GENERATED)/generated_game.c $(GENERATED)/generated_game.h | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/audio.o: source/audio.c source/audio.h $(GENERATED)/generated_game.h | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/frontend_flow.o: source/frontend_flow.c source/frontend_flow.h | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/autotest.o: source/autotest.c source/audio.h source/text.h source/tile_cache.h $(GENERATED)/generated_game.h | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/text.o: source/text.c source/text.h $(GENERATED)/generated_game.h | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/benchmark.o: source/benchmark.c source/benchmark.h source/text.h $(GENERATED)/generated_game.h | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/tile_cache.o: source/tile_cache.c source/tile_cache.h $(GENERATED)/generated_game.h | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(TARGET).gb: $(LINK_OBJECTS)
	"$(LCC)" $(LDFLAGS) -o $@ $(LINK_OBJECTS)

clean:
	@rm -rf build build-autotest build*-perf-* $(GENERATED) puzzlescript_gbc.gb puzzlescript_gbc_autotest.gb
	@rm -f puzzlescript_gbc*-perf-*.gb puzzlescript_gbc*-perf-*.ihx
	@rm -f puzzlescript_gbc*-perf-*.map puzzlescript_gbc*-perf-*.noi puzzlescript_gbc*-perf-*.sym
	@rm -f puzzlescript_gbc.map puzzlescript_gbc.noi puzzlescript_gbc.sym
	@rm -f puzzlescript_gbc_autotest.map puzzlescript_gbc_autotest.noi puzzlescript_gbc_autotest.sym

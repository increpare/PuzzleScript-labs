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
EXPORT_STAMP       := $(GENERATED)/gbc_manifest.json
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
	$(BUILD)/frontend_flow.o $(BUILD)/bank_access.o \
	$(BUILD)/game_dispatch.o \
	$(PERF_OBJECTS) $(AUTOTEST_OBJECTS)
FACADE_OBJECTS := $(BUILD)/compact_facade.o $(BUILD)/facade_rules.o

$(TARGET).gb: $(EXPORT_STAMP) $(OBJECTS) | $(BUILD)
	@set -e; \
	extra_objs=; \
	if [ -f $(GENERATED)/specialized_sources.list ]; then \
	  "$(LCC)" $(CFLAGS) -c -o $(BUILD)/compact_facade.o ../../native/src/gbc/compact_facade.c; \
	  "$(LCC)" $(CFLAGS) -c -o $(BUILD)/facade_rules.o ../../native/src/gbc/facade_rules.c; \
	  extra_objs="$(FACADE_OBJECTS)"; \
	  while IFS= read -r src; do \
	    [ -n "$$src" ] || continue; \
	    case "$$src" in *.c) ;; *) continue ;; esac; \
	    obj="$(BUILD)/$$(basename $$src .c).o"; \
	    "$(LCC)" $(CFLAGS) -DPS_GBC_HAS_SPECIALIZED_TURN=1 -c -o "$$obj" "$(GENERATED)/$$src"; \
	    extra_objs="$$extra_objs $$obj"; \
	  done < $(GENERATED)/specialized_sources.list; \
	fi; \
	"$(LCC)" $(LDFLAGS) -o $@ $(OBJECTS) $$extra_objs

.PHONY: all export clean check-size build-rom

all: $(TARGET).gb

# Size gate: specialized bank (16 KiB) and total ROM (512 KiB) must pass.
build-rom: $(TARGET).gb
	"$(PYTHON)" ../../scripts/check_gbc_rom.py \
		$(TARGET).gb $(GENERATED)/gbc_manifest.json $(TARGET).map

check-size: $(TARGET).gb
	"$(PYTHON)" ../../scripts/check_gbc_rom.py \
		$(TARGET).gb $(GENERATED)/gbc_manifest.json $(TARGET).map

export: $(EXPORT_STAMP)

$(EXPORT_STAMP):
ifeq ($(filter 1 yes true on,$(SKIP_EXPORT)),)
	@mkdir -p $(GENERATED) $(BUILD)
	"$(PUZZLESCRIPT_CPP)" export-gbc "$(GAME)" --out $(GENERATED) $(EXPORT_GBC_FLAGS)
else
	@test -f $(GENERATED)/generated_game.c
	@test -f $(GENERATED)/generated_game.h
	@test -f $(EXPORT_STAMP)
endif

$(BUILD):
	@mkdir -p $(BUILD)

$(BUILD)/main.o: source/main.c source/audio.h source/game_dispatch.h \
	source/text.h $(EXPORT_STAMP) | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/core.o: ../../native/src/gbc/core.c \
	../../native/src/gbc/session_internal.h \
	../../native/include/puzzlescript/gbc.h \
	$(EXPORT_STAMP) | $(BUILD)
	"$(LCC)" $(CFLAGS) $$(test -f $(SPECIALIZED_SRC) && echo -DPS_GBC_HAS_SPECIALIZED_TURN=1) -c -o $@ $<

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
	$(EXPORT_STAMP) | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/facade_rules.o: ../../native/src/gbc/facade_rules.c \
	../../native/include/puzzlescript/gbc_facade_rules.h \
	../../native/include/puzzlescript/gbc_compact_facade.h \
	../../native/src/gbc/session_internal.h \
	$(EXPORT_STAMP) | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/generated_game.o: $(GENERATED)/generated_game.c \
	../../native/include/puzzlescript/gbc_descriptor.h \
	$(EXPORT_STAMP) | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/audio.o: source/audio.c source/audio.h source/game_dispatch.h $(EXPORT_STAMP) | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/frontend_flow.o: source/frontend_flow.c source/frontend_flow.h | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/bank_access.o: ../../native/src/gbc/bank_access.c \
	../../native/include/puzzlescript/gbc_bank_access.h | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/game_dispatch.o: source/game_dispatch.c source/game_dispatch.h \
	../../native/include/puzzlescript/gbc_bank_access.h \
	../../native/include/puzzlescript/gbc_descriptor.h | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/autotest.o: source/autotest.c source/audio.h source/text.h source/tile_cache.h $(EXPORT_STAMP) | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/text.o: source/text.c source/text.h source/game_dispatch.h $(EXPORT_STAMP) | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/benchmark.o: source/benchmark.c source/benchmark.h source/text.h $(EXPORT_STAMP) | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/tile_cache.o: source/tile_cache.c source/tile_cache.h source/game_dispatch.h $(EXPORT_STAMP) | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

clean:
	@rm -rf build build-autotest build*-perf-* $(GENERATED) puzzlescript_gbc.gb puzzlescript_gbc_autotest.gb
	@rm -f puzzlescript_gbc*-perf-*.gb puzzlescript_gbc*-perf-*.ihx
	@rm -f puzzlescript_gbc*-perf-*.map puzzlescript_gbc*-perf-*.noi puzzlescript_gbc*-perf-*.sym
	@rm -f puzzlescript_gbc.map puzzlescript_gbc.noi puzzlescript_gbc.sym
	@rm -f puzzlescript_gbc_autotest.map puzzlescript_gbc_autotest.noi puzzlescript_gbc_autotest.sym

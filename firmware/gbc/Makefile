GBDK_HOME          ?= $(GBDK)
LCC                := $(GBDK_HOME)/bin/lcc
AUTOTEST           ?= 0
PERF_BENCH         ?= 0
PERF_WIDE          ?= 0
PERF_PHASES        ?= 0
TARGET             := $(if $(filter 1 yes true on,$(AUTOTEST)),puzzlescript_gbc_autotest,puzzlescript_gbc)
PERF_SUFFIX        := $(if $(filter 1 yes true on,$(PERF_BENCH)),-perf$(if $(filter 1 yes true on,$(PERF_WIDE)),-wide,-compact)$(if $(filter 1 yes true on,$(PERF_PHASES)),-phases,),)
TARGET             := $(TARGET)$(PERF_SUFFIX)
BUILD              := $(if $(filter 1 yes true on,$(AUTOTEST)),build-autotest,build)$(PERF_SUFFIX)
GENERATED          := generated
GAME               ?= ../../src/demo/sokoban_basic.txt
PUZZLESCRIPT_CPP   ?= ../../build/native/Release/puzzlescript_cpp.exe
PYTHON             ?= python

CFLAGS := -msm83:gb -I$(GENERATED) -I../../native/include -DPS_GBC_FREESTANDING=1
CFLAGS += -DPS_GBC_GENERATED_BUILD=1
CFLAGS += -Wf--max-allocs-per-node50000
ifneq ($(filter 1 yes true on,$(AUTOTEST)),)
CFLAGS += -DPS_GBC_AUTOTEST=1
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
LDFLAGS := -msm83:gb -Wm-yC -Wm-yt0x1B -Wm-yo8 -Wm-ya4 -Wm-ynPUZZLESCRIPT -Wl-m
PERF_OBJECTS := $(if $(filter 1 yes true on,$(PERF_BENCH)),$(BUILD)/benchmark.o,)
OBJECTS := $(BUILD)/main.o $(BUILD)/core.o $(BUILD)/generated_game.o \
	$(BUILD)/tile_cache.o $(PERF_OBJECTS)

.PHONY: all export clean check-size

all: export $(TARGET).gb check-size

export:
	@mkdir -p $(GENERATED)
	"$(PUZZLESCRIPT_CPP)" export-gbc "$(GAME)" --out $(GENERATED)

$(BUILD):
	@mkdir -p $(BUILD)

$(BUILD)/main.o: source/main.c $(GENERATED)/generated_game.h | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/core.o: ../../native/src/gbc/core.c ../../native/include/puzzlescript/gbc.h $(GENERATED)/generated_game.h | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/generated_game.o: $(GENERATED)/generated_game.c $(GENERATED)/generated_game.h | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/benchmark.o: source/benchmark.c source/benchmark.h $(GENERATED)/generated_game.h | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(BUILD)/tile_cache.o: source/tile_cache.c source/tile_cache.h | $(BUILD)
	"$(LCC)" $(CFLAGS) -c -o $@ $<

$(TARGET).gb: $(OBJECTS)
	"$(LCC)" $(LDFLAGS) -o $@ $(OBJECTS)

check-size: $(TARGET).gb
	"$(PYTHON)" ../../scripts/check_gbc_rom.py $(TARGET).gb $(GENERATED)/gbc_manifest.json $(TARGET).map

clean:
	@rm -rf build build-autotest build*-perf-* $(GENERATED) puzzlescript_gbc.gb puzzlescript_gbc_autotest.gb
	@rm -f puzzlescript_gbc*-perf-*.gb puzzlescript_gbc*-perf-*.ihx
	@rm -f puzzlescript_gbc*-perf-*.map puzzlescript_gbc*-perf-*.noi puzzlescript_gbc*-perf-*.sym
	@rm -f puzzlescript_gbc.map puzzlescript_gbc.noi puzzlescript_gbc.sym
	@rm -f puzzlescript_gbc_autotest.map puzzlescript_gbc_autotest.noi puzzlescript_gbc_autotest.sym

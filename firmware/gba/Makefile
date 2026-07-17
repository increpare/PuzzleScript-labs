ifeq ($(strip $(DEVKITARM)),)
$(error "Set DEVKITARM to the devkitARM installation directory")
endif

include $(DEVKITARM)/gba_rules

TARGET              := puzzlescript_gba
BUILD               := build
SOURCES             := source generated ../../native/src/gba
DATA                := generated
INCLUDES            := generated ../../native/include ../../native/src
GAME                ?= ../../src/demo/sokoban_basic.txt
PUZZLESCRIPT_CPP    ?= ../../build-32/native/Release/puzzlescript_cpp.exe
AUDIO               ?= 0
AUDIO_VOLUME        ?= 128
AUTOTEST_LEVEL_START ?= 0
PERF_BENCHMARK      ?= 0
PERF_ITERATIONS     ?= 16
PERF_RENDER_ONLY    ?= 0
PERF_TELEMETRY      ?= 0
PERF_RELOAD_LEVEL   ?= 1
ROM_PREFETCH        ?= 1
RENDER_SET_BITS     ?= 1
RENDER_PACKED_BLIT  ?= 1
TITLE_IMAGE         ?=
TITLE_IMAGE_ARG     := $(if $(strip $(TITLE_IMAGE)),--title-image "$(TITLE_IMAGE)",)

ARCH        := -mthumb -mthumb-interwork
CFLAGS      := -g -Wall -Wextra -O2 $(ARCH) -ffunction-sections -fdata-sections
CFLAGS      += -DPS_MASK_WORD_BITS=32 -DPS_INTERPRETER_OBJECT_CELL_INDEX=1
ifneq ($(filter 1 yes true on,$(AUDIO)),)
CFLAGS      += -DPS_GBA_ENABLE_AUDIO=1 -DPS_GBA_EFFECTS_VOLUME=$(AUDIO_VOLUME)
else
CFLAGS      += -DPS_GBA_ENABLE_AUDIO=0
endif
ifneq ($(filter 1 yes true on,$(AUTOTEST_LEVEL_START)),)
CFLAGS      += -DPS_GBA_AUTOTEST_LEVEL_START=1
endif
ifneq ($(filter 1 yes true on,$(PERF_BENCHMARK)),)
CFLAGS      += -DPS_GBA_PERF_BENCHMARK=1 -DPS_GBA_PERF_ITERATIONS=$(PERF_ITERATIONS)
endif
ifneq ($(filter 1 yes true on,$(PERF_RENDER_ONLY)),)
CFLAGS      += -DPS_GBA_PERF_RENDER_ONLY=1
endif
ifneq ($(filter 1 yes true on,$(PERF_TELEMETRY)),)
CFLAGS      += -DPS_GBA_PERF_TELEMETRY=1
endif
ifneq ($(filter 1 yes true on,$(PERF_RELOAD_LEVEL)),)
CFLAGS      += -DPS_GBA_PERF_RELOAD_LEVEL=1
else
CFLAGS      += -DPS_GBA_PERF_RELOAD_LEVEL=0
endif
ifneq ($(filter 1 yes true on,$(ROM_PREFETCH)),)
CFLAGS      += -DPS_GBA_ROM_PREFETCH=1
else
CFLAGS      += -DPS_GBA_ROM_PREFETCH=0
endif
ifneq ($(filter 1 yes true on,$(RENDER_SET_BITS)),)
CFLAGS      += -DPS_GBA_RENDER_SET_BITS=1
else
CFLAGS      += -DPS_GBA_RENDER_SET_BITS=0
endif
ifneq ($(filter 1 yes true on,$(RENDER_PACKED_BLIT)),)
CFLAGS      += -DPS_GBA_RENDER_PACKED_BLIT=1
else
CFLAGS      += -DPS_GBA_RENDER_PACKED_BLIT=0
endif
CFLAGS      += $(INCLUDE)
CXXFLAGS    := $(CFLAGS) -std=gnu++20 -fno-exceptions -fno-rtti \
               -Wno-unused-parameter -Wno-unused-function -Wno-unused-variable
ASFLAGS     := -g $(ARCH)
LDFLAGS      = -g $(ARCH) -Wl,-Map,$(notdir $*.map),--gc-sections
LIBS        := -lmm -ltonc -lgba
LIBDIRS     := $(LIBGBA) $(DEVKITPRO)/libtonc

ifneq ($(BUILD),$(notdir $(CURDIR)))

CPPFILES    := main.cpp core.cpp rule_runtime_stubs.cpp generated_game.cpp generated_rules.cpp
CFILES      :=
SFILES      :=
BINFILES    := soundbank.bin

export OUTPUT       := $(CURDIR)/$(TARGET)
export VPATH        := $(foreach dir,$(SOURCES),$(CURDIR)/$(dir)) $(foreach dir,$(DATA),$(CURDIR)/$(dir))
export DEPSDIR      := $(CURDIR)/$(BUILD)
export LD           := $(CXX)
export OFILES_BIN   := $(addsuffix .o,$(BINFILES))
export OFILES_SOURCES := $(CPPFILES:.cpp=.o) $(CFILES:.c=.o) $(SFILES:.s=.o)
export OFILES       := $(OFILES_BIN) $(OFILES_SOURCES)
export HFILES       := $(addsuffix .h,$(subst .,_,$(BINFILES)))
export INCLUDE      := $(foreach dir,$(INCLUDES),-iquote $(CURDIR)/$(dir)) \
                       $(foreach dir,$(LIBDIRS),-I$(dir)/include) -I$(CURDIR)/$(BUILD)
export LIBPATHS     := $(foreach dir,$(LIBDIRS),-L$(dir)/lib)

.PHONY: all clean export check-size

all: export $(BUILD)

export:
	@mkdir -p generated
	"$(PUZZLESCRIPT_CPP)" export-gba "$(GAME)" --out generated $(TITLE_IMAGE_ARG)

$(BUILD): export
	@mkdir -p $@
	@$(MAKE) --no-print-directory -C $(BUILD) -f $(CURDIR)/Makefile
	@$(MAKE) --no-print-directory check-size

check-size:
	@python ../../scripts/check_gba_map.py $(BUILD)/$(TARGET).map $(TARGET).gba

clean:
	@echo clean ...
	@rm -fr $(BUILD) $(TARGET).elf $(TARGET).gba $(TARGET).map generated

else

DEPENDS := $(OFILES:.o=.d)

$(OUTPUT).gba: $(OUTPUT).elf

$(OUTPUT).elf: $(OFILES)

$(OFILES_SOURCES): $(HFILES)

%.bin: ;

%.bin.o: %.bin
	@echo $(notdir $<)
	@$(bin2o)

%_bin.h: %.bin.o
	@:

-include $(DEPENDS)

endif

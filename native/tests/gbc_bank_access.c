#include "puzzlescript/gbc_bank_access.h"

#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef struct fake_bank {
    uint8_t current;
    uint8_t switches[8];
    uint8_t switch_count;
} fake_bank;

static uint8_t fake_current(void* context) {
    return ((fake_bank*)context)->current;
}

static void fake_switch(void* context, uint8_t bank) {
    fake_bank* fake = (fake_bank*)context;
    fake->switches[fake->switch_count++] = bank;
    fake->current = bank;
}

int main(void) {
    fake_bank fake = {7U, {0U}, 0U};
    const ps_gbc_bank_access access = {
        &fake, fake_current, fake_switch
    };
    const uint8_t source[] = {3U, 1U, 4U, 1U};
    uint8_t destination[4] = {0U};
    char text[5] = {'x', 'x', 'x', 'x', 'x'};

    assert(ps_gbc_bank_copy(
        &access, 2U, source, destination, sizeof(destination)));
    assert(memcmp(source, destination, sizeof(source)) == 0);
    assert(fake.switch_count == 2U);
    assert(fake.switches[0] == 2U && fake.switches[1] == 7U);
    assert(fake.current == 7U);

    fake.switch_count = 0U;
    assert(!ps_gbc_bank_copy_string(
        &access, 2U, "abcdef", text, sizeof(text)));
    assert(strcmp(text, "abcd") == 0);
    assert(fake.current == 7U && fake.switch_count == 2U);

    fake.switch_count = 0U;
    assert(ps_gbc_bank_copy(&access, 2U, NULL, NULL, 0U));
    assert(fake.switch_count == 0U);
    assert(!ps_gbc_bank_copy(&access, 2U, NULL, destination, 1U));
    assert(!ps_gbc_bank_copy_string(&access, 2U, "x", NULL, 0U));
    assert(fake.switch_count == 0U && fake.current == 7U);

    puts("gbc_bank_access: ok");
    return 0;
}

#include "puzzlescript/gbc_bank_access.h"

#include <stddef.h>

static bool ps_gbc_bank_access_valid(const ps_gbc_bank_access* access) {
    return access != NULL
        && access->current_bank != NULL
        && access->switch_bank != NULL;
}

bool ps_gbc_bank_copy(
    const ps_gbc_bank_access* access,
    uint8_t source_bank,
    const void* source,
    void* destination,
    uint16_t byte_count
) {
    const uint8_t* source_bytes;
    uint8_t* destination_bytes;
    uint8_t previous_bank;
    uint16_t index;
    if (byte_count == 0U) return true;
    if (!ps_gbc_bank_access_valid(access)
        || source == NULL
        || destination == NULL) {
        return false;
    }
    source_bytes = (const uint8_t*)source;
    destination_bytes = (uint8_t*)destination;
    previous_bank = access->current_bank(access->context);
    access->switch_bank(access->context, source_bank);
    for (index = 0U; index < byte_count; ++index) {
        destination_bytes[index] = source_bytes[index];
    }
    access->switch_bank(access->context, previous_bank);
    return true;
}

bool ps_gbc_bank_copy_string(
    const ps_gbc_bank_access* access,
    uint8_t source_bank,
    const char* source,
    char* destination,
    uint16_t capacity
) {
    uint8_t previous_bank;
    uint16_t index = 0U;
    bool fit;
    if (capacity == 0U
        || !ps_gbc_bank_access_valid(access)
        || source == NULL
        || destination == NULL) {
        return false;
    }
    previous_bank = access->current_bank(access->context);
    access->switch_bank(access->context, source_bank);
    while (index + 1U < capacity && source[index] != '\0') {
        destination[index] = source[index];
        ++index;
    }
    fit = source[index] == '\0';
    destination[index] = '\0';
    access->switch_bank(access->context, previous_bank);
    return fit;
}

#pragma once
#include "puzzlescript/gbc.h"
#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

uint16_t ps_gbc_facade_cell_count(const ps_gbc_session* session);
uint32_t ps_gbc_facade_get_objects(const ps_gbc_session* session, uint16_t cell);
void ps_gbc_facade_set_objects(ps_gbc_session* session, uint16_t cell, uint32_t objects);
uint32_t ps_gbc_facade_get_movements(const ps_gbc_session* session, uint16_t cell);
void ps_gbc_facade_set_movements(ps_gbc_session* session, uint16_t cell, uint32_t movements);
void ps_gbc_facade_mark_dirty(ps_gbc_session* session, uint16_t cell);
bool ps_gbc_facade_cell_has_any(const ps_gbc_session* session, uint16_t cell, uint32_t mask);
bool ps_gbc_facade_cell_has_all(const ps_gbc_session* session, uint16_t cell, uint32_t mask);

#ifdef __cplusplus
}
#endif

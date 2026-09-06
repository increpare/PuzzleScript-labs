#pragma once

#include <cstdlib>

// Use a half-open floating-point draw: integer rand()/RAND_MAX made even
// zero-probability options run almost always, instead of sampling the recipe.
inline bool generationOptionApplies(double probability) {
    const double unit = static_cast<double>(std::rand())
        / (static_cast<double>(RAND_MAX) + 1.0);
    return unit < probability;
}

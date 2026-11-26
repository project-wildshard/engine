"""Coarse whole-frame colour guard: sRGB luma and HSV saturation, both 0..1.

These limits catch large exposure/grade regressions without treating ordinary
pixel motion as an exact-image failure. A board still needs its visual read.
"""

LUMA_SHIFT_LIMIT = 0.15
SATURATION_SHIFT_LIMIT = 0.08


def mean_colour(pixels):
    count, luma, saturation = 0, 0.0, 0.0
    for r, g, b in pixels:
        high, low = max(r, g, b), min(r, g, b)
        luma += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
        saturation += (high - low) / high if high else 0
        count += 1
    if not count:
        raise ValueError('Colour comparison needs pixels')
    return luma / count, saturation / count


def colour_shift(golden, now):
    before, after = mean_colour(golden), mean_colour(now)
    luma, saturation = after[0] - before[0], after[1] - before[1]
    return {'luma_delta': luma, 'saturation_delta': saturation,
            'red': abs(luma) >= LUMA_SHIFT_LIMIT or abs(saturation) >= SATURATION_SHIFT_LIMIT}

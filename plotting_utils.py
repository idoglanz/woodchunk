import random


def get_random_color():
    """Generate a random pastel color."""
    hue = random.random()
    saturation = 0.3 + random.random() * 0.2  # 0.3-0.5
    value = 0.9 + random.random() * 0.1  # 0.9-1.0

    # Convert HSV to RGB
    h = hue * 6
    i = int(h)
    f = h - i
    p = value * (1 - saturation)
    q = value * (1 - f * saturation)
    t = value * (1 - (1 - f) * saturation)

    if i == 0:
        r, g, b = value, t, p
    elif i == 1:
        r, g, b = q, value, p
    elif i == 2:
        r, g, b = p, value, t
    elif i == 3:
        r, g, b = p, q, value
    elif i == 4:
        r, g, b = t, p, value
    else:
        r, g, b = value, p, q

    return f"rgb({int(r*255)}, {int(g*255)}, {int(b*255)})"

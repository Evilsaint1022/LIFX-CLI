// "Average Screen Color" — the signature feature of LIFX-Control-Panel.
// Grabs the screen, shrinks it to a single pixel (a fast, accurate average),
// and reports the dominant color so the bulb can mirror it (bias lighting).
import screenshot from 'screenshot-desktop';
import sharp from 'sharp';

// Capture the screen once and return its average { red, green, blue }.
export async function averageScreenColor() {
  const img = await screenshot({ format: 'png' });
  // Resizing to 1x1 with sharp averages all pixels for us.
  const { data } = await sharp(img)
    .resize(1, 1, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { red: data[0], green: data[1], blue: data[2] };
}

// Boost a washed-out average toward something the bulb can actually show.
// Raw screen averages are often muddy grey; we lift saturation a touch.
export function punchUp({ red, green, blue }) {
  const max = Math.max(red, green, blue);
  if (max === 0) return { red, green, blue };
  const scale = 255 / max; // normalize brightness up
  return {
    red: Math.round(red * scale),
    green: Math.round(green * scale),
    blue: Math.round(blue * scale),
  };
}

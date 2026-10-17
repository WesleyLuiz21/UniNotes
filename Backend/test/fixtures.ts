import sharp from 'sharp';

export const PNG_1x1 = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ff0000' } })
  .png()
  .toBuffer();

/** JPEG carrying EXIF metadata (including a fake GPS-ish comment) that must be stripped. */
export const JPEG_WITH_EXIF = await sharp({
  create: { width: 64, height: 32, channels: 3, background: '#00ff00' },
})
  .jpeg()
  .withMetadata({ exif: { IFD0: { Copyright: 'SECRET-EXIF-MARKER', Make: 'SpyCam' } } })
  .toBuffer();

export const LARGE_PNG = await sharp({
  create: { width: 5000, height: 100, channels: 3, background: '#0000ff' },
})
  .png()
  .toBuffer();

/** A valid PNG with an HTML/JS payload appended after IEND. */
export const POLYGLOT_PNG = Buffer.concat([PNG_1x1, Buffer.from('<script>alert(1)</script>')]);

export const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

export const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>',
);
export const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');
export const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0x90)]);

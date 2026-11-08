#!/usr/bin/env python3
"""Extract the icon representations from an .icns container and materialise the
sizes a Linux icon theme expects.

usage: extract-icons.py <icon.icns> <output-dir>

Writes <output-dir>/<size>.png for every size in SIZES. Sizes that exist in the
container are written verbatim; the rest are produced by a premultiplied box
filter from the smallest larger representation.
"""
import os
import struct
import sys
import zlib

SIZES = (16, 22, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 1024)


def icns_pngs(data):
    """Return {width: png bytes} for every PNG representation in the container."""
    if data[:4] != b'icns':
        raise ValueError('not an icns container')
    out = {}
    offset = 8
    while offset + 8 <= len(data):
        length = struct.unpack('>I', data[offset + 4:offset + 8])[0]
        if length < 8:
            break
        payload = data[offset + 8:offset + length]
        if payload[:8] == b'\x89PNG\r\n\x1a\n' and len(payload) > 24:
            width, height = struct.unpack('>II', payload[16:24])
            if width == height and (width not in out or len(payload) > len(out[width])):
                out[width] = payload
        offset += length
    if not out:
        raise ValueError('no PNG representation found')
    return out


def decode_png(data):
    """Decode 8-bit RGB/RGBA, non-interlaced PNG into (width, height, rgba)."""
    pos, idat, width = 8, b'', None
    while pos < len(data):
        length = struct.unpack('>I', data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        if kind == b'IHDR':
            width, height, depth, colour, _, _, interlace = struct.unpack('>IIBBBBB', chunk)
            if depth != 8 or colour not in (2, 6) or interlace:
                raise ValueError(f'unsupported PNG: depth={depth} colour={colour}')
            channels = 3 if colour == 2 else 4
        elif kind == b'IDAT':
            idat += chunk
        pos += 12 + length

    raw = zlib.decompress(idat)
    stride = width * channels
    pixels = bytearray(width * height * 4)
    previous = bytearray(stride)
    pos = 0
    for y in range(height):
        filt = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if filt == 1:
            for x in range(channels, stride):
                line[x] = (line[x] + line[x - channels]) & 0xFF
        elif filt == 2:
            for x in range(stride):
                line[x] = (line[x] + previous[x]) & 0xFF
        elif filt == 3:
            for x in range(stride):
                left = line[x - channels] if x >= channels else 0
                line[x] = (line[x] + ((left + previous[x]) >> 1)) & 0xFF
        elif filt == 4:
            for x in range(stride):
                left = line[x - channels] if x >= channels else 0
                up = previous[x]
                upleft = previous[x - channels] if x >= channels else 0
                estimate = left + up - upleft
                pa, pb, pc = abs(estimate - left), abs(estimate - up), abs(estimate - upleft)
                if pa <= pb and pa <= pc:
                    predictor = left
                elif pb <= pc:
                    predictor = up
                else:
                    predictor = upleft
                line[x] = (line[x] + predictor) & 0xFF
        elif filt != 0:
            raise ValueError(f'unknown PNG filter {filt}')
        previous = line
        for x in range(width):
            base = (y * width + x) * 4
            if channels == 3:
                pixels[base:base + 3] = line[x * 3:x * 3 + 3]
                pixels[base + 3] = 255
            else:
                pixels[base:base + 4] = line[x * 4:x * 4 + 4]
    return width, height, pixels


def resize_box(src_w, src_h, src, dst_w, dst_h):
    """Premultiplied box filter; adequate for icon downscaling."""
    out = bytearray(dst_w * dst_h * 4)
    for dy in range(dst_h):
        y0 = dy * src_h // dst_h
        y1 = max(y0 + 1, (dy + 1) * src_h // dst_h)
        for dx in range(dst_w):
            x0 = dx * src_w // dst_w
            x1 = max(x0 + 1, (dx + 1) * src_w // dst_w)
            r = g = b = a = count = 0
            for y in range(y0, y1):
                row = y * src_w
                for x in range(x0, x1):
                    base = (row + x) * 4
                    alpha = src[base + 3]
                    r += src[base] * alpha
                    g += src[base + 1] * alpha
                    b += src[base + 2] * alpha
                    a += alpha
                    count += 1
            index = (dy * dst_w + dx) * 4
            if a:
                out[index] = min(255, r // a)
                out[index + 1] = min(255, g // a)
                out[index + 2] = min(255, b // a)
                out[index + 3] = a // count
            else:
                out[index:index + 4] = b'\x00\x00\x00\x00'
    return out


def encode_png(width, height, rgba):
    rows = b''.join(b'\x00' + bytes(rgba[y * width * 4:(y + 1) * width * 4]) for y in range(height))

    def chunk(kind, payload):
        return (struct.pack('>I', len(payload)) + kind + payload +
                struct.pack('>I', zlib.crc32(kind + payload) & 0xFFFFFFFF))

    return (b'\x89PNG\r\n\x1a\n' +
            chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(rows, 9)) +
            chunk(b'IEND', b''))


def main():
    if len(sys.argv) != 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    source, outdir = sys.argv[1], sys.argv[2]
    native = icns_pngs(open(source, 'rb').read())
    os.makedirs(outdir, exist_ok=True)

    decoded = {}

    def image(size):
        if size not in decoded:
            decoded[size] = decode_png(native[size])
        return decoded[size]

    for size in SIZES:
        if size in native:
            png = native[size]
            origin = 'native'
        else:
            larger = min(s for s in native if s > size)
            width, height, pixels = image(larger)
            png = encode_png(size, size, resize_box(width, height, pixels, size, size))
            origin = f'resampled from {larger}'
        with open(os.path.join(outdir, f'{size}.png'), 'wb') as handle:
            handle.write(png)
        print(f'{size}x{size}: {origin}, {len(png)} bytes')
    return 0


if __name__ == '__main__':
    sys.exit(main())
